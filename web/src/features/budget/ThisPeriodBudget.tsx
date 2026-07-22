import {
  bucketTone, NEEDS, WANTS, SAVINGS, type BudgetSummary,
} from '../../lib/analytics/budget'
import type { Bucket } from '../../data/defaults'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
function money(n: number, censor: boolean): string {
  return censor ? '•••' : fmt(n)
}
// "01 Jul" (no year) or "01 Aug 2026" (with year) from an ISO date. Composed
// day-first explicitly so the order holds regardless of the device locale.
function dayLabel(isoDate: string, withYear = false): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const mon = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short' })
  const day = String(d).padStart(2, '0')
  return withYear ? `${day} ${mon} ${y}` : `${day} ${mon}`
}

const BUCKET_ORDER: Bucket[] = [NEEDS, WANTS, SAVINGS]

// The "This period" 50/30/20 summary (income line + Needs/Wants/Savings bars).
// Presentational — the caller supplies the summary (BudgetPage varies the month;
// Home passes the current month). Pure CSS bars, no Plotly.
// `hidePeriodLabel` drops the leading "THIS PERIOD :" — used on Home, where the
// box already has a "BUDGET" header, so the label would be redundant.
export function ThisPeriodBudget({ summary, censor, hidePeriodLabel }: { summary: BudgetSummary; censor: boolean; hidePeriodLabel?: boolean }) {
  const modeText = summary.mode === 'rolling'
    ? t('{n} months rolling average', { n: summary.rollingMonths })
    : t('fixed')
  const vars = {
    start: dayLabel(summary.start),
    end: dayLabel(summary.end, true),
    income: censor ? '•••' : fmt(summary.income),
    mode: modeText,
  }
  return (
    <>
      <p className="muted budget-period" style={{ fontSize: 13, margin: '0 0 8px' }}>
        {hidePeriodLabel
          ? t('{start} - {end}  |  Income : {income} ({mode})', vars)
          : t('THIS PERIOD : {start} - {end}  |  Income : {income} ({mode})', vars)}
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
    </>
  )
}
