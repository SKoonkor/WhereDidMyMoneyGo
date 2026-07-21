import { describe, it, expect } from 'vitest'
import { addMonths, monthKeyOf, filterByMonth, collapseTransfers, groupByDay, monthSummary, daySummary } from './month'
import type { Txn } from '../../db'

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 0,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

describe('month utils', () => {
  it('extracts and shifts month keys (incl. year wrap)', () => {
    expect(monthKeyOf('2026-07-10')).toBe('2026-07')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
  })

  it('filters to a month', () => {
    const rows = [T({ id: 1, period: '2026-07-01' }), T({ id: 2, period: '2026-08-01' })]
    expect(filterByMonth(rows, '2026-07').map((r) => r.id)).toEqual([1])
  })

  it('collapses a transfer to one row (hides the paired In leg)', () => {
    const rows = [
      T({ id: 1, type: 'Transfer-Out', transferId: 'a', account: 'Cash', category: 'Bank' }),
      T({ id: 2, type: 'Transfer-In', transferId: 'a', account: 'Bank', category: 'Cash' }),
      T({ id: 3, type: 'Transfer-In', transferId: 'b', account: 'X', category: 'Y' }), // unpaired -> stays
    ]
    const ids = collapseTransfers(rows).map((r) => r.id)
    expect(ids).toEqual([1, 3])
  })

  it('summary counts Income and Expense only (transfers excluded)', () => {
    const rows = [
      T({ type: 'Income', amount: 5000 }),
      T({ type: 'Expense', amount: 200 }),
      T({ type: 'Transfer-Out', amount: 500, transferId: 'a' }),
      T({ type: 'Transfer-In', amount: 500, transferId: 'a' }),
    ]
    expect(monthSummary(rows)).toEqual({ income: 5000, expense: 200, net: 4800 })
  })

  it('daySummary totals Income and Expense per day (transfers excluded)', () => {
    const rows = [
      T({ type: 'Income', amount: 500 }),
      T({ type: 'Expense', amount: 170 }),
      T({ type: 'Expense', amount: 303 }),
      T({ type: 'Transfer-Out', amount: 10000, transferId: 'a' }),
    ]
    expect(daySummary(rows)).toEqual({ income: 500, expense: 473 })
  })

  it('groups by day, newest day first', () => {
    const rows = [T({ id: 1, period: '2026-07-01' }), T({ id: 2, period: '2026-07-05' })]
    expect(groupByDay(rows).map(([d]) => d)).toEqual(['2026-07-05', '2026-07-01'])
  })
})
