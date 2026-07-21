import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useLiveTxns } from '../useLiveTxns'
import { useBaseCurrency } from '../transactions/useConfig'
import { useTheme, useCensor } from '../../prefs'
import { getBudget } from '../../db'
import { filterByRange, latestPeriod, addDays } from '../transactions/month'
import {
  categoryBreakdown, expenseBucketBreakdown, subcategoryBreakdown,
  hiddenCost, sliceTotal, HIDDEN_LABEL, type CatGroup,
} from '../../lib/analytics/composition'
import { buildDonutFigure, buildBarsFigure, type UiColors } from './figure'
import { Plot } from '../../components/Plot'
import { Modal } from '../../components/Modal'
import { t } from '../../i18n'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

type View = 'pie' | 'bars'
type Sort = 'amount' | 'bucket'

// Relative-window presets (days back from the latest entry); 'all' and 'custom'
// are handled separately.
const PRESETS: { key: string; label: string; days?: number }[] = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 3 months', days: 90 },
  { key: '180', label: 'Last 6 months', days: 180 },
  { key: '365', label: 'Last year', days: 365 },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Selected period' },
]

// One side's category → subcategory list inside the expandable summary.
function CatColumn({ title, color, groups, censor, currency }: {
  title: string; color: string; groups: CatGroup[]; censor: boolean; currency: string
}) {
  const money = (n: number) => (censor ? '*****' : fmt(n))
  return (
    <div className="compo-cat-col">
      <h4 className="compo-cat-h" style={{ color }}>{title}</h4>
      {groups.length === 0 ? (
        <div className="muted">{t('No data')}</div>
      ) : (
        groups.map((g) => (
          <div key={g.category}>
            <div className="subcat-group">
              <span className="subcat-name">{g.category}</span>
              <span className="subcat-amt">{money(g.total)} {currency}</span>
            </div>
            {!(g.subs.length === 1 && g.subs[0].name === '—') &&
              g.subs.map((s) => (
                <div key={s.name} className="subcat-row">
                  <span className="subcat-name">{s.name}</span>
                  <span className="subcat-amt">
                    {money(s.amount)} ({g.total ? Math.round((s.amount / g.total) * 100) : 0}%)
                  </span>
                </div>
              ))}
          </div>
        ))
      )}
    </div>
  )
}

