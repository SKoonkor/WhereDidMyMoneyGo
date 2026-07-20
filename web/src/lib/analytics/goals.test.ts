import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { goalFactor, poolTarget, savingsBalance, emergencyFundStatus } from './goals'

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Savings', amount: 0,
  type: 'Transfer-In', category: 'Bank Accounts', currency: 'THB', ...over,
})

describe('goalFactor', () => {
  it('is ≥ 1 and defaults to 1 for unset/invalid/≤1 values', () => {
    expect(goalFactor('a', { a: 2.5 })).toBe(2.5)
    expect(goalFactor('a', {})).toBe(1)
    expect(goalFactor('a', { a: 0.5 })).toBe(1)
    expect(goalFactor('a', { a: NaN })).toBe(1)
  })
})

describe('poolTarget', () => {
  const goals = { Car: 300000, Trip: 80000 }
  const factors = { Trip: 2 } // effective Trip = 160000

  it('is EF target alone when nothing is ticked', () => {
    expect(poolTarget(60000, goals, [], factors)).toBe(60000)
  })

  it('adds the single highest effective goal (amount × factor) on top', () => {
    // Car 300k vs Trip 80k×2=160k → Car wins.
    expect(poolTarget(60000, goals, ['Car', 'Trip'], factors)).toBe(360000)
    // Only Trip ticked → its factored target is added.
    expect(poolTarget(60000, goals, ['Trip'], factors)).toBe(220000)
  })
})

describe('savingsBalance', () => {
  it('sums signed balances across the pool accounts', () => {
    const txns = [
      T({ id: 1, account: 'Savings', type: 'Transfer-In', amount: 10000 }),
      T({ id: 2, account: 'Savings', type: 'Income', amount: 2000 }),
      T({ id: 3, account: 'Savings', type: 'Expense', amount: 500 }),
      T({ id: 4, account: 'Cash', type: 'Income', amount: 9999 }), // not in pool
    ]
    expect(savingsBalance(txns, ['Savings'])).toBe(11500)
  })

  it('nets an internal transfer between two pooled accounts to zero', () => {
    const txns = [
      T({ id: 1, account: 'Savings', type: 'Transfer-Out', amount: 3000, transferId: 'x' }),
      T({ id: 2, account: 'Brokerage', type: 'Transfer-In', amount: 3000, transferId: 'x' }),
    ]
    expect(savingsBalance(txns, ['Savings', 'Brokerage'])).toBe(0)
    // But counting only one side shows the move.
    expect(savingsBalance(txns, ['Brokerage'])).toBe(3000)
  })
})

describe('emergencyFundStatus', () => {
  it('reports balance, target, capped percentage and months covered', () => {
    const txns = [T({ id: 1, account: 'Savings', type: 'Transfer-In', amount: 30000 })]
    const s = emergencyFundStatus(txns, ['Savings'], 20000, 3)
    expect(s.currentBalance).toBe(30000)
    expect(s.target).toBe(60000)
    expect(s.percentage).toBe(50)
    expect(s.monthsCovered).toBe(1.5)
  })

  it('caps the percentage at 100 when over target', () => {
    const txns = [T({ id: 1, account: 'Savings', type: 'Transfer-In', amount: 90000 })]
    const s = emergencyFundStatus(txns, ['Savings'], 20000, 3)
    expect(s.percentage).toBe(100)
    expect(s.monthsCovered).toBe(4.5)
  })
})
