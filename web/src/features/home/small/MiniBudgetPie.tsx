import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget } from '../../../db'
import { useLiveTxns } from '../../useLiveTxns'
import { currentMonthKey } from '../../transactions/month'
import { budgetIncome, monthPieData, ratioTone } from '../../../lib/analytics/budget'
import { TONE_COLOR } from '../../budget/tone'
import { Ring } from './Ring'
import { t } from '../../../i18n'

// How much of this month's budget has been spent, as a ring. Same numbers as the
// full Budget donut (budgetIncome → monthPieData); only the drawing differs.
export function MiniBudgetPie() {
  const all = useLiveTxns()
  const cfg = useLiveQuery(() => getBudget(), [])
  const pie = useMemo(() => {
    if (!cfg) return null
    const income = budgetIncome(all, cfg)
    return monthPieData(all, currentMonthKey(), income, cfg.assignments, cfg.subAssignments)
  }, [all, cfg])
  if (!pie) return null

  const pct = pie.budget > 0 ? (pie.total / pie.budget) * 100 : 0
  return (
    <>
      <div className="small-slot-title">{t('Budget used')}</div>
      <div className="small-slot-body">
        <Ring
          pct={pct}
          color={TONE_COLOR[ratioTone(pie.total, pie.budget)]}
          label={`${Math.round(pct)}%`}
          ariaLabel={t('{pct}% of budget', { pct: Math.round(pct) })}
        />
      </div>
      <div className="small-slot-note">{t('of budget')}</div>
    </>
  )
}
