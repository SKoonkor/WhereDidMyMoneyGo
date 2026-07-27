import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getGoals } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useSettings } from '../transactions/useConfig'
import { emergencyFundStatus, poolTarget } from '../../lib/analytics/goals'

export const MONTHS_CAP = 6

export interface SavingsPool {
  /** What's actually in the savings accounts. */
  balance: number
  /** Emergency Fund target plus every goal ticked on the Financial Goals page. */
  pooled: number
  /** balance / pooled, capped at 100. */
  pct: number
  /** How many months of required spending the balance covers, capped at MONTHS_CAP. */
  months: number
  monthsCapped: boolean
  /** Names of the ticked goals that still exist. */
  selected: string[]
  currency: string
}

// Shared derivation behind both the full Savings Pool gauge and its small
// preview tile, so the two can never disagree. Returns null until the goals
// config loads.
export function useSavingsPool(): SavingsPool | null {
  const all = useLiveTxns()
  const settings = useSettings()
  const cfg = useLiveQuery(() => getGoals(), [])

  return useMemo(() => {
    if (!cfg) return null
    const selected = cfg.selected.filter((g) => g in cfg.goals)
    const efTarget = settings.monthlyRequired * settings.targetMonths
    const pooled = poolTarget(efTarget, cfg.goals, selected, cfg.factors)
    const ef = emergencyFundStatus(
      all, settings.savingsAccounts, settings.monthlyRequired, settings.targetMonths)
    const balance = ef.currentBalance
    const raw = settings.monthlyRequired > 0 ? balance / settings.monthlyRequired : 0
    return {
      balance,
      pooled,
      pct: Math.min((balance / Math.max(pooled, 1)) * 100, 100),
      months: Math.min(raw, MONTHS_CAP),
      monthsCapped: raw >= MONTHS_CAP,
      selected,
      currency: settings.baseCurrency,
    }
  }, [cfg, all, settings])
}
