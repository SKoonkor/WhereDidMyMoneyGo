// 50/30/20 budgeting — a browser port of src/analytics/budget.py.
//
// Expense categories are assigned to two spending buckets — Needs and Wants —
// while Savings/Debt is the leftover (income − Needs spent − Wants spent), so it
// needs no mapping. Targets are a percentage of a monthly income base that is
// either a fixed amount or the rolling average of recent months' income. The
// current budget period runs from a reset day each month (read from Settings).
//
// Pure and testable; persistence lives in db.ts and the donut in
// features/budget/figure.ts.
import type { Txn } from '../../db'
import type { Bucket, BudgetCfg } from '../../data/defaults'

export const NEEDS: Bucket = 'Needs'
export const WANTS: Bucket = 'Wants'
export const SAVINGS: Bucket = 'Savings'
export const HIDDEN_LABEL = 'Hidden cost'

// Bucket a category belongs to; unknown categories default to Wants.
export function bucketFor(category: string, assignments: Record<string, Bucket>): Bucket {
  return assignments[category] ?? WANTS
}

// Bucket for a single transaction, honouring a per-subcategory override when one
// exists (only named subcats can be split); otherwise the category assignment.
export function bucketForTxn(
  category: string,
  subcategory: string | undefined,
  assignments: Record<string, Bucket>,
  subAssignments: Record<string, Record<string, Bucket>>,
): Bucket {
  const s = subAssignments[category]?.[subcategory ?? '']
  return s ?? assignments[category] ?? WANTS
}

// ── Date helpers (all on YYYY-MM-DD strings; lexicographic compare = chronological) ─
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const monthKey = (isoDate: string) => isoDate.slice(0, 7)
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate() // m is 1-12

// Reset date for a given month, clamping the day to the month's length.
function resetOn(y: number, m: number, resetDay: number): string {
  return iso(y, m, Math.min(Math.max(1, Math.trunc(resetDay)), daysInMonth(y, m)))
}

// Current budget period [start, end): the most recent reset day on/before today
// to the next reset day. Returns ISO date strings.
export function budgetPeriod(today: Date, resetDay = 1): [string, string] {
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const todayKey = iso(y, m, today.getDate())
  const thisReset = resetOn(y, m, resetDay)
  if (todayKey >= thisReset) {
    const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1]
    return [thisReset, resetOn(ny, nm, resetDay)]
  }
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1]
  return [resetOn(py, pm, resetDay), thisReset]
}

// ── Income base ──────────────────────────────────────────────────────────────

// Monthly income base the percentages apply to. "fixed" → the user amount;
// "rolling" → mean of the last `rollingMonths` *completed* months' Income.
export function budgetIncome(txns: Txn[], cfg: BudgetCfg, today = new Date()): number {
  if (cfg.mode !== 'rolling') return Number(cfg.fixedIncome) || 0

  const currentKey = monthKey(iso(today.getFullYear(), today.getMonth() + 1, 1))
  const byMonth = new Map<string, number>()
  for (const t of txns) {
    if (t.type !== 'Income') continue
    const k = monthKey(t.period)
    byMonth.set(k, (byMonth.get(k) ?? 0) + t.amount)
  }
  const completed = [...byMonth.entries()]
    .filter(([k]) => k < currentKey)
    .sort((a, b) => a[0].localeCompare(b[0]))
  const recent = completed.slice(-Math.max(1, Math.trunc(cfg.rollingMonths)))
  if (recent.length === 0) return 0
  return recent.reduce((s, [, v]) => s + v, 0) / recent.length
}

// ── Spending in a period ─────────────────────────────────────────────────────
const inWindow = (t: Txn, start: string, end: string) => {
  const d = t.period.slice(0, 10)
  return d >= start && d < end
}

// Σ expense per Needs/Wants bucket in [start, end), honouring subcat overrides.
export function spendingByBucket(
  txns: Txn[], start: string, end: string,
  assignments: Record<string, Bucket>,
  subAssignments: Record<string, Record<string, Bucket>> = {},
): Record<'Needs' | 'Wants', number> {
  const spent = { Needs: 0, Wants: 0 }
  for (const t of txns) {
    if (t.type !== 'Expense' || !inWindow(t, start, end)) continue
    const b = bucketForTxn(t.category, t.subcategory, assignments, subAssignments)
    if (b === NEEDS) spent.Needs += t.amount
    else spent.Wants += t.amount // Savings is never an assignment target
  }
  return spent
}

// Σ expense per category in [start, end).
export function spendingByCategory(txns: Txn[], start: string, end: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of txns) {
    if (t.type === 'Expense' && inWindow(t, start, end)) out[t.category] = (out[t.category] ?? 0) + t.amount
  }
  return out
}

// Net reconciliation "hidden cost" in [start, end): Σ Adjustment-Out − Σ
// Adjustment-In, clamped to ≥0 (only untracked *spending* counts). Yields 0
// until the Reconcile feature writes Adjustment rows.
export function hiddenCostIn(txns: Txn[], start: string, end: string): number {
  let out = 0
  let inc = 0
  for (const t of txns) {
    if (!inWindow(t, start, end)) continue
    if (t.type === 'Adjustment-Out') out += t.amount
    else if (t.type === 'Adjustment-In') inc += t.amount
  }
  return Math.max(0, out - inc)
}

