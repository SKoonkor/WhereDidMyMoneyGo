import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget, saveBudget } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useCategories, useBaseCurrency } from '../transactions/useConfig'
import { useCensor } from '../../prefs'
import { currentMonthKey, monthLabel } from '../transactions/month'
import { limitStatuses, monthWindow, type LimitStatus } from '../../lib/analytics/budget'
import type { BudgetCfg, SpendingLimits } from '../../data/defaults'
import { useHold } from '../../lib/useHold'
import { Modal } from '../../components/Modal'
import { t, tBilingual } from '../../i18n'
import { NumberField } from '../../components/NumberField'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

// What the amount modal is editing: a whole category, or one subcategory.
type Target = { category: string; sub?: string }

export function LimitsPage() {
  const all = useLiveTxns()
  const cfg = useLiveQuery(() => getBudget(), [])
  const categories = useCategories()
  const currency = useBaseCurrency()
  const [censor] = useCensor()
  const [editing, setEditing] = useState<Target | null>(null)

  const month = currentMonthKey()
  const [start, end] = monthWindow(month)

  const statuses = useMemo(
    () => (cfg ? limitStatuses(all, cfg.limits, start, end) : []),
    [all, cfg, start, end],
  )

  if (!cfg) return <p className="muted">{t('Loading…')}</p>

  const save = (limits: SpendingLimits) => void saveBudget({ ...cfg, limits })

  const limitFor = ({ category, sub }: Target): number | undefined =>
    (sub === undefined ? cfg.limits.categories[category] : cfg.limits.subcategories[category]?.[sub])

  // Writing a limit of 0 or less removes it, matching normalizeLimits.
  const setLimit = ({ category, sub }: Target, amount: number | null) => {
    const next: SpendingLimits = {
      ...cfg.limits,
      categories: { ...cfg.limits.categories },
      subcategories: { ...cfg.limits.subcategories },
    }
    if (sub === undefined) {
      if (amount && amount > 0) next.categories[category] = amount
      else delete next.categories[category]
    } else {
      const map = { ...(next.subcategories[category] ?? {}) }
      if (amount && amount > 0) map[sub] = amount
      else delete map[sub]
      if (Object.keys(map).length) next.subcategories[category] = map
      else delete next.subcategories[category]
    }
    save(next)
  }

  return (
    <div>
      <h1 className="h1">{tBilingual('Spending limits')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 4 }}>
        {t('Cap what you spend per category.')}
      </p>
      <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 14 }}>
        {t('This period: {month}', { month: monthLabel(month) })}
      </p>

      <WarnAtField cfg={cfg} save={save} currency={currency} />

      <LimitBoard
        expense={categories.expense}
        limits={cfg.limits}
        onPick={(target) => setEditing(target)}
      />

      <section className="card budget-card">
        <div className="dash-title">{t('Your limits')}</div>
        {statuses.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t('No limits set yet.')}</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              {t('A category limit covers everything in it, including its sub-categories.')}
            </p>
            {statuses.map((s) => (
              <LimitRow key={s.key} status={s} warnAt={cfg.limits.warnAt} censor={censor} currency={currency} />
            ))}
          </>
        )}
      </section>

      {editing && (
        <AmountModal
          target={editing}
          current={limitFor(editing)}
          currency={currency}
          onSave={(amount) => { setLimit(editing, amount); setEditing(null) }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ── The readout ──────────────────────────────────────────────────────────────

function LimitRow({ status, warnAt, censor, currency }: {
  status: LimitStatus; warnAt: number; censor: boolean; currency: string
}) {
  const width = Math.min(100, Math.max(0, status.ratio * 100))
  const over = status.remaining < 0
  // The bar colour is a ratio while the alert rule is an absolute headroom, so a
  // small limit can be green and still be nudging. Mark those rows rather than
  // introducing a second colour scheme for them.
  const nudging = status.remaining <= warnAt
  const amount = censor ? '•••' : fmt(Math.abs(status.remaining))
  return (
    <div className="budget-row limit-row">
      <div className="budget-row-head">
        <span className="budget-row-name">
          {nudging && <span className="limit-warn" aria-hidden="true">⚠ </span>}
          {status.label}
        </span>
        <span className="budget-row-note">
          <span className={over ? 'amt-expense' : ''} style={{ fontWeight: 600 }}>
            <span className="money">{amount}</span> {t(over ? 'over' : 'left')}
          </span>
          {' · '}
          <span className="money">{censor ? '•••' : fmt(status.limit)}</span> {currency}
        </span>
      </div>
      <div className="budget-bar">
        <div className={`budget-bar-fill ${status.tone}`} style={{ width: `${width.toFixed(0)}%` }} />
      </div>
    </div>
  )
}

// ── Alert threshold ──────────────────────────────────────────────────────────

function WarnAtField({ cfg, save, currency }: {
  cfg: BudgetCfg; save: (l: SpendingLimits) => void; currency: string
}) {
  // Free-text while typing, clamped on blur — so the field can be cleared and
  // retyped instead of snapping back on every keystroke.
  const [val, setVal] = useState(String(cfg.limits.warnAt))
  useEffect(() => { setVal(String(cfg.limits.warnAt)) }, [cfg.limits.warnAt])

  const commit = () => {
    const n = Math.max(0, Math.round(Number(val) || 0))
    setVal(String(n))
    if (n !== cfg.limits.warnAt) save({ ...cfg.limits, warnAt: n })
  }

  return (
    <section className="card budget-card">
      <div className="dash-title">{t('Alert threshold')}</div>
      <div className="set-field">
        <label htmlFor="warn-at">{t('Warn me when a limit has this much left')} ({currency})</label>
        <NumberField
          id="warn-at" mode="calc"
          label={`${t('Warn me when a limit has this much left')} (${currency})`}
          value={val}
          onChange={setVal}
          onBlur={commit}
          style={{ maxWidth: 120 }}
        />
        <span className="set-hint">{t('Applies to every limit below.')}</span>
      </div>
    </section>
  )
}

// ── The board ────────────────────────────────────────────────────────────────

type Chip =
  | { kind: 'cat'; cat: string; key: string; limit?: number; hasSubs: boolean }
  | { kind: 'sub'; cat: string; sub: string; key: string; limit: number }

// Categories and sub-categories split into "with a limit" / "no limit". Setting
// one moves the chip across, which is the same feedback the Needs/Wants board
// gives. Hold to set an amount; tap a category for its sub-categories.
function LimitBoard({ expense, limits, onPick }: {
  expense: Record<string, string[]>
  limits: SpendingLimits
  onPick: (target: Target) => void
}) {
  // One inline sub-cat strip open at a time. `mounted`/`shown` keep the strip in
  // the DOM through the collapse transition (mirrors BucketBoard).
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

  const cols: Record<'set' | 'unset', Chip[]> = { set: [], unset: [] }
  for (const cat of Object.keys(expense)) {
    const limit = limits.categories[cat]
    cols[limit ? 'set' : 'unset'].push({
      kind: 'cat', cat, key: `c:${cat}`, limit, hasSubs: (expense[cat]?.length ?? 0) > 0,
    })
  }
  // Sub-limits only ever sit in the "with a limit" column — an unlimited
  // sub-category is reachable through its parent's strip.
  for (const [cat, subs] of Object.entries(limits.subcategories)) {
    for (const [sub, limit] of Object.entries(subs)) {
      cols.set.push({ kind: 'sub', cat, sub, key: `s:${cat}/${sub}`, limit })
    }
  }

  const toggleExpand = (cat: string) => setExpanded((cur) => (cur === cat ? null : cat))

  return (
    <section className="card budget-card">
      <div className="dash-title">{t('Set a limit')}</div>
      <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
        {t('Hold a category to set its limit · tap for sub-categories.')}
      </p>
      <div className="budget-cols">
        {(['set', 'unset'] as const).map((col) => (
          <div key={col} className="budget-col">
            <div className="budget-col-head">{t(col === 'set' ? 'With a limit' : 'No limit')}</div>
            <div className="budget-chip-list">
              {cols[col].map((chip) =>
                chip.kind === 'cat' ? (
                  <LimitChip
                    key={chip.key}
                    label={chip.cat}
                    limit={chip.limit}
                    hasSubs={chip.hasSubs}
                    expanded={expanded === chip.cat}
                    onHold={() => onPick({ category: chip.cat })}
                    onTap={chip.hasSubs ? () => toggleExpand(chip.cat) : undefined}
                  />
                ) : (
                  <LimitChip
                    key={chip.key}
                    label={`${chip.cat}:${chip.sub}`}
                    limit={chip.limit}
                    isSub
                    onHold={() => onPick({ category: chip.cat, sub: chip.sub })}
                    onTap={() => toggleExpand(chip.cat)}
                  />
                ),
              )}
              {cols[col].length === 0 && <span className="muted" style={{ fontSize: 12 }}>—</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Inline sub-cat strip for the tapped category. */}
      <div className={shown ? 'budget-subwrap open' : 'budget-subwrap'}>
        <div className="budget-subgrid">
          {mounted && (
            <>
              <div className="budget-substrip-head muted">
                {mounted} · {t('Hold a sub-category to set its limit')}
              </div>
              <div className="budget-chip-list">
                {(expense[mounted] ?? []).map((sub) => (
                  <LimitChip
                    key={sub}
                    label={sub}
                    limit={limits.subcategories[mounted]?.[sub]}
                    isSub
                    onHold={() => onPick({ category: mounted, sub })}
                  />
                ))}
                {(expense[mounted]?.length ?? 0) === 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>—</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function LimitChip({ label, limit, hasSubs, expanded, isSub, onHold, onTap }: {
  label: string
  limit?: number
  hasSubs?: boolean
  expanded?: boolean
  isSub?: boolean
  onHold: () => void
  onTap?: () => void
}) {
  const hold = useHold(onHold, onTap)
  return (
    <button
      type="button"
      className={`budget-chip${limit ? ' has-limit' : ''}${isSub ? ' sub' : ''}${hold.pressing ? ' pressing' : ''}`}
      onPointerDown={hold.onPointerDown}
      onPointerUp={hold.onPointerUp}
      onPointerLeave={hold.onPointerLeave}
      onPointerCancel={hold.onPointerCancel}
      onClick={hold.onClick}
    >
      {label}
      {limit ? <span className="budget-chip-amt">{fmt(limit)}</span> : null}
      {hasSubs && <span className="cat-caret">{expanded ? '▴' : '▾'}</span>}
    </button>
  )
}

// ── Amount editor ────────────────────────────────────────────────────────────

function AmountModal({ target, current, currency, onSave, onClose }: {
  target: Target
  current?: number
  currency: string
  onSave: (amount: number | null) => void
  onClose: () => void
}) {
  const [val, setVal] = useState(current ? String(current) : '')
  const name = target.sub ? `${target.category} / ${target.sub}` : target.category

  const commit = () => {
    const n = Math.round(Number(val) || 0)
    onSave(n > 0 ? n : null)
  }

  return (
    <Modal title={t('Limit for {name}', { name })} onClose={onClose}>
      <div className="set-field">
        <label htmlFor="limit-amt">{t('Monthly limit')} ({currency})</label>
        <NumberField
          id="limit-amt" mode="calc"
          label={`${t('Monthly limit')} (${currency})`}
          value={val}
          onChange={setVal}
          // Claimed before the pad can read Enter as `=`.
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          placeholder="0"
        />
      </div>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        {current !== undefined && (
          <button type="button" className="btn danger" onClick={() => onSave(null)}>
            {t('Remove limit')}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
        <button type="button" className="btn btn-accent" onClick={commit}>{t('Save')}</button>
      </div>
    </Modal>
  )
}
