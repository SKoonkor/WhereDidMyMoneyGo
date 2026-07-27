import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget } from '../../../db'
import { useLiveTxns } from '../../useLiveTxns'
import { currentMonthKey } from '../../transactions/month'
import { bucketTone, monthBudgetSummary, NEEDS, WANTS, SAVINGS } from '../../../lib/analytics/budget'
import type { Bucket } from '../../../data/defaults'
import { t } from '../../../i18n'

const BUCKET_ORDER: Bucket[] = [NEEDS, WANTS, SAVINGS]

// The 50/30/20 bars stripped to what survives at ~108px: a short label, the bar,
// and the percentage. Deliberately a sibling of ThisPeriodBudget rather than a
// `compact` branch inside it — none of that component's amounts, period line or
// "X left / X over" wording fits here, so sharing the function would just be two
// disjoint trees. What matters is shared: the summary, the tone, and the CSS.
export function MiniBudgetBars() {
  const all = useLiveTxns()
  const bcfg = useLiveQuery(() => getBudget(), [])
  const summary = useMemo(
    () => (bcfg ? monthBudgetSummary(all, bcfg, currentMonthKey()) : null),
    [all, bcfg],
  )
  if (!summary) return null

  return (
    <>
      <div className="small-slot-title">{t('Budget')}</div>
      <div className="mini-bars">
        {BUCKET_ORDER.map((name) => {
          const b = summary.buckets[name]
          const raw = b.target ? (b.spent / b.target) * 100 : 0
          const width = Math.min(100, Math.max(0, raw))
          return (
            <div key={name} className="mini-bar-row">
              <span className="mini-bar-name">{t(name).slice(0, 1)}</span>
              <div className="budget-bar mini-bar">
                <div className={`budget-bar-fill ${bucketTone(name, b.spent, b.target)}`}
                  style={{ width: `${width.toFixed(0)}%` }} />
              </div>
              <span className="mini-bar-pct">{Math.round(raw)}%</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
