// Per-account running balances — a direct port of src/processing/balances.py.
// This is where transfer semantics matter: a Transfer moves money between
// accounts (In +, Out −) but nets to zero across the ledger, so net worth is
// unchanged while each account's balance shifts.
import type { Txn, TxnType } from '../db'

// Signed contribution of a row to its account's balance (balances.py `sign`).
export function signedAmount(type: TxnType, amount: number): number {
  switch (type) {
    case 'Income':
    case 'Transfer-In':
    case 'Adjustment-In':
      return amount
    case 'Expense':
    case 'Transfer-Out':
    case 'Saving':
    case 'Adjustment-Out':
      return -amount
    default:
      return 0
  }
}

// True for money genuinely entering/leaving net worth (excludes transfers, which
// only move between the user's own accounts).
export function affectsNetWorth(type: TxnType): boolean {
  return type !== 'Transfer-In' && type !== 'Transfer-Out'
}

// Closing balance per account across the whole ledger.
export function accountBalances(txns: Txn[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of txns) {
    out[t.account] = (out[t.account] ?? 0) + signedAmount(t.type, t.amount)
  }
  return out
}
