// Account-balance reconciliation — a browser port of src/analytics/reconciliation.py.
//
// Registering an account's real balance writes a dated balance-adjustment row
// (Adjustment-In / Adjustment-Out) for the gap versus the tracked balance. The
// signed sum of those rows is the recorded "hidden cost" — money that moved
// without being tracked. The write itself lives in db.ts (applyReconciliation).
//
// Pure and testable.
import { accountBalances } from '../balances'
import type { Txn } from '../../db'

export const RECON_CATEGORY = 'Reconciliation'
export const ADJUST_IN = 'Adjustment-In'
export const ADJUST_OUT = 'Adjustment-Out'
const STALE_DAYS = 31
const EPS = 0.005 // ignore sub-cent discrepancies

// Final tracked balance per account (adjustments included), for the union of the
// configured accounts and any account present in the data. 0 where absent.
export function trackedBalances(txns: Txn[], accounts: string[]): Record<string, number> {
  const bal = accountBalances(txns) // signed sum per account (incl. adjustments)
  const names = [...new Set([...accounts, ...Object.keys(bal)])]
  const out: Record<string, number> = {}
  for (const a of names) out[a] = bal[a] ?? 0
  return out
}

// Signed hidden cost per account (Adjustment-In +, Adjustment-Out −).
export function hiddenCostByAccount(txns: Txn[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of txns) {
    if (t.type === ADJUST_IN) out[t.account] = (out[t.account] ?? 0) + t.amount
    else if (t.type === ADJUST_OUT) out[t.account] = (out[t.account] ?? 0) - t.amount
  }
  return out
}

export function hiddenCostTotal(txns: Txn[]): number {
  return Object.values(hiddenCostByAccount(txns)).reduce((s, v) => s + v, 0)
}

export interface Adjustment {
  account: string
  delta: number // actual − tracked (signed); rounded to 2dp
}

// The adjustments to record: actual − tracked per account, dropping anything
// under half a cent. `actuals` maps account → the entered real balance (absent =
// leave unchanged).
export function computeAdjustments(
  tracked: Record<string, number>,
  actuals: Record<string, number | null | undefined>,
): Adjustment[] {
  const out: Adjustment[] = []
  for (const [account, actual] of Object.entries(actuals)) {
    if (actual == null || !Number.isFinite(actual)) continue
    const delta = Math.round((actual - (tracked[account] ?? 0)) * 100) / 100
    if (Math.abs(delta) >= EPS) out.push({ account, delta })
  }
  return out
}

// Due if never reconciled, the last reconciliation is stale (>31 days), or it is
// month-end and we haven't reconciled this month.
export function isReminderDue(lastReconciled: string | null, today = new Date()): boolean {
  if (!lastReconciled) return true
  const last = new Date(lastReconciled + 'T00:00:00')
  if (Number.isNaN(last.getTime())) return true
  const days = Math.floor((atMidnight(today) - atMidnight(last)) / 86_400_000)
  if (days > STALE_DAYS) return true
  const isMonthEnd = today.getDate() === new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const beforeThisMonth =
    last.getFullYear() < today.getFullYear() ||
    (last.getFullYear() === today.getFullYear() && last.getMonth() < today.getMonth())
  return isMonthEnd && beforeThisMonth
}

const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
