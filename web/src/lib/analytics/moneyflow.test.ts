import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { buildFlow } from './moneyflow'

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 0,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

const MS = 86_400_000

describe('buildFlow', () => {
  it('is empty for no signed rows', () => {
    expect(buildFlow([]).bars).toHaveLength(0)
    expect(buildFlow([T({ id: 1, type: 'Saving', amount: 5 })]).bars).toHaveLength(0)
  })

  it('runs the cumulative balance and marks income-like bars', () => {
    const txns = [
      T({ id: 1, period: '2026-07-01', type: 'Income', amount: 100, account: 'Bank Accounts' }),
      T({ id: 2, period: '2026-07-02', type: 'Expense', amount: 30, account: 'Cash' }),
      T({ id: 3, period: '2026-07-03', type: 'Income', amount: 50, account: 'Bank Accounts' }),
    ]
    const f = buildFlow(txns)
    expect(f.bars).toHaveLength(3)
    expect(f.netWorth).toBe(120)

    const income1 = f.bars[0]
    expect(income1.incomeLike).toBe(true)
    expect(income1.base).toBe(0) // rises 0→100
    expect(income1.height).toBe(100)
    expect(income1.cumAfter).toBe(100)

    const expense = f.bars[1]
    expect(expense.incomeLike).toBe(false)
    expect(expense.base).toBe(70) // drops 100→70
    expect(expense.height).toBe(30)

    expect(f.latestBalances).toEqual({ 'Bank Accounts': 150, Cash: -30 })
    expect(f.accounts).toEqual(['Bank Accounts', 'Cash'])
  })

  it('packs a busy day into widths proportional to amount share', () => {
    const txns = [
      T({ id: 1, period: '2026-07-05', type: 'Income', amount: 100 }),
      T({ id: 2, period: '2026-07-05', type: 'Income', amount: 300 }),
    ]
    const f = buildFlow(txns)
    expect(f.bars).toHaveLength(2)
    const totalWidth = f.bars.reduce((s, b) => s + b.widthMs, 0)
    expect(totalWidth).toBeCloseTo(0.9 * MS, 3) // 90% of the day, split 1:3
    expect(f.bars[0].widthMs).toBeCloseTo(0.9 * 0.25 * MS, 3)
    expect(f.bars[1].widthMs).toBeCloseTo(0.9 * 0.75 * MS, 3)
    expect(f.bars[1].x).toBeGreaterThan(f.bars[0].x) // packed left → right
  })

  it('bridges a quiet day with a dashed connector at the carried level', () => {
    const txns = [
      T({ id: 1, period: '2026-07-01', type: 'Income', amount: 100 }),
      // 2026-07-02 is empty
      T({ id: 2, period: '2026-07-03', type: 'Income', amount: 20 }),
    ]
    const f = buildFlow(txns)
    // One [start, end, null] segment for the single gap day at level 100.
    expect(f.connectors.y.slice(0, 2)).toEqual([100, 100])
    expect(f.connectors.x[2]).toBeNull()
    const gapStart = new Date('2026-07-02T00:00:00Z').getTime()
    expect(f.connectors.x[0]).toBe(gapStart)
    expect(f.connectors.x[1]).toBe(gapStart + MS)
  })

  it('sums Adjustment legs into the hidden-cost figure', () => {
    const txns = [
      T({ id: 1, period: '2026-07-01', type: 'Income', amount: 100 }),
      T({ id: 2, period: '2026-07-02', type: 'Adjustment-Out', amount: 15 }),
    ]
    const f = buildFlow(txns)
    expect(f.hidden).toBe(-15)
    expect(f.netWorth).toBe(85)
  })

  it('marks alternating month bands across the data', () => {
    const txns = [
      T({ id: 1, period: '2026-06-01', type: 'Income', amount: 10 }),
      T({ id: 2, period: '2026-08-20', type: 'Income', amount: 10 }),
    ]
    const f = buildFlow(txns)
    expect(f.months.map((m) => m.shaded)).toEqual([false, true, false]) // Jun, Jul, Aug
  })
})
