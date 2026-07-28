import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget } from '../../../db'
import { useLiveTxns } from '../../useLiveTxns'
import { currentMonthKey } from '../../transactions/month'
import { bucketTone, monthBudgetSummary, NEEDS, WANTS, SAVINGS } from '../../../lib/analytics/budget'
import type { Bucket } from '../../../data/defaults'
import { compactAmount } from '../../../lib/format'
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
      <div className="mini-bars small-slot-body">
        {BUCKET_ORDER.map((name) => {
          const b = summary.buckets[name]
          const raw = b.target ? (b.spent / b.target) * 100 : 0
          const width = Math.min(100, Math.max(0, raw))
          const tone = bucketTone(name, b.spent, b.target)
          return (
            // The bars are always Needs / Wants / Savings in that order, so the
            // row keeps no label — the width the amount needs is worth more.
            <div key={name} className="mini-bar-row">
              <div className="budget-bar mini-bar">
                <div className={`budget-bar-fill ${tone}`} style={{ width: `${width.toFixed(0)}%` }} />
              </div>
              {/* What's left, not what's spent — negative once it's overspent. */}
              <span className={`mini-bar-amt money ${tone}`}>{compactAmount(b.remaining)}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
