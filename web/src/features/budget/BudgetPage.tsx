import { Fragment, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget, saveBudget, type Txn } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useCategories, useBaseCurrency } from '../transactions/useConfig'
import { useTheme, useCensor } from '../../prefs'
import { addMonths, currentMonthKey, monthLabel } from '../transactions/month'
import {
  budgetIncome, monthBudgetSummary, bucketFor, bucketForTxn, monthPieData,
  subcatMonthVsAvg, NEEDS, WANTS, SAVINGS, HIDDEN_LABEL,
} from '../../lib/analytics/budget'
import type { Bucket, BudgetCfg } from '../../data/defaults'
import { buildBudgetPie, type BudgetUi } from './figure'
import { ThisPeriodBudget } from './ThisPeriodBudget'
import { Plot } from '../../components/Plot'
import { useHold } from '../../lib/useHold'
import { t } from '../../i18n'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

const BUCKET_ORDER: Bucket[] = [NEEDS, WANTS, SAVINGS]

export function BudgetPage() {
  const all = useLiveTxns()
  const cfg = useLiveQuery(() => getBudget(), []) // undefined until loaded (avoids seeding defaults)
  const categories = useCategories()
  const currency = useBaseCurrency()
  const [theme] = useTheme()
  const [censor] = useCensor()
  const [month, setMonth] = useState(currentMonthKey())

  const ui: BudgetUi = useMemo(
    () => ({ ink: cssVar('--ink', '#e6e9ee'), muted: cssVar('--muted', '#8a94a6'), expense: cssVar('--expense', '#e74c3c') }),
    [theme],
  )

  const save = (patch: Partial<BudgetCfg>) => {
    if (cfg) void saveBudget({ ...cfg, ...patch })
  }

  const summary = useMemo(
    () => (cfg ? monthBudgetSummary(all, cfg, month) : null),
    [all, cfg, month],
  )
  const income = useMemo(() => (cfg ? budgetIncome(all, cfg) : 0), [all, cfg])
  const pieData = useMemo(
    () => (cfg ? monthPieData(all, month, income, cfg.assignments, cfg.subAssignments) : null),
    [all, cfg, month, income],
  )
  const fig = useMemo(() => {
    if (!pieData) return null
    return buildBudgetPie(pieData.pie, {
      remaining: pieData.remaining, total: pieData.total, budget: income,
      currency, ui, censor,
      labels: { noData: t('No data'), remaining: t('Remaining budget'), ofBudget: t('of budget'), hidden: t('Hidden cost') },
    })
  }, [pieData, income, month, currency, ui, censor])

  if (!cfg || !summary) return <p className="muted">{t('Loading…')}</p>

  return (
    <div>
      <h1 className="h1">{t('Budget')}</h1>
      <p className="muted" style={{ marginTop: -4, marginBottom: 14 }}>{t('Plan your spending with the 50/30/20 rule.')}</p>

      {/* ── Budget settings (collapsible: Income & split + Category buckets) ── */}
      <BudgetSettings cfg={cfg} save={save} expense={categories.expense} />

      {/* ── This period ─────────────────────────────────────────────── */}
      <section className="card budget-card">
        <ThisPeriodBudget summary={summary} censor={censor} />
      </section>

      {/* ── Spending vs budget donut ─────────────────────────────────── */}
      <section className="card budget-card">
        <div className="dash-title">{t('Spending vs budget')}</div>
        <div className="month-nav">
          <button className="tool-btn" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">‹</button>
          <span className="month-label">{monthLabel(month)}</span>
          <button className="tool-btn" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">›</button>
        </div>
        {fig && <Plot data={fig.data} layout={fig.layout} ariaLabel={t('Spending vs budget')} style={{ width: '100%' }} />}
        {pieData && pieData.over && (
          <div className="budget-overflow">
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('Over budget — not in the ring')}</div>
            {pieData.list.map((it) => (
              <div key={it.label} className={`budget-overflow-row ${it.label === HIDDEN_LABEL ? 'hidden' : it.bucket.toLowerCase()}`}>
                <span className="muted">{it.label === HIDDEN_LABEL ? t('Hidden cost') : it.label}</span>
                <span style={{ fontWeight: 600 }}>
                  <span className="money">{money(it.amount, censor)}</span> ({income ? Math.round((it.amount / income) * 100) : 0}%)
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Sub-category detail: this month vs date-of-month rolling average ── */}
      <SubcatDetail all={all} month={month} censor={censor} />
    </div>
  )
}

// ── Sub-category detail: this-month spend vs a date-of-month rolling average ────
const WINDOWS: [string, number][] = [['1M', 1], ['3M', 3], ['6M', 6], ['1Y', 12]]
// Human phrase for the averaging window (used in the table's description line).
const WINDOW_PHRASE: Record<number, string> = { 1: '1 month', 3: '3 months', 6: '6 months', 12: '1 year' }

// Colour a "This" amount by how it compares to the average: red = spending more
// than usual, green = less, muted = the same.
function toneClass(cur: number, avg: number): string {
  if (cur > avg) return 'amt-expense'
  if (cur < avg) return 'amt-income'
  return ''
}

function SubcatDetail({ all, month, censor }: { all: Txn[]; month: string; censor: boolean }) {
  const [open, setOpen] = useState(false)
  const [win, setWin] = useState(3)
  // Sub-categories collapsed by default → the table shows just main categories.
  const [subOpen, setSubOpen] = useState(false)
  const groups = useMemo(() => subcatMonthVsAvg(all, month, win), [all, month, win])

  // Day-of-month cutoff the comparison uses (today for the current month, else full).
  const [y, m] = month.split('-').map(Number)
  const dom = month === currentMonthKey() ? new Date().getDate() : new Date(y, m, 0).getDate()

  return (
    <section className="card budget-card">
      <button
        type="button"
        className="budget-settings-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dash-title" style={{ margin: 0 }}>{t('Sub-category detail')}</span>
        <span className="budget-settings-caret">{open ? '⌃' : '⌄'}</span>
      </button>

      <div className={open ? 'budget-settings-body open' : 'budget-settings-body'}>
        <div className="budget-settings-inner">
          <div className="seg" style={{ marginTop: 10 }}>
            {WINDOWS.map(([label, n]) => (
              <button key={n} type="button" className={win === n ? 'seg-btn active' : 'seg-btn'} onClick={() => setWin(n)}>
                {label}
              </button>
            ))}
          </div>

          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {t('Spending in the first {d} days of {month}, versus the first {d} days averaged over the previous {window}.', {
              d: dom, month: monthLabel(month), window: t(WINDOW_PHRASE[win]),
            })}
          </p>

          {groups.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>{t('No spending this month')}</p>
          ) : (
            <div className="subcat-table" style={{ marginTop: 6 }}>
              <div className="subcat-grid subcat-head">
                <button
                  type="button"
                  className="subcat-name subcat-toggle"
                  aria-expanded={subOpen}
                  onClick={() => setSubOpen((o) => !o)}
                >
                  {subOpen ? t('Sub-category') : t('Category')}
                  <span className="subcat-toggle-caret">{subOpen ? '⌄' : '›'}</span>
                </button>
                <span className="subcat-col">{t('This')}</span>
                <span className="subcat-col">{t('Avg')}</span>
              </div>
              {groups.map((g) => (
                <Fragment key={g.category}>
                  <div className="subcat-grid subcat-group">
                    <span className="subcat-name">{g.category}</span>
                    <span className={`subcat-col ${toneClass(g.cur, g.avg)}`}>{money(g.cur, censor)}</span>
                    <span className="subcat-col muted">{money(g.avg, censor)}</span>
                  </div>
                  {subOpen && g.rows.map((r) => (
                    <div key={r.sub} className="subcat-grid subcat-row">
                      <span className="subcat-name">{r.sub}</span>
                      <span className={`subcat-col ${toneClass(r.cur, r.avg)}`}>{money(r.cur, censor)}</span>
                      <span className="subcat-col muted">{money(r.avg, censor)}</span>
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Collapsible "Budget settings" box: Income & split + Category buckets ───────
function BudgetSettings({ cfg, save, expense }: {
  cfg: BudgetCfg; save: (p: Partial<BudgetCfg>) => void; expense: Record<string, string[]>
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="card budget-card budget-settings">
      <button
        type="button"
        className="budget-settings-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dash-title" style={{ margin: 0 }}>{t('Budget settings')}</span>
        <span className="budget-settings-caret">{open ? '⌃' : '⌄'}</span>
      </button>

      <div className={open ? 'budget-settings-body open' : 'budget-settings-body'}>
        <div className="budget-settings-inner">
          <IncomeSplitCard cfg={cfg} save={save} />
          <BucketBoard cfg={cfg} expense={expense} save={save} />
          <button type="button" className="btn budget-settings-collapse" onClick={() => setOpen(false)}>
            {t('Collapse settings')}
          </button>
        </div>
      </div>
    </section>
  )
}

// ── Income basis + split percentages ──────────────────────────────────────────
function IncomeSplitCard({ cfg, save }: { cfg: BudgetCfg; save: (p: Partial<BudgetCfg>) => void }) {
  const [fixed, setFixed] = useState<string>(String(cfg.fixedIncome))
  useEffect(() => { setFixed(String(cfg.fixedIncome)) }, [cfg.fixedIncome])

  const setPct = (bucket: Bucket, value: number) =>
    save({ percentages: { ...cfg.percentages, [bucket]: Math.max(0, Math.min(100, value || 0)) } })
  const total = cfg.percentages.Needs + cfg.percentages.Wants + cfg.percentages.Savings

  return (
    <section className="budget-subsection">
      <div className="dash-title">{t('Income & split')}</div>

      <div className="seg" style={{ marginTop: 8 }}>
        {(['fixed', 'rolling'] as const).map((mode) => (
          <button key={mode} type="button" className={cfg.mode === mode ? 'seg-btn active' : 'seg-btn'} onClick={() => save({ mode })}>
            {t(mode === 'fixed' ? 'Fixed amount' : 'Rolling average')}
          </button>
        ))}
      </div>

      {cfg.mode === 'fixed' && (
        <label className="budget-field">
          <span className="muted">{t('Monthly income')}</span>
          <input
            type="number" inputMode="decimal" value={fixed}
            onChange={(e) => setFixed(e.target.value)}
            onBlur={() => save({ fixedIncome: Number(fixed) || 0 })}
          />
        </label>
      )}
      {cfg.mode === 'rolling' && (
        <p className="muted" style={{ fontSize: 13 }}>{t('Average of the last {n} completed months of income.', { n: cfg.rollingMonths })}</p>
      )}

      <div className="budget-split">
        {BUCKET_ORDER.map((b) => (
          <label key={b} className="budget-pct">
            <span className="muted" style={{ fontSize: 12 }}>{t(b)}</span>
            <input type="number" inputMode="numeric" min={0} max={100} value={cfg.percentages[b]} onChange={(e) => setPct(b, Number(e.target.value))} />
          </label>
        ))}
        <span className={total === 100 ? 'amt-income' : 'amt-expense'} style={{ alignSelf: 'end', paddingBottom: 8, fontSize: 13 }}>
          = {total}%{total === 100 ? ' ✓' : ''}
        </span>
      </div>
    </section>
  )
}

// ── Needs / Wants hold-to-swap board with per-subcategory splitting ────────────
type Chip =
  | { kind: 'cat'; cat: string; key: string; bucket: Bucket; hasSubs: boolean }
  | { kind: 'sub'; cat: string; sub: string; key: string; bucket: Bucket }

function BucketBoard({ cfg, expense, save }: {
  cfg: BudgetCfg; expense: Record<string, string[]>; save: (p: Partial<BudgetCfg>) => void
}) {
  // One inline sub-cat strip open at a time. `mounted`/`shown` keep the strip in
  // the DOM through the collapse transition (mirrors the category-picker pattern).
  const [expanded, setExpanded] = useState<string | null>(null)
  const [mounted, setMounted] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (expanded) {
      setMounted(expanded)
      const r = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(r)
    }
    setShown(false)
    const tm = setTimeout(() => setMounted(null), 260)
    return () => clearTimeout(tm)
  }, [expanded])

  // Flip a whole category's bucket; prune sub-overrides that now equal the parent.
  const flipCat = (cat: string) => {
    const next: Bucket = bucketFor(cat, cfg.assignments) === NEEDS ? WANTS : NEEDS
    const subs = { ...cfg.subAssignments }
    if (subs[cat]) {
      const kept: Record<string, Bucket> = {}
      for (const [sub, b] of Object.entries(subs[cat])) if (b !== next) kept[sub] = b
      if (Object.keys(kept).length) subs[cat] = kept
      else delete subs[cat]
    }
    save({ assignments: { ...cfg.assignments, [cat]: next }, subAssignments: subs })
  }

  // Toggle a sub-cat's bucket. Landing on the parent's bucket deletes the override
  // (so a split chip collapses back into its category).
  const toggleSub = (cat: string, sub: string) => {
    const parent = bucketFor(cat, cfg.assignments)
    const to: Bucket = bucketForTxn(cat, sub, cfg.assignments, cfg.subAssignments) === NEEDS ? WANTS : NEEDS
    const subs = { ...cfg.subAssignments }
    const catMap = { ...(subs[cat] ?? {}) }
    if (to === parent) delete catMap[sub]
    else catMap[sub] = to
    if (Object.keys(catMap).length) subs[cat] = catMap
    else delete subs[cat]
    save({ subAssignments: subs })
  }

  const toggleExpand = (cat: string) => setExpanded((cur) => (cur === cat ? null : cat))

  const cols: Record<'Needs' | 'Wants', Chip[]> = { Needs: [], Wants: [] }
  for (const cat of Object.keys(expense)) {
    const b = bucketFor(cat, cfg.assignments)
    cols[b === NEEDS ? 'Needs' : 'Wants'].push({ kind: 'cat', cat, key: `c:${cat}`, bucket: b, hasSubs: (expense[cat]?.length ?? 0) > 0 })
  }
  for (const [cat, m] of Object.entries(cfg.subAssignments)) {
    for (const [sub, b] of Object.entries(m)) {
      cols[b === NEEDS ? 'Needs' : 'Wants'].push({ kind: 'sub', cat, sub, key: `s:${cat}:${sub}`, bucket: b })
    }
  }

  return (
    <section className="budget-subsection">
      <div className="dash-title">{t('Category buckets')}</div>
      <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{t('Hold to swap · tap a category for its sub-categories.')}</p>
      <div className="budget-cols">
        {(['Needs', 'Wants'] as const).map((bucket) => (
          <div key={bucket} className="budget-col" data-bucket={bucket}>
            <div className="budget-col-head">{t(bucket)}</div>
            <div className="budget-chip-list">
              {cols[bucket].map((chip) =>
                chip.kind === 'cat' ? (
                  <CatChip
                    key={chip.key} cat={chip.cat} bucket={chip.bucket} hasSubs={chip.hasSubs}
                    expanded={expanded === chip.cat}
                    onHold={() => flipCat(chip.cat)}
                    onTap={chip.hasSubs ? () => toggleExpand(chip.cat) : undefined}
                  />
                ) : (
                  <SubChip
                    key={chip.key} cat={chip.cat} sub={chip.sub} bucket={chip.bucket}
                    onHold={() => toggleSub(chip.cat, chip.sub)}
                    onTap={() => toggleExpand(chip.cat)}
                  />
                ),
              )}
              {cols[bucket].length === 0 && <span className="muted" style={{ fontSize: 12 }}>—</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Inline sub-cat strip for the tapped category (hold a sub-cat to move it). */}
      <div className={shown ? 'budget-subwrap open' : 'budget-subwrap'}>
        <div className="budget-subgrid">
          {mounted && (
            <>
              <div className="budget-substrip-head muted">
                {mounted} · {t('Hold a sub-category to move it')}
              </div>
              <div className="budget-chip-list">
                {(expense[mounted] ?? []).map((sub) => (
                  <SubChip
                    key={sub} cat={mounted} sub={sub}
                    label={sub}
                    bucket={bucketForTxn(mounted, sub, cfg.assignments, cfg.subAssignments)}
                    onHold={() => toggleSub(mounted, sub)}
                  />
                ))}
                {(expense[mounted]?.length ?? 0) === 0 && <span className="muted" style={{ fontSize: 12 }}>—</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

// A category chip: hold to flip its bucket, tap to open its sub-cat strip.
function CatChip({ cat, bucket, hasSubs, expanded, onHold, onTap }: {
  cat: string; bucket: Bucket; hasSubs: boolean; expanded: boolean
  onHold: () => void; onTap?: () => void
}) {
  const hold = useHold(onHold, onTap)
  return (
    <button
      type="button"
      className={`budget-chip ${bucket.toLowerCase()}${hold.pressing ? ' pressing' : ''}`}
      onPointerDown={hold.onPointerDown}
      onPointerUp={hold.onPointerUp}
      onPointerLeave={hold.onPointerLeave}
      onPointerCancel={hold.onPointerCancel}
      onClick={hold.onClick}
    >
      {cat}
      {hasSubs && <span className="cat-caret">{expanded ? '▴' : '▾'}</span>}
    </button>
  )
}

// A sub-category chip: hold to move its bucket. In a column it shows "cat:sub"
// (a split-off); in the strip it shows just the sub-cat name (`label`).
function SubChip({ cat, sub, bucket, label, onHold, onTap }: {
  cat: string; sub: string; bucket: Bucket; label?: string
  onHold: () => void; onTap?: () => void
}) {
  const hold = useHold(onHold, onTap)
  return (
    <button
      type="button"
      className={`budget-chip ${bucket.toLowerCase()} sub${hold.pressing ? ' pressing' : ''}`}
      onPointerDown={hold.onPointerDown}
      onPointerUp={hold.onPointerUp}
      onPointerLeave={hold.onPointerLeave}
      onPointerCancel={hold.onPointerCancel}
      onClick={hold.onClick}
    >
      {label ?? `${cat}:${sub}`}
    </button>
  )
}

// ── small helpers ─────────────────────────────────────────────────────────────
function money(n: number, censor: boolean): string {
  return censor ? '•••' : fmt(n)
}
