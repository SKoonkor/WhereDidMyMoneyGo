import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget, saveBudget } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useSettings, useCategories, useBaseCurrency } from '../transactions/useConfig'
import { useTheme, useCensor } from '../../prefs'
import { addMonths, currentMonthKey, monthLabel } from '../transactions/month'
import {
  budgetIncome, budgetSummary, bucketFor, bucketTone, monthPieData,
  NEEDS, WANTS, SAVINGS, HIDDEN_LABEL,
} from '../../lib/analytics/budget'
import type { Bucket, BudgetCfg } from '../../data/defaults'
import { buildBudgetPie, type BudgetUi } from './figure'
import { Plot } from '../../components/Plot'
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
  const settings = useSettings()
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
    () => (cfg ? budgetSummary(all, cfg, settings.resetDay) : null),
    [all, cfg, settings.resetDay],
  )
  const income = useMemo(() => (cfg ? budgetIncome(all, cfg) : 0), [all, cfg])
  const pieData = useMemo(
    () => (cfg ? monthPieData(all, month, income, cfg.assignments) : null),
    [all, cfg, month, income],
  )
  const fig = useMemo(() => {
    if (!pieData) return null
    return buildBudgetPie(pieData.pie, {
      remaining: pieData.remaining, total: pieData.total, budget: income, title: monthLabel(month),
      currency, ui, censor,
      labels: { noData: t('No data'), remaining: t('Remaining budget'), ofBudget: t('of budget'), hidden: t('Hidden cost') },
    })
  }, [pieData, income, month, currency, ui, censor])

  if (!cfg || !summary) return <p className="muted">{t('Loading…')}</p>

  return (
    <div>
      <h1 className="h1">{t('Budget')}</h1>
      <p className="muted" style={{ marginTop: -4, marginBottom: 14 }}>{t('Plan your spending with the 50/30/20 rule.')}</p>

      {/* ── This period ─────────────────────────────────────────────── */}
      <section className="card budget-card">
        <div className="dash-title">{t('This period')}</div>
        <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {t('{start} – {end} · income {income} ({mode})', {
            start: dayLabel(summary.start),
            end: dayLabel(summary.end),
            income: censor ? '•••' : fmt(summary.income),
            mode: t(summary.mode === 'rolling' ? 'rolling average' : 'fixed'),
          })}
        </p>
        {BUCKET_ORDER.map((name) => {
          const b = summary.buckets[name]
          const raw = b.target ? (b.spent / b.target) * 100 : 0
          const width = Math.min(100, Math.max(0, raw))
          const tone = bucketTone(name, b.spent, b.target)
          let note: string
          let noteCls = ''
          if (name === SAVINGS) {
            const ahead = b.remaining >= 0
            note = `${money(ahead ? b.remaining : -b.remaining, censor)} ${t(ahead ? 'ahead' : 'short')}`
            noteCls = ahead ? 'amt-income' : 'amt-expense'
          } else {
            const over = b.remaining < 0
            note = `${money(over ? -b.remaining : b.remaining, censor)} ${t(over ? 'over' : 'left')}`
            noteCls = over ? 'amt-expense' : ''
          }
          return (
            <div key={name} className="budget-row">
              <div className="budget-row-head">
                <span className="budget-row-name">{t(name)}</span>
                <span className="budget-row-note">
                  <span className="money">{money(b.spent, censor)}</span> {t('of')} <span className="money">{money(b.target, censor)}</span>
                  {' · '}<span className={noteCls} style={{ fontWeight: 600 }}>{note}</span>
                </span>
              </div>
              <div className="budget-bar"><div className={`budget-bar-fill ${tone}`} style={{ width: `${width.toFixed(0)}%` }} /></div>
            </div>
          )
        })}
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

      {/* ── Income & split ───────────────────────────────────────────── */}
      <IncomeSplitCard cfg={cfg} save={save} />

      {/* ── Category buckets ─────────────────────────────────────────── */}
      <BucketBoard cfg={cfg} categories={Object.keys(categories.expense)} save={save} />

      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {t('The budget month starts on day {d}. Change it in Settings.', { d: settings.resetDay })}
      </p>
    </div>
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
    <section className="card budget-card">
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

// ── Needs / Wants tap-to-flip board ───────────────────────────────────────────
function BucketBoard({ cfg, categories, save }: { cfg: BudgetCfg; categories: string[]; save: (p: Partial<BudgetCfg>) => void }) {
  const flip = (cat: string) => {
    const next: Bucket = bucketFor(cat, cfg.assignments) === NEEDS ? WANTS : NEEDS
    save({ assignments: { ...cfg.assignments, [cat]: next } })
  }
  const cols: Record<'Needs' | 'Wants', string[]> = { Needs: [], Wants: [] }
  for (const cat of categories) (bucketFor(cat, cfg.assignments) === NEEDS ? cols.Needs : cols.Wants).push(cat)

  return (
    <section className="card budget-card">
      <div className="dash-title">{t('Category buckets')}</div>
      <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{t('Tap a category to move it between Needs and Wants. Savings is whatever income is left.')}</p>
      <div className="budget-cols">
        {(['Needs', 'Wants'] as const).map((bucket) => (
          <div key={bucket} className="budget-col" data-bucket={bucket}>
            <div className="budget-col-head">{t(bucket)}</div>
            <div className="budget-chip-list">
              {cols[bucket].map((cat) => (
                <button key={cat} type="button" className={`budget-chip ${bucket.toLowerCase()}`} onClick={() => flip(cat)}>
                  {cat}
                </button>
              ))}
              {cols[bucket].length === 0 && <span className="muted" style={{ fontSize: 12 }}>—</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── small helpers ─────────────────────────────────────────────────────────────
function money(n: number, censor: boolean): string {
  return censor ? '•••' : fmt(n)
}
// "01 Jul" from an ISO date.
function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}
