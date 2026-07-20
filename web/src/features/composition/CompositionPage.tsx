import { useMemo, useState } from 'react'
import { useLiveTxns } from '../useLiveTxns'
import { useBaseCurrency } from '../transactions/useConfig'
import { useTheme, useCensor } from '../../prefs'
import { addMonths, currentMonthKey, monthLabel, filterByMonth } from '../transactions/month'
import { categoryBreakdown, hiddenCost, sliceTotal, HIDDEN_LABEL } from '../../lib/analytics/composition'
import { buildDonutFigure, buildBarsFigure, type UiColors } from './figure'
import { Plot } from '../../components/Plot'
import { t } from '../../i18n'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

type View = 'pie' | 'bars'

export function CompositionPage() {
  const all = useLiveTxns()
  const currency = useBaseCurrency()
  const [theme] = useTheme()
  const [censor] = useCensor()
  const [month, setMonth] = useState(currentMonthKey())
  const [view, setView] = useState<View>('pie')

  const monthTxns = useMemo(() => filterByMonth(all, month), [all, month])
  const income = useMemo(() => categoryBreakdown(monthTxns, 'Income', 12, t('Other')), [monthTxns])
  // Append the reconciliation "Hidden cost" as an extra Expense slice (0 until
  // Reconcile writes Adjustment rows, so it simply doesn't appear before then).
  const expense = useMemo(() => {
    const base = categoryBreakdown(monthTxns, 'Expense', 12, t('Other'))
    const hidden = hiddenCost(monthTxns)
    return hidden > 0 ? [...base, { category: t(HIDDEN_LABEL), amount: hidden, hidden: true }] : base
  }, [monthTxns])

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

  const empty = income.length === 0 && expense.length === 0

  return (
    <div>
      <h1 className="h1">{t('Income & Expense')}</h1>

      <div className="month-nav">
        <button className="tool-btn" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">‹</button>
        <span className="month-label">{monthLabel(month)}</span>
        <button className="tool-btn" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">›</button>
      </div>

      <div className="seg">
        {(['pie', 'bars'] as View[]).map((v) => (
          <button key={v} type="button" className={v === view ? 'seg-btn active' : 'seg-btn'} onClick={() => setView(v)}>
            {t(v === 'pie' ? 'Pie' : 'Bars')}
          </button>
        ))}
      </div>

      {empty ? (
        <p className="muted" style={{ marginTop: 20 }}>{t('No transactions this month')}</p>
      ) : (
        <div className="compo-split">
          <div className="card compo-panel">
            <div className="dash-title" style={{ color: 'var(--income)' }}>{t('Income')}</div>
            <Plot data={figs.income.data} layout={figs.income.layout} ariaLabel={t('Income')} style={{ width: '100%' }} />
          </div>
          <div className="card compo-panel">
            <div className="dash-title" style={{ color: 'var(--expense)' }}>{t('Expense')}</div>
            <Plot data={figs.expense.data} layout={figs.expense.layout} ariaLabel={t('Expense')} style={{ width: '100%' }} />
          </div>
        </div>
      )}
    </div>
  )
}