export function CompositionPage() {
  const all = useLiveTxns()
  const currency = useBaseCurrency()
  const [theme] = useTheme()
  const [censor] = useCensor()
  const budget = useLiveQuery(() => getBudget(), [])
  const [view, setView] = useState<View>('pie')
  const [sort, setSort] = useState<Sort>('amount')
  const [preset, setPreset] = useState('30')
  const [periodOpen, setPeriodOpen] = useState(false)

  const ref = useMemo(() => latestPeriod(all), [all])
  const [customStart, setCustomStart] = useState(() => addDays(latestPeriod(all), -120))
  const [customEnd, setCustomEnd] = useState(() => latestPeriod(all))

  const { start, end } = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd }
    if (preset === 'all') return { start: '0000-01-01', end: ref }
    const days = PRESETS.find((p) => p.key === preset)?.days ?? 30
    return { start: addDays(ref, -days), end: ref }
  }, [preset, customStart, customEnd, ref])

  const rangeTxns = useMemo(() => filterByRange(all, start, end), [all, start, end])

  const income = useMemo(() => categoryBreakdown(rangeTxns, 'Income', 12, t('Other')), [rangeTxns])
  const expense = useMemo(() => {
    const base = sort === 'bucket' && budget
      ? expenseBucketBreakdown(rangeTxns, budget.assignments, 8, t('Other'))
      : categoryBreakdown(rangeTxns, 'Expense', 12, t('Other'))
    const hidden = hiddenCost(rangeTxns)
    return hidden > 0 ? [...base, { category: t(HIDDEN_LABEL), amount: hidden, hidden: true }] : base
  }, [rangeTxns, sort, budget])

  // Needs/Wants subtotals for the caption under the Expense chart (bucket sort).
  const buckets = useMemo(() => {
    if (sort !== 'bucket') return null
    let needs = 0
    let wants = 0
    for (const s of expense) {
      if (s.hidden) wants += s.amount // hidden cost counts toward Wants (as on Budget)
      else if (s.bucket === 'Needs') needs += s.amount
      else wants += s.amount
    }
    return { needs, wants, exp: needs + wants }
  }, [sort, expense])

  const ui: UiColors = useMemo(
    () => ({
      ink: cssVar('--ink', '#e6e9ee'),
      muted: cssVar('--muted', '#8a94a6'),
      grid: cssVar('--border-soft', 'rgba(128,128,128,0.2)'),
    }),
    [theme],
  )

  const figs = useMemo(() => {
    const noData = t('No data')
    if (view === 'pie') {
      return {
        income: buildDonutFigure(income, { total: sliceTotal(income), currency, kind: 'income', censor, ui, noData }),
        expense: buildDonutFigure(expense, { total: sliceTotal(expense), currency, kind: 'expense', censor, ui, noData }),
      }
    }
    return {
      income: buildBarsFigure(income, { currency, kind: 'income', censor, ui, noData }),
      expense: buildBarsFigure(expense, { currency, kind: 'expense', censor, ui, noData }),
    }
  }, [view, income, expense, currency, censor, ui])

  const incomeCats = useMemo(() => subcategoryBreakdown(rangeTxns, 'Income'), [rangeTxns])
  const expenseCats = useMemo(() => subcategoryBreakdown(rangeTxns, 'Expense'), [rangeTxns])

  const empty = income.length === 0 && expense.length === 0
  const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–')

  return (
    <div>
      <h1 className="h1">{t('Income & Expense')}</h1>

      <div className="card compo-controls">
        <div className="compo-row">
          <span className="muted">{t('Select period')}</span>
          <button type="button" className="pick-summary" onClick={() => setPeriodOpen(true)}>
            <span>{t(PRESETS.find((p) => p.key === preset)?.label ?? 'Last 30 days')}</span>
            <span className="pick-summary-arrow">›</span>
          </button>
        </div>

        {preset === 'custom' && (
          <div className="compo-dates">
            <div className="field">
              <label>{t('Start date')}</label>
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => {
                  const v = e.target.value
                  setCustomStart(v)
                  if (v > customEnd) setCustomEnd(v) // keep End ≥ Start
                }}
              />
            </div>
            <div className="field">
              <label>{t('End date')}</label>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                onChange={(e) => {
                  const v = e.target.value
                  setCustomEnd(v < customStart ? customStart : v) // clamp End ≥ Start
                }}
              />
            </div>
          </div>
        )}

        <div className="compo-row compo-sort">
          <span className="muted">{t('Sort expenses')}</span>
          <div className="seg">
            {(['amount', 'bucket'] as Sort[]).map((s) => (
              <button key={s} type="button" className={s === sort ? 'seg-btn active' : 'seg-btn'} onClick={() => setSort(s)}>
                {t(s === 'amount' ? 'By amount' : 'By Needs/Wants')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {periodOpen && (
        <Modal title={t('Select period')} onClose={() => setPeriodOpen(false)}>
          <div className="pick-list">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={p.key === preset ? 'pick-cell on' : 'pick-cell'}
                onClick={() => { setPreset(p.key); setPeriodOpen(false) }}
              >
                {t(p.label)}
              </button>
            ))}
          </div>
        </Modal>
      )}

      <div className="seg compo-view-seg">
        {(['pie', 'bars'] as View[]).map((v) => (
          <button key={v} type="button" className={v === view ? 'seg-btn active' : 'seg-btn'} onClick={() => setView(v)}>
            {t(v === 'pie' ? 'Pie' : 'Bars')}
          </button>
        ))}
      </div>

      {empty ? (
        <p className="muted" style={{ marginTop: 20 }}>{t('No data')}</p>
      ) : (
        <div className={view === 'pie' ? 'compo-split pie' : 'compo-split'}>
          <div className="card compo-panel">
            <div className="dash-title" style={{ color: 'var(--income)' }}>{t('Income')}</div>
            <Plot data={figs.income.data} layout={figs.income.layout} ariaLabel={t('Income')} style={{ width: '100%' }} />
          </div>
          <div className="card compo-panel">
            <div className="dash-title" style={{ color: 'var(--expense)' }}>{t('Expense')}</div>
            <Plot data={figs.expense.data} layout={figs.expense.layout} ariaLabel={t('Expense')} style={{ width: '100%' }} />
            {buckets && (
              <div className="compo-buckets muted">
                <div className="compo-buckets-line">
                  <span className="nowrap">
                    <b style={{ color: '#3b7dd8' }}>{t('Needs')}</b> {pct(buckets.needs, buckets.exp)}
                  </span>
                  {' | '}
                  <span className="nowrap">
                    <b style={{ color: '#e07b39' }}>{t('Wants')}</b> {pct(buckets.wants, buckets.exp)}
                  </span>
                </div>
                <div>{t('of expense')}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <details className="compo-cats">
        <summary className="subcat-summary">{t('Category breakdown')}</summary>
        <div className="compo-cats-grid">
          <CatColumn title={t('Income')} color="var(--income)" groups={incomeCats} censor={censor} currency={currency} />
          <CatColumn title={t('Expense')} color="var(--expense)" groups={expenseCats} censor={censor} currency={currency} />
        </div>
      </details>
    </div>
  )
}
