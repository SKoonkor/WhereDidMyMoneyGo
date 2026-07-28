import { describe, it, expect } from 'vitest'
import { kindOf, txnChanged, type TxnDraft } from './txnDirty'
import type { Txn } from '../../db'

const expense: Txn = {
  id: 1, period: '2026-07-20', account: 'Cash', amount: 120,
  type: 'Expense', category: 'Food', subcategory: 'Lunch',
  note: 'noodles', currency: 'THB',
}

// The form state that TxnForm would hold immediately after opening `expense`.
const draftOf = (t: Txn): TxnDraft => ({
  kind: kindOf(t),
  period: t.period.slice(0, 10),
  amount: t.amount,
  note: t.note ?? '',
  account: t.account,
  category: t.category,
  subcategory: t.subcategory ?? '',
  from: t.account,
  to: t.category,
})

describe('kindOf', () => {
  it('collapses both transfer legs to Transfer', () => {
    expect(kindOf({ ...expense, type: 'Transfer-Out' })).toBe('Transfer')
    expect(kindOf({ ...expense, type: 'Transfer-In' })).toBe('Transfer')
    expect(kindOf({ ...expense, type: 'Income' })).toBe('Income')
    expect(kindOf(expense)).toBe('Expense')
  })
})

describe('txnChanged', () => {
  it('is false for an untouched form', () => {
    expect(txnChanged(expense, draftOf(expense))).toBe(false)
  })

  it('spots each edited field', () => {
    const base = draftOf(expense)
    expect(txnChanged(expense, { ...base, period: '2026-07-21' })).toBe(true)
    expect(txnChanged(expense, { ...base, amount: 121 })).toBe(true)
    expect(txnChanged(expense, { ...base, note: 'rice' })).toBe(true)
    expect(txnChanged(expense, { ...base, account: 'Bank' })).toBe(true)
    expect(txnChanged(expense, { ...base, category: 'Transport' })).toBe(true)
    expect(txnChanged(expense, { ...base, subcategory: 'Dinner' })).toBe(true)
    expect(txnChanged(expense, { ...base, kind: 'Income' })).toBe(true)
  })

  it('ignores how the amount was typed', () => {
    // "100.00" and "100" both parse to the same number.
    expect(txnChanged(expense, { ...draftOf(expense), amount: parseFloat('120.00') })).toBe(false)
  })

  it('treats a blank note and a missing note as the same', () => {
    const noNote: Txn = { ...expense, note: undefined }
    expect(txnChanged(noNote, draftOf(noNote))).toBe(false)
    // …and clearing a real note IS a change.
    expect(txnChanged(expense, { ...draftOf(expense), note: '' })).toBe(true)
  })

  it('only compares the time part away, not the date', () => {
    const stamped: Txn = { ...expense, period: '2026-07-20 08:30:00' }
    expect(txnChanged(stamped, { ...draftOf(stamped), period: '2026-07-20' })).toBe(false)
  })

  it('ignores a stale subcategory on an Income row', () => {
    const income: Txn = { ...expense, type: 'Income', category: 'Salary', subcategory: undefined }
    // The form can still be holding "Lunch" from a previous Expense selection;
    // commit() drops it, so it is not a change.
    expect(txnChanged(income, { ...draftOf(income), subcategory: 'Lunch' })).toBe(false)
  })

  it('compares a transfer against its stored leg, not the single-row fields', () => {
    // On the Transfer-Out leg, account = from and category = to.
    const transfer: Txn = {
      ...expense, type: 'Transfer-Out', account: 'Cash', category: 'Bank Accounts',
      subcategory: undefined, transferId: 'g1',
    }
    const base = draftOf(transfer)
    expect(txnChanged(transfer, base)).toBe(false)
    expect(txnChanged(transfer, { ...base, from: 'Bank Accounts' })).toBe(true)
    expect(txnChanged(transfer, { ...base, to: 'Cash' })).toBe(true)
    // The unused Income/Expense fields must not leak into the comparison.
    expect(txnChanged(transfer, { ...base, account: 'zzz', category: 'zzz', subcategory: 'zzz' })).toBe(false)
  })
})
