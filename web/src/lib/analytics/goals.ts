// Financial goals + savings pool — a browser port of src/analytics/goals.py and
// emergency_fund.py.
//
// The Emergency Fund is always the base of the savings pool; its target comes
// from Settings (monthlyRequired × targetMonths). Ticking other goals adds the
// single **highest** effective goal (amount × xTimes factor) on top. The pool
// balance is the combined signed balance of the chosen savings accounts.
//
// Pure and testable; persistence is in db.ts, the gauge in features/goals/figure.ts.
import { signedAmount } from '../balances'
import type { Txn } from '../../db'

// This goal's multiplier (≥ 1); defaults to 1 when unset or invalid.
export function goalFactor(name: string, factors: Record<string, number>): number {
  const f = Number(factors[name])
  return Number.isFinite(f) && f > 1 ? f : 1
}

// Savings-pool cap = Emergency Fund target + the single highest effective goal
// (amount × factor) among the ticked goals. With nothing ticked it's the EF target.
export function poolTarget(
  efTarget: number,
  goals: Record<string, number>,
  selected: string[],
  factors: Record<string, number>,
): number {
  let best = 0
  for (const name of selected) {
    const eff = (goals[name] ?? 0) * goalFactor(name, factors)
    if (eff > best) best = eff
  }
  return efTarget + best
}

// Combined signed balance of the pool accounts. Transfers between two pooled
// accounts net to zero, so the pool total is unaffected by internal moves.
export function savingsBalance(txns: Txn[], accounts: string[]): number {
  const pool = new Set(accounts)
  let total = 0
  for (const t of txns) {
    if (pool.has(t.account)) total += signedAmount(t.type, t.amount)
  }
  return total
}

export interface EFStatus {
  currentBalance: number
  target: number
  percentage: number // capped at 100
  monthsCovered: number
}

// Emergency-fund progress across the pool accounts. target = monthlyRequired ×
// targetMonths; percentage is capped at 100; monthsCovered = balance / monthly.
export function emergencyFundStatus(
  txns: Txn[],
  accounts: string[],
  monthlyRequired: number,
  targetMonths: number,
): EFStatus {
  const currentBalance = savingsBalance(txns, accounts)
  const target = monthlyRequired * targetMonths
  const percentage = target > 0 ? Math.min((currentBalance / target) * 100, 100) : 0
  const monthsCovered = monthlyRequired > 0 ? currentBalance / monthlyRequired : 0
  return {
    currentBalance: round2(currentBalance),
    target: round2(target),
    percentage: Math.round(percentage * 10) / 10,
    monthsCovered: Math.round(monthsCovered * 10) / 10,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
