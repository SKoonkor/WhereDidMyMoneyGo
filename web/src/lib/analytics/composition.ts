// Income / Expense category composition — port of the breakdown logic in
// src/app/figures/pie.py (_category_breakdown). Groups a type's transactions by
// category (amount-descending) and folds everything past the slice cap into a
// single "Other" slice. Pure + testable; the figure builder handles colours.
import type { Txn } from '../../db'

export interface Slice { category: string; amount: number; hidden?: boolean }

export const MAX_SLICES = 12 // 11 named categories + "Other"
export const HIDDEN_LABEL = 'Hidden cost'

// Untracked spending recorded by reconciliation in this set of rows:
// Σ Adjustment-Out − Σ Adjustment-In, clamped ≥ 0 (only untracked *spending*
// counts). Shown as an extra slate slice on the Expense side. 0 until Reconcile
// has written any Adjustment rows.
export function hiddenCost(txns: Txn[]): number {
  let out = 0
  let inc = 0
  for (const t of txns) {
    if (t.type === 'Adjustment-Out') out += t.amount
    else if (t.type === 'Adjustment-In') inc += t.amount
  }
  return Math.max(0, out - inc)
}

export function categoryBreakdown(
  txns: Txn[],
  type: 'Income' | 'Expense',
  maxSlices = MAX_SLICES,
  otherLabel = 'Other',
): Slice[] {
  const sums = new Map<string, number>()
  for (const t of txns) {
    if (t.type === type) sums.set(t.category, (sums.get(t.category) ?? 0) + t.amount)
  }
  let slices = [...sums.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
  if (slices.length > maxSlices) {
    const top = slices.slice(0, maxSlices - 1)
    const otherAmount = slices.slice(maxSlices - 1).reduce((s, x) => s + x.amount, 0)
    slices = [...top, { category: otherLabel, amount: otherAmount }]
  }
  return slices
}

export function sliceTotal(slices: Slice[]): number {
  return slices.reduce((s, x) => s + x.amount, 0)
}
