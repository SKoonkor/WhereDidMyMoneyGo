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

// A calendar-day index. Subtracting two local midnights in milliseconds looks
// equivalent and isn't: across a DST spring-forward the gap is an hour short, so
// flooring turns 31 days into 30 and the nudge arrives a day late. Feeding the
// LOCAL y/m/d through Date.UTC takes the offset out of the arithmetic entirely.
const dayIndex = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000

// Today as YYYY-MM-DD in LOCAL time. `new Date().toISOString().slice(0, 10)` is the
// obvious thing to write and is wrong here: it is UTC, so east of Greenwich — the
// app's home is UTC+7 — reconciling before 07:00 stamps yesterday. That one-day
// slip is enough to leave the nudge on screen straight after a reconcile, which is
// the whole thing the date is read for. Every reader below compares against LOCAL
// midnight, so the writer has to agree.
export function todayISO(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The reconcile nudge — one predicate for both the home banner and the "· due" chip
// on the Reconcile page itself, so the two can never disagree about what counts as
// overdue. (Whether the nudge is WANTED is a separate question the switch answers,
// and only the banner asks it: the chip is a fact about the ledger, and the page
// carrying it is where you would go to turn the reminder back on.)
//
// Due when the ledger has transactions AND either it is the 1st of the month or the
// last reconciliation is more than 30 days old (never reconciled counts as overdue).
//
// Order matters here. The 1st-of-month rule is deliberately checked LAST, against
// the day count: as an unconditional early return it fired even on a day the user
// had already reconciled, so the banner survived the very action meant to clear it.
// The unparsable-date guard has to stay above the day count for the same reason in
// reverse — `NaN > 0` is false, so a corrupt date would read as "not due" forever.
export function reconcileReminderDue(
  lastReconciled: string | null,
  hasTransactions: boolean,
  today = new Date(),
): boolean {
  if (!hasTransactions) return false
  if (!lastReconciled) return true
  const last = new Date(lastReconciled + 'T00:00:00')
  if (Number.isNaN(last.getTime())) return true
  const days = dayIndex(today) - dayIndex(last)
  // A date in the future is a wrong clock or a backup from a device set ahead —
  // never a reason to go quiet until it catches up.
  if (days < 0) return true
  if (days > 30) return true
  return today.getDate() === 1 && days > 0
}