// ── Month spending donut data ────────────────────────────────────────────────

export interface PieItem {
  label: string
  amount: number
  bucket: Bucket
}
export interface MonthPie {
  budget: number
  total: number
  over: boolean
  pie: PieItem[]
  remaining: number
  list: PieItem[] // over-budget overflow (the natural cut candidates)
}

// Spending breakdown for a calendar month ("YYYY-MM") as a share of the monthly
// budget. Needs fill first (largest→smallest), then Wants; over-budget spend
// spills into `list`, and under-budget leaves a `remaining` filler slice.
export function monthPieData(
  txns: Txn[], month: string, budget: number,
  assignments: Record<string, Bucket>,
  subAssignments: Record<string, Record<string, Bucket>> = {},
): MonthPie {
  const [y, m] = month.split('-').map(Number)
  const start = iso(y, m, 1)
  const end = m === 12 ? iso(y + 1, 1, 1) : iso(y, m + 1, 1)

  // Group by an "effective label": a split subcat becomes its own "cat:subcat"
  // item in its override bucket; everything else groups under the category.
  const groups = new Map<string, PieItem>()
  for (const t of txns) {
    if (t.type !== 'Expense' || !inWindow(t, start, end)) continue
    const sub = t.subcategory ?? ''
    const override = subAssignments[t.category]?.[sub]
    const label = override ? `${t.category}:${sub}` : t.category
    const bucket = override ?? assignments[t.category] ?? WANTS
    const g = groups.get(label)
    if (g) g.amount += t.amount
    else groups.set(label, { label, amount: t.amount, bucket })
  }
  const needs: PieItem[] = []
  const wants: PieItem[] = []
  for (const item of groups.values()) (item.bucket === NEEDS ? needs : wants).push(item)
  needs.sort((a, b) => b.amount - a.amount)
  wants.sort((a, b) => b.amount - a.amount)
  const ordered = [...needs, ...wants]

  const hidden = hiddenCostIn(txns, start, end)
  const total = ordered.reduce((s, x) => s + x.amount, 0) + hidden

  if (total <= budget) {
    const pie = [...ordered]
    if (hidden > 0) pie.push({ label: HIDDEN_LABEL, amount: hidden, bucket: WANTS })
    return { budget, total, over: false, pie, remaining: Math.max(0, budget - total), list: [] }
  }

  const pie: PieItem[] = []
  const list: PieItem[] = []
  let cum = 0
  for (const item of ordered) {
    if (cum >= budget) list.push(item)
    else {
      pie.push(item)
      cum += item.amount
    }
  }
  if (hidden > 0) list.push({ label: HIDDEN_LABEL, amount: hidden, bucket: WANTS })
  return { budget, total, over: true, pie, remaining: 0, list }
}

// ── Period summary ───────────────────────────────────────────────────────────

export interface BucketSummary {
  target: number
  spent: number
  remaining: number
}
export interface BudgetSummary {
  income: number
  mode: 'fixed' | 'rolling'
  start: string
  end: string
  buckets: Record<Bucket, BucketSummary>
}

// Per-bucket targets / spent / remaining for the current period. Needs & Wants:
// remaining = target − spent (positive = under). Savings: spent = income −
// Needs − Wants (actually saved); remaining = actual − target (positive = ahead).
export function budgetSummary(txns: Txn[], cfg: BudgetCfg, resetDay = 1, today = new Date()): BudgetSummary {
  const income = budgetIncome(txns, cfg, today)
  const [start, end] = budgetPeriod(today, resetDay)
  const spent = spendingByBucket(txns, start, end, cfg.assignments, cfg.subAssignments)
  const pct = cfg.percentages
  const needsT = (income * (pct.Needs ?? 0)) / 100
  const wantsT = (income * (pct.Wants ?? 0)) / 100
  const savT = (income * (pct.Savings ?? 0)) / 100
  const savActual = income - spent.Needs - spent.Wants
  return {
    income,
    mode: cfg.mode,
    start,
    end,
    buckets: {
      Needs: { target: needsT, spent: spent.Needs, remaining: needsT - spent.Needs },
      Wants: { target: wantsT, spent: spent.Wants, remaining: wantsT - spent.Wants },
      Savings: { target: savT, spent: savActual, remaining: savActual - savT },
    },
  }
}

// Traffic-light tone for a bucket's spend vs target. Needs/Wants: less is better
// (green <50%, orange 50–85%, red >85%). Savings: more is better (green ≥90%,
// orange 65–90%, red <65%).
export function bucketTone(name: Bucket, spent: number, target: number): 'good' | 'warn' | 'bad' {
  const raw = target ? (spent / target) * 100 : 0
  if (name === SAVINGS) return raw >= 90 ? 'good' : raw >= 65 ? 'warn' : 'bad'
  return raw < 50 ? 'good' : raw <= 85 ? 'warn' : 'bad'
}
