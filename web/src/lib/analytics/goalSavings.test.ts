import { describe, it, expect } from 'vitest'
import {
  UNALLOCATED, allocations, unallocatedAmount, goalStandings, goalTone, savingsActivity,
  fundedPct, nextGoal,
  type GoalMove, type GoalStanding,
} from './goalSavings'
import { savingsBalance } from './goals'
import type { Txn } from '../../db'

const EF = 'Emergency Fund'

let nextId = 1
const move = (from: string, to: string, amount: number, period = '2026-07-10'): GoalMove =>
  ({ id: nextId++, period, from, to, amount })

const txn = (o: Partial<Txn> & { account: string; amount: number; type: Txn['type'] }): Txn => ({
  id: nextId++, period: '2026-07-10', category: 'x', currency: 'THB', ...o,
})

describe('allocations', () => {
  it('adds to the destination and subtracts from the source', () => {
    const moves = [move(UNALLOCATED, 'Car', 5000), move(UNALLOCATED, 'Italy', 3000)]
    expect(allocations(moves)).toEqual({ Car: 5000, Italy: 3000 })
  })

  it('ignores the unallocated end of a move', () => {
    // Money returning to the pool must not create an "" goal.
    const moves = [move(UNALLOCATED, 'Car', 5000), move('Car', UNALLOCATED, 2000)]
    expect(allocations(moves)).toEqual({ Car: 3000 })
  })

  it('lets a goal go negative when more was taken out than it held', () => {
    expect(allocations([move('Car', UNALLOCATED, 500)])).toEqual({ Car: -500 })
  })

  it('is empty with no moves', () => {
    expect(allocations([])).toEqual({})
  })
})

describe('unallocatedAmount', () => {
  it('is the whole pool when nothing is earmarked', () => {
    expect(unallocatedAmount(10000, [])).toBe(10000)
  })

  it('drops by whatever the goals hold', () => {
    expect(unallocatedAmount(10000, [move(UNALLOCATED, 'Car', 6000)])).toBe(4000)
  })

  it('is UNCHANGED by a goal-to-goal move', () => {
    // The whole reason direct goal→goal moves need no special handling.
    const base = [move(UNALLOCATED, 'Car', 6000)]
    const before = unallocatedAmount(10000, base)
    const after = unallocatedAmount(10000, [...base, move('Car', 'Italy', 2000)])
    expect(after).toBe(before)
    expect(allocations([...base, move('Car', 'Italy', 2000)])).toEqual({ Car: 4000, Italy: 2000 })
  })

  it('goes negative when money leaves the pool without leaving a goal first', () => {
    // 10,000 in savings, all of it earmarked, then 8,000 is transferred out.
    const moves = [move(UNALLOCATED, 'Car', 10000)]
    expect(unallocatedAmount(2000, moves)).toBe(-8000)
  })

  it('stays flat when a transfer out is tagged to the goal that funded it', () => {
    // Pool 10,000 → 0 and the goal gives up the same 10,000.
    const moves = [move(UNALLOCATED, 'Car', 10000), move('Car', UNALLOCATED, 10000)]
    expect(unallocatedAmount(0, moves)).toBe(0)
    expect(allocations(moves)).toEqual({ Car: 0 })
  })

  it('agrees with savingsBalance over the pool accounts', () => {
    const txns = [
      txn({ account: 'Savings', amount: 10000, type: 'Transfer-In' }),
      txn({ account: 'Savings', amount: 2000, type: 'Transfer-Out' }),
      txn({ account: 'Cash', amount: 500, type: 'Expense' }), // not a pool account
    ]
    const pool = savingsBalance(txns, ['Savings'])
    expect(pool).toBe(8000)
    expect(unallocatedAmount(pool, [move(UNALLOCATED, 'Car', 3000)])).toBe(5000)
  })
})

describe('goalTone', () => {
  it('is inverted — more is better', () => {
    expect(goalTone(90, 100)).toBe('good')
    expect(goalTone(100, 100)).toBe('good')
    expect(goalTone(150, 100)).toBe('good') // over-funding a goal is not a warning
    expect(goalTone(89, 100)).toBe('warn')
    expect(goalTone(65, 100)).toBe('warn')
    expect(goalTone(64, 100)).toBe('bad')
    expect(goalTone(0, 100)).toBe('bad')
  })

  it('treats a missing target as unfunded rather than dividing by zero', () => {
    expect(goalTone(500, 0)).toBe('bad')
  })
})

