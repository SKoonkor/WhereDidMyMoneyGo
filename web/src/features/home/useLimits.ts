import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { currentMonthKey } from '../transactions/month'
import { limitStatuses, monthWindow, type LimitStatus } from '../../lib/analytics/budget'

export interface Limits {
  /** Closest to the limit first. */
  statuses: LimitStatus[]
  warnAt: number
}

// This month's spending-limit standing. One hook behind the Home widget, the
// small tile, the Home banner and the alert, so they can never disagree about
// what's near its cap. Returns null until the budget config loads.
export function useLimits(): Limits | null {
  const all = useLiveTxns()
  const cfg = useLiveQuery(() => getBudget(), [])

  return useMemo(() => {
    if (!cfg) return null
    const [start, end] = monthWindow(currentMonthKey())
    return { statuses: limitStatuses(all, cfg.limits, start, end), warnAt: cfg.limits.warnAt }
  }, [all, cfg])
}
