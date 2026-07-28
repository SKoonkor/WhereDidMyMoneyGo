import { describe, it, expect } from 'vitest'
import {
  addMonths, monthKeyOf, filterByMonth, collapseTransfers, groupByDay, monthSummary, daySummary,
  filterByRange, latestPeriod, addDays, groupDaysWithMoves,
} from './month'
import { UNALLOCATED, type GoalMove } from '../../lib/analytics/goalSavings'
import type { Txn } from '../../db'

const M = (over: Partial<GoalMove>): GoalMove => ({
  id: 0, period: '2026-07-10', from: UNALLOCATED, to: 'Car', amount: 1000, ...over,
})

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

  it('within a day, newest-added (higher id) sorts first', () => {
    const rows = [
      T({ id: 5, period: '2026-07-10' }),
      T({ id: 9, period: '2026-07-10' }),
      T({ id: 7, period: '2026-07-10' }),
    ]
    const [[, dayRows]] = groupByDay(rows)
    expect(dayRows.map((r) => r.id)).toEqual([9, 7, 5])
  })

  it('filterByRange includes both endpoints', () => {
    const rows = [
      T({ id: 1, period: '2026-07-01' }),
      T({ id: 2, period: '2026-07-15' }),
      T({ id: 3, period: '2026-08-01' }),
    ]
    expect(filterByRange(rows, '2026-07-01', '2026-07-15').map((r) => r.id)).toEqual([1, 2])
  })

  it('latestPeriod picks the max day (today on empty); addDays is calendar-correct', () => {
    expect(latestPeriod([T({ period: '2026-07-01' }), T({ period: '2026-07-20' })])).toBe('2026-07-20')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('filterByMonth also filters goal moves', () => {
    const moves = [M({ id: 1, period: '2026-07-10' }), M({ id: 2, period: '2026-08-02' })]
    expect(filterByMonth(moves, '2026-07').map((m) => m.id)).toEqual([1])
  })
})

describe('groupDaysWithMoves', () => {
  it('files a move on its own day, after that day’s transactions', () => {
    const txns = [T({ id: 3, period: '2026-07-10' }), T({ id: 5, period: '2026-07-10' })]
    const moves = [M({ id: 1, period: '2026-07-10' })]
    const [[day, rows]] = groupDaysWithMoves(txns, moves)
    expect(day).toBe('2026-07-10')
    expect(rows.map((r) => r.kind)).toEqual(['txn', 'txn', 'move'])
    // The existing newest-added-first rule for transactions is preserved.
    expect(rows.flatMap((r) => (r.kind === 'txn' ? [r.txn.id] : []))).toEqual([5, 3])
  })

  it('opens a day that has only moves', () => {
    const days = groupDaysWithMoves([], [M({ id: 1, period: '2026-07-12' })])
    expect(days.map(([d]) => d)).toEqual(['2026-07-12'])
    expect(days[0][1]).toHaveLength(1)
  })

  it('keeps days newest-first across both sources', () => {
    const txns = [T({ id: 1, period: '2026-07-01' })]
    const moves = [M({ id: 1, period: '2026-07-20' }), M({ id: 2, period: '2026-07-10' })]
    expect(groupDaysWithMoves(txns, moves).map(([d]) => d))
      .toEqual(['2026-07-20', '2026-07-10', '2026-07-01'])
  })

  it('sorts several moves on one day newest-added first', () => {
    const moves = [M({ id: 2 }), M({ id: 7 }), M({ id: 4 })]
    const [[, rows]] = groupDaysWithMoves([], moves)
    expect(rows.flatMap((r) => (r.kind === 'move' ? [r.move.id] : []))).toEqual([7, 4, 2])
  })

  it('leaves the day and month totals untouched — a move is not income or spending', () => {
    const txns = [T({ id: 1, period: '2026-07-10', type: 'Income', amount: 500 })]
    const moves = [M({ id: 1, period: '2026-07-10', amount: 9999 })]
    const [[, rows]] = groupDaysWithMoves(txns, moves)
    const dayTxns = rows.flatMap((r) => (r.kind === 'txn' ? [r.txn] : []))
    expect(daySummary(dayTxns)).toEqual({ income: 500, expense: 0 })
    expect(monthSummary(txns)).toEqual({ income: 500, expense: 0, net: 500 })
  })

  it('matches groupByDay exactly when there are no moves', () => {
    const txns = [T({ id: 1, period: '2026-07-01' }), T({ id: 2, period: '2026-07-05' })]
    expect(groupDaysWithMoves(txns, []).map(([d, rows]) => [d, rows.length]))
      .toEqual(groupByDay(txns).map(([d, rows]) => [d, rows.length]))
  })
})
