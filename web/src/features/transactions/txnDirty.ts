import type { Txn } from '../../db'

// Does the open Edit form actually differ from the row it was opened on?
//
// Saving an edit asks for confirmation, but only when something changed — a form
// opened by a stray tap and closed with Save shouldn't nag. The comparison has to
// mirror what TxnForm's commit() writes, not what the form holds on screen:
// Income drops its subcategory, a blank note becomes undefined, and a Transfer's
// Out leg stores from/to as account/category.

// User-facing type choices; a Transfer expands to two -In/-Out legs on save.
export type Kind = 'Income' | 'Expense' | 'Transfer'

export function kindOf(txn: Txn): Kind {
  if (txn.type === 'Transfer-Out' || txn.type === 'Transfer-In') return 'Transfer'
  if (txn.type === 'Income') return 'Income'
  return 'Expense'
}

// The form's fields as typed. `amount` is already parsed (NaN while the box is
// empty or mid-typing, which only reaches here once validation has passed).
export interface TxnDraft {
  kind: Kind
  period: string // YYYY-MM-DD
  amount: number
  note: string
  // Income/Expense
  account: string
  category: string
  subcategory: string
  // Transfer
  from: string
  to: string
  /** Goal this transfer is earmarked against; '' = unallocated. */
  goal: string
}

// `storedGoal` is the goal the saved transfer is currently earmarked against —
// it lives in the goalMoves table rather than on the row, so it has to be passed
// in rather than read off `editing`.
export function txnChanged(editing: Txn, draft: TxnDraft, storedGoal = ''): boolean {
  if (kindOf(editing) !== draft.kind) return true

  // Shared fields. The stored period carries a time component; the form edits the
  // date alone. Amount is compared as a number so "100" and "100.00" agree.
  if (draft.period !== editing.period.slice(0, 10)) return true
  if (draft.amount !== editing.amount) return true
  if (draft.note !== (editing.note ?? '')) return true

  if (draft.kind === 'Transfer') {
    // The collapsed leg TxnForm edits is the Transfer-Out one: account=from,
    // category=to.
    return draft.from !== editing.account
      || draft.to !== editing.category
      || draft.goal !== storedGoal
  }

  if (draft.account !== editing.account) return true
  if (draft.category !== editing.category) return true
  // Income never stores a subcategory, so a value left over from a previous
  // Expense selection isn't a change.
  const sub = draft.kind === 'Expense' ? draft.subcategory : ''
  return sub !== (editing.subcategory ?? '')
}
