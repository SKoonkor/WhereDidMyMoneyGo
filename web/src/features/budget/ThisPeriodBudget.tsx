import {
  bucketTone, NEEDS, WANTS, SAVINGS, type BudgetSummary,
} from '../../lib/analytics/budget'
import type { Bucket } from '../../data/defaults'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
function money(n: number, censor: boolean): string {
  return censor ? '•••' : fmt(n)
}
// "01 Jul" from an ISO date.
function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

const BUCKET_ORDER: Bucket[] = [NEEDS, WANTS, SAVINGS]

// The "This period" 50/30/20 summary (income line + Needs/Wants/Savings bars).
// Presentational — the caller supplies the summary (BudgetPage varies the month;
// Home passes the current month). Pure CSS bars, no Plotly.
export function ThisPeriodBudget({ summary, censor }: { summary: BudgetSummary; censor: boolean }) {
  return (
    <>
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
    </>
  )
}
