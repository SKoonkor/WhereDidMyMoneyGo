// Income / Expense category composition — port of the breakdown logic in
// src/app/figures/pie.py (_category_breakdown). Groups a type's transactions by
// category (amount-descending) and folds everything past the slice cap into a
// single "Other" slice. Pure + testable; the figure builder handles colours.
import type { Txn } from '../../db'

export interface Slice { category: string; amount: number }

export const MAX_SLICES = 12 // 11 named categories + "Other"

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