describe('goalStandings', () => {
  const goals = { Car: 300000, Italy: 100000 } // insertion order = user priority

  it('puts the Emergency Fund first, then the goals in their stored order', () => {
    const rows = goalStandings([], goals, 60000, EF)
    expect(rows.map((r) => r.name)).toEqual([EF, 'Car', 'Italy'])
    expect(rows[0].isEmergencyFund).toBe(true)
    expect(rows[1].isEmergencyFund).toBe(false)
  })

  it('reports each goal’s allocation, ratio and target', () => {
    const rows = goalStandings([move(UNALLOCATED, 'Italy', 50000)], goals, 60000, EF)
    const italy = rows.find((r) => r.name === 'Italy')!
    expect(italy.allocated).toBe(50000)
    expect(italy.target).toBe(100000)
    expect(italy.ratio).toBe(0.5)
    expect(italy.tone).toBe('bad')
  })

  it('includes the Emergency Fund as an allocation target', () => {
    const rows = goalStandings([move(UNALLOCATED, EF, 60000)], goals, 60000, EF)
    expect(rows[0].allocated).toBe(60000)
    expect(rows[0].ratio).toBe(1)
    expect(rows[0].tone).toBe('good')
  })

  it('does not care whether a goal is ticked into the pool target', () => {
    // `selected` sizes the pool cap; it has nothing to do with holding money.
    const rows = goalStandings([move(UNALLOCATED, 'Car', 1000)], goals, 0, EF)
    expect(rows.find((r) => r.name === 'Car')!.allocated).toBe(1000)
  })

  it('leaves a goal with no allocation at zero rather than absent', () => {
    const rows = goalStandings([], goals, 60000, EF)
    expect(rows.map((r) => r.allocated)).toEqual([0, 0, 0])
  })
})

describe('savingsActivity', () => {
  it('lists every row touching a pool account with its effect on the pool', () => {
    const txns = [
      txn({ account: 'Savings', amount: 10000, type: 'Transfer-In' }),
      txn({ account: 'Savings', amount: 2000, type: 'Transfer-Out' }),
      txn({ account: 'Savings', amount: 300, type: 'Income' }), // interest paid in
      txn({ account: 'Cash', amount: 500, type: 'Expense' }),
    ]
    const rows = savingsActivity(txns, [], ['Savings'])
    expect(rows).toHaveLength(3) // the Cash row is not pool activity
    expect(rows.map((r) => (r.kind === 'txn' ? r.delta : 0)).sort((a, b) => a - b))
      .toEqual([-2000, 300, 10000])
  })

  it('interleaves goal moves by day, after the real movements of that day', () => {
    const txns = [txn({ account: 'Savings', amount: 10000, type: 'Transfer-In', period: '2026-07-10' })]
    const moves = [
      move(UNALLOCATED, 'Car', 6000, '2026-07-10'),
      move('Car', 'Italy', 1000, '2026-07-12'),
    ]
    const rows = savingsActivity(txns, moves, ['Savings'])
    expect(rows.map((r) => r.day)).toEqual(['2026-07-12', '2026-07-10', '2026-07-10'])
    expect(rows.map((r) => r.kind)).toEqual(['move', 'txn', 'move'])
  })

  it('is empty when no pool account has been touched', () => {
    expect(savingsActivity([txn({ account: 'Cash', amount: 1, type: 'Expense' })], [], ['Savings']))
      .toEqual([])
  })
})

describe('fundedPct', () => {
  it('turns a ratio into a whole percentage', () => {
    expect(fundedPct(0.4237)).toBe(42)
    expect(fundedPct(0)).toBe(0)
  })

  it('clamps an overfunded goal to a full bar', () => {
    expect(fundedPct(1.8)).toBe(100)
  })

  it('clamps a goal that went negative to an empty bar, not a backwards one', () => {
    // Real state: money left the pool without first being taken out of the goal.
    expect(fundedPct(-0.35)).toBe(0)
  })

  it('survives a goal with no target', () => {
    expect(fundedPct(Number.NaN)).toBe(0)
    expect(fundedPct(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('nextGoal', () => {
  const stand = (name: string, allocated: number, target: number): GoalStanding => ({
    name, allocated, target,
    ratio: target > 0 ? allocated / target : 0,
    tone: goalTone(allocated, target),
    isEmergencyFund: name === EF,
  })

  it('takes the top of the user’s order, not the goal closest to done', () => {
    const rows = [stand(EF, 6000, 60000), stand('Car', 9000, 10000)]
    expect(nextGoal(rows)!.name).toBe(EF)
  })

  it('skips a finished Emergency Fund and moves down the order', () => {
    const rows = [stand(EF, 60000, 60000), stand('Car', 0, 10000), stand('Italy', 0, 5000)]
    expect(nextGoal(rows)!.name).toBe('Car')
  })

  it('skips every funded goal, including an overfunded one', () => {
    const rows = [stand(EF, 60000, 60000), stand('Car', 12000, 10000), stand('Italy', 100, 5000)]
    expect(nextGoal(rows)!.name).toBe('Italy')
  })

  it('returns null once everything with a target is funded', () => {
    expect(nextGoal([stand(EF, 60000, 60000), stand('Car', 10000, 10000)])).toBeNull()
  })

  it('ignores goals with no target to fund', () => {
    // An Emergency Fund sized 0 (monthlyRequired never set) is not "unfunded".
    const rows = [stand(EF, 0, 0), stand('Car', 0, 10000)]
    expect(nextGoal(rows)!.name).toBe('Car')
  })

  it('returns null when there are no goals at all', () => {
    expect(nextGoal([])).toBeNull()
  })
})
