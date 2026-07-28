import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getGoals } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useSettings } from '../transactions/useConfig'
import { EMERGENCY_FUND } from '../../data/defaults'
import { savingsBalance } from '../../lib/analytics/goals'
import {
  goalStandings, unallocatedAmount, type GoalMove, type GoalStanding,
} from '../../lib/analytics/goalSavings'

export interface GoalSavings {
  /** Real money in the savings accounts — the same figure the pool gauge shows. */
  poolBalance: number
  /** Pool minus every goal's share. Negative once money left without being un-earmarked. */
  unallocated: number
  /** Emergency Fund first, then the goals in the user's own drag order. */
  standings: GoalStanding[]
  moves: GoalMove[]
  currency: string
}

// Live goal-allocation standing. One hook behind the Goal savings page, both Home
// widgets and the Home warning banner, so they can never disagree about what is
// earmarked. Returns null until the goals config loads.
export function useGoalSavings(): GoalSavings | null {
  const all = useLiveTxns()
  const settings = useSettings()
  const cfg = useLiveQuery(() => getGoals(), [])
  const moves = useLiveQuery(() => db.goalMoves.toArray(), [])

  return useMemo(() => {
    if (!cfg || !moves) return null
    const poolBalance = savingsBalance(all, settings.savingsAccounts)
    const efTarget = settings.monthlyRequired * settings.targetMonths
    return {
      poolBalance,
      unallocated: unallocatedAmount(poolBalance, moves),
      standings: goalStandings(moves, cfg.goals, efTarget, EMERGENCY_FUND),
      moves,
      currency: settings.baseCurrency,
    }
  }, [all, settings, cfg, moves])
}
