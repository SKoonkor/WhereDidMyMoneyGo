import { useMemo } from 'react'
import { useLiveTxns } from '../../useLiveTxns'
import { currentMonthKey, filterByMonth, monthSummary } from '../../transactions/month'
import { t } from '../../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

// This month's income and spend. The transactions page has a similar strip, but
// it carries a third "Net" column and a different layout — not worth sharing.
export function MiniInOut() {
  const all = useLiveTxns()
  const s = useMemo(() => monthSummary(filterByMonth(all, currentMonthKey())), [all])
  return (
    <>
      <div className="small-slot-title">{t('This month')}</div>
      <div className="mini-inout">
        <div className="mini-inout-label">{t('Income')}</div>
        <div className="mini-inout-value amt-income money">{fmt(s.income)}</div>
        <div className="mini-inout-label">{t('Output')}</div>
        <div className="mini-inout-value amt-expense money">{fmt(s.expense)}</div>
      </div>
    </>
  )
}
