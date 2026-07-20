// Net worth = the sum of every account's balance. Transfers net to zero across
// accounts, so net worth only moves with real income/expense/adjustments.
// Builds on balances.ts (port of src/processing/balances.py).
import { signedAmount } from '../balances'
import type { Txn } from '../../db'

export function netWorth(txns: Txn[]): number {
  return txns.reduce((s, t) => s + signedAmount(t.type, t.amount), 0)
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export interface TrendPoint { date: string; value: number }

// Cumulative net worth at the end of each day over the last `days` days (one
// point per day, oldest → today), so the line shows the real shape of the trend
// rather than a coarse month-by-month step. Transactions before the window are
// folded into a baseline; anything dated after today is ignored.
export function netWorthTrend(txns: Txn[], days = 180): TrendPoint[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1))
  const startKey = isoDay(start)

  let baseline = 0
  const deltaByDay = new Map<string, number>()
  for (const t of txns) {
    const d = t.period.slice(0, 10)
    const s = signedAmount(t.type, t.amount)
    if (d < startKey) baseline += s // predates the window → baseline
    else deltaByDay.set(d, (deltaByDay.get(d) ?? 0) + s)
  }

  const points: TrendPoint[] = []
  let running = baseline
  const cur = new Date(start)
  for (let i = 0; i < days; i++) {
    running += deltaByDay.get(isoDay(cur)) ?? 0
    points.push({ date: isoDay(cur), value: running })
    cur.setDate(cur.getDate() + 1)
  }
  return points
}
