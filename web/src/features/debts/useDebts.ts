import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget, getDebts, getSettings } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { budgetIncome, type Tone } from '../../lib/analytics/budget'
import {
  debtServiceRatio,
  debtStandings,
  dsrTone,
  monthlyObligation,
  payoffOrder,
  totalOwed,
  weightedApr,
  type DebtStanding,
} from '../../lib/analytics/debt'
import type { DebtsCfg } from '../../data/defaults'

export interface DebtsView {
  cfg: DebtsCfg
  /** In the user's configured order — what the list shows. */
  standings: DebtStanding[]
  /** In the active strategy's order — what the rank badges and the plan use. */
  ranked: DebtStanding[]
  owed: number
  obligation: number
  /** Monthly income, straight from the Budget page's own setting. */
  income: number
  dsr: number
  tone: Tone
  apr: number
  currency: string
}

// Everything the Debts page and its widgets need, assembled once.
//
// Income comes from `budgetIncome` rather than a field of its own: the user has
// already told the Budget page whether their income is a fixed figure or a rolling
// average of the ledger, and a debt ratio that disagreed with the budget bars
// would just be a second answer to the same question.
//
// `undefined` until the config loads, so callers can tell "no debts yet" apart
// from "not read yet" — the same contract useGoalSavings has.
export function useDebts(): DebtsView | undefined {
  const cfg = useLiveQuery(() => getDebts(), [])
  const budget = useLiveQuery(() => getBudget(), [])
  const settings = useLiveQuery(() => getSettings(), [])
  const txns = useLiveTxns()
  // Pinned for the life of the page: a fresh Date every render would rebuild every
  // derived balance on every keystroke, and nothing here turns on the second hand.
  const today = useMemo(() => new Date(), [])

  return useMemo(() => {
    if (!cfg || !budget || !settings) return undefined
    const standings = debtStandings(cfg, txns, today)
    const obligation = monthlyObligation(standings)
    const income = budgetIncome(txns, budget, today)
    const dsr = debtServiceRatio(obligation, income)
    return {
      cfg,
      standings,
      ranked: payoffOrder(standings, cfg.strategy),
      owed: totalOwed(standings),
      obligation,
      income,
      dsr,
      tone: dsrTone(dsr),
      apr: weightedApr(standings),
      currency: settings.baseCurrency,
    }
  }, [cfg, budget, settings, txns, today])
}
