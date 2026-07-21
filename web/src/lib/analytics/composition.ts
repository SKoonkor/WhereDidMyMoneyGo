// Income / Expense category composition — port of the breakdown logic in
// src/app/figures/pie.py (_category_breakdown). Groups a type's transactions by
// category (amount-descending) and folds everything past the slice cap into a
// single "Other" slice. Pure + testable; the figure builder handles colours.
import type { Txn } from '../../db'
import type { Bucket } from '../../data/defaults'
import { bucketFor, NEEDS, WANTS } from './budget'

export interface Slice { category: string; amount: number; hidden?: boolean; bucket?: Bucket }

export const MAX_SLICES = 12 // 11 named categories + "Other"
export const BUCKET_CAP = 8 // max named slices per bucket before folding to "Other"
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

// Expense categories grouped into Needs then Wants (each amount-descending),
// tagged with their `bucket`. Each bucket folds its tail past BUCKET_CAP into an
// "Other" slice. Port of pie._expense_bucket_breakdown — drives "sort by
// Needs/Wants" (the donut/bars recolour Needs blue, Wants orange).
export function expenseBucketBreakdown(
  txns: Txn[],
  assignments: Record<string, Bucket>,
  bucketCap = BUCKET_CAP,
  otherLabel = 'Other',
): Slice[] {
  const sums = new Map<string, number>()
  for (const t of txns) {
    if (t.type === 'Expense') sums.set(t.category, (sums.get(t.category) ?? 0) + t.amount)
  }
  const sorted = [...sums.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)

  const out: Slice[] = []
  for (const bucket of [NEEDS, WANTS] as Bucket[]) {
    let cats = sorted.filter((s) => bucketFor(s.category, assignments) === bucket)
    if (cats.length > bucketCap) {
      const otherAmount = cats.slice(bucketCap - 1).reduce((s, x) => s + x.amount, 0)
      cats = [...cats.slice(0, bucketCap - 1), { category: otherLabel, amount: otherAmount }]
    }
    for (const c of cats) out.push({ category: c.category, amount: c.amount, bucket })
  }
  return out
}

export interface CatGroup { category: string; total: number; subs: { name: string; amount: number }[] }

// Nested category → subcategory breakdown for one side, category total-desc and
// subcategories amount-desc. Blank subcategories normalise to "—". Port of
// budget.subcategory_breakdown; feeds the expandable category summary.
export function subcategoryBreakdown(txns: Txn[], type: 'Income' | 'Expense'): CatGroup[] {
  const byCat = new Map<string, Map<string, number>>()
  for (const t of txns) {
    if (t.type !== type) continue
    const sub = t.subcategory?.trim() || '—'
    const m = byCat.get(t.category) ?? byCat.set(t.category, new Map()).get(t.category)!
    m.set(sub, (m.get(sub) ?? 0) + t.amount)
  }
  return [...byCat.entries()]
    .map(([category, subsMap]) => ({
      category,
      total: [...subsMap.values()].reduce((s, x) => s + x, 0),
      subs: [...subsMap.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.total - a.total)
}
