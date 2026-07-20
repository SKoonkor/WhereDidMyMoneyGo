import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import {
  trackedBalances, computeAdjustments, hiddenCostByAccount, hiddenCostTotal, isReminderDue,
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

describe('isReminderDue', () => {
  it('is due when never reconciled', () => {
    expect(isReminderDue(null, new Date(2026, 6, 15))).toBe(true)
  })
  it('is due when the last reconciliation is stale (>31 days)', () => {
    expect(isReminderDue('2026-05-01', new Date(2026, 6, 15))).toBe(true) // ~75 days
    expect(isReminderDue('2026-07-01', new Date(2026, 6, 15))).toBe(false) // 14 days
  })
  it('is due at month-end when not yet reconciled this month', () => {
    expect(isReminderDue('2026-06-20', new Date(2026, 6, 31))).toBe(true) // Jul 31, last in Jun
    expect(isReminderDue('2026-07-05', new Date(2026, 6, 31))).toBe(false) // already this month
  })
})
