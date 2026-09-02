import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import {
  trackedBalances, computeAdjustments, hiddenCostByAccount, hiddenCostTotal,
  reconcileReminderDue, todayISO,
} from './reconcile'

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 0,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

describe('trackedBalances', () => {
  it('returns the union of configured + data accounts, adjustments included', () => {
    const txns = [
      T({ id: 1, account: 'Cash', type: 'Income', amount: 1000 }),
      T({ id: 2, account: 'Cash', type: 'Expense', amount: 300 }),
      T({ id: 3, account: 'Wallet', type: 'Adjustment-Out', amount: 50 }), // untracked spend
    ]
    const bal = trackedBalances(txns, ['Cash', 'Bank'])
    expect(bal.Cash).toBe(700)
    expect(bal.Bank).toBe(0) // configured but unused
    expect(bal.Wallet).toBe(-50) // present in data only, adjustment applied
  })
})

describe('computeAdjustments', () => {
  it('records actual − tracked, dropping sub-cent gaps', () => {
    const tracked = { Cash: 700, Bank: 0, Wallet: -50 }
    const adj = computeAdjustments(tracked, { Cash: 750, Bank: 0.003, Wallet: -80, Missing: null })
    expect(adj).toEqual([
      { account: 'Cash', delta: 50 }, // +50 → Adjustment-In
      { account: 'Wallet', delta: -30 }, // −30 → Adjustment-Out
    ])
    // Bank's 0.003 gap is under half a cent → ignored; Missing (null) skipped.
  })
})

describe('hidden cost', () => {
  it('is signed per account and summed overall', () => {
    const txns = [
      T({ id: 1, account: 'Cash', type: 'Adjustment-Out', amount: 80 }),
      T({ id: 2, account: 'Cash', type: 'Adjustment-In', amount: 20 }),
      T({ id: 3, account: 'Bank', type: 'Adjustment-Out', amount: 10 }),
    ]
    expect(hiddenCostByAccount(txns)).toEqual({ Cash: -60, Bank: -10 })
    expect(hiddenCostTotal(txns)).toBe(-70)
  })
})

describe('todayISO', () => {
  // The whole point of it: a LOCAL date, so it agrees with the local-midnight
  // comparison the predicate does. toISOString() would give the previous day for
  // either of these anywhere east of UTC.
  it('uses the local calendar day, not UTC', () => {
    expect(todayISO(new Date(2026, 8, 1, 0, 30))).toBe('2026-09-01')
    expect(todayISO(new Date(2026, 8, 30, 23, 30))).toBe('2026-09-30')
  })
  it('zero-pads month and day', () => {
    expect(todayISO(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05')
  })
})

describe('reconcileReminderDue', () => {
  it('never shows without transactions', () => {
    expect(reconcileReminderDue(null, false, new Date(2026, 6, 1))).toBe(false)
    expect(reconcileReminderDue('2026-01-01', false, new Date(2026, 6, 15))).toBe(false)
  })
  it('shows on the 1st of the month', () => {
    expect(reconcileReminderDue('2026-06-25', true, new Date(2026, 6, 1))).toBe(true) // 6 days ago but 1st
    expect(reconcileReminderDue('2026-06-30', true, new Date(2026, 6, 1))).toBe(true) // yesterday
  })
  // The regression this whole change exists for: the 1st used to be an
  // unconditional "due", so reconciling ON the 1st could not clear the banner.
  it('clears on the 1st once reconciled that same day', () => {
    expect(reconcileReminderDue('2026-07-01', true, new Date(2026, 6, 1))).toBe(false)
  })
  it('shows after >30 days since the last reconciliation', () => {
    expect(reconcileReminderDue('2026-06-10', true, new Date(2026, 6, 15))).toBe(true) // 35 days
    expect(reconcileReminderDue('2026-06-20', true, new Date(2026, 6, 15))).toBe(false) // 25 days, mid-month
  })
  it('pins the 30-day boundary', () => {
    expect(reconcileReminderDue('2026-06-15', true, new Date(2026, 6, 15))).toBe(false) // exactly 30
    expect(reconcileReminderDue('2026-06-14', true, new Date(2026, 6, 15))).toBe(true) // 31
  })
  it('shows when never reconciled but transactions exist (not the 1st)', () => {
    expect(reconcileReminderDue(null, true, new Date(2026, 6, 15))).toBe(true)
  })
  // The unparsable-date guard has to stay ABOVE the day count: NaN > 0 is false,
  // so getting the order wrong silences the banner forever instead of forcing it.
  it('is due on an unparsable date, on the 1st and off it alike', () => {
    expect(reconcileReminderDue('not-a-date', true, new Date(2026, 6, 1))).toBe(true)
    expect(reconcileReminderDue('not-a-date', true, new Date(2026, 6, 15))).toBe(true)
  })
  it('is due when the stored date is in the future (skewed clock / restored backup)', () => {
    expect(reconcileReminderDue('2026-08-01', true, new Date(2026, 6, 15))).toBe(true)
  })
})
