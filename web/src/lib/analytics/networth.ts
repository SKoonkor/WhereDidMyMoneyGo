// Net worth = the sum of every account's balance. Transfers net to zero across
// accounts, so net worth only moves with real income/expense/adjustments.
// Builds on balances.ts (port of src/processing/balances.py).
import { signedAmount } from '../balances'
import type { Txn } from '../../db'
import { monthKeyOf, addMonths, currentMonthKey } from '../../features/transactions/month'

export function netWorth(txns: Txn[]): number {
  return txns.reduce((s, t) => s + signedAmount(t.type, t.amount), 0)
}

export interface TrendPoint { month: string; value: number }

// Net worth at the end of each of the last `months` months (oldest → newest),
// as a cumulative running total. Month keys sort lexicographically (YYYY-MM), so
// "everything up to and including month m" is a simple `<=` compare.
export function netWorthTrend(txns: Txn[], months = 6): TrendPoint[] {
  const end = currentMonthKey()
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) keys.push(addMonths(end, -i))
  return keys.map((month) => ({
    month,
    value: txns.reduce(
      (s, t) => (monthKeyOf(t.period) <= month ? s + signedAmount(t.type, t.amount) : s),
      0,
    ),
  }))
}
