import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { DEFAULT_BUDGET, type BudgetCfg } from '../../data/defaults'
import {
  budgetPeriod, budgetIncome, spendingByBucket, monthPieData, budgetSummary,
  bucketTone, hiddenCostIn,
} from './budget'

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 0,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

describe('budgetPeriod', () => {
  it('runs from the reset day on/before today to the next reset day', () => {
    expect(budgetPeriod(new Date(2026, 6, 20), 1)).toEqual(['2026-07-01', '2026-08-01'])
    // Before this month's reset day → previous period.
    expect(budgetPeriod(new Date(2026, 6, 3), 5)).toEqual(['2026-06-05', '2026-07-05'])
    // On the reset day → new period starts today.
    expect(budgetPeriod(new Date(2026, 6, 5), 5)).toEqual(['2026-07-05', '2026-08-05'])
  })

  it('clamps the reset day to the month length', () => {
    // Feb 2026 has 28 days → a reset day of 31 clamps to the 28th.
    expect(budgetPeriod(new Date(2026, 1, 15), 31)).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('wraps across year boundaries', () => {
    expect(budgetPeriod(new Date(2026, 11, 20), 1)).toEqual(['2026-12-01', '2027-01-01'])
    expect(budgetPeriod(new Date(2026, 0, 3), 10)).toEqual(['2025-12-10', '2026-01-10'])
  })
})

describe('budgetIncome', () => {
  const cfg = (over: Partial<BudgetCfg>): BudgetCfg => ({ ...DEFAULT_BUDGET, ...over })

  it('fixed mode returns the set amount', () => {
    expect(budgetIncome([], cfg({ mode: 'fixed', fixedIncome: 42000 }))).toBe(42000)
  })

  it('rolling mode averages the last N completed months of income', () => {
    const txns: Txn[] = [
      T({ id: 1, period: '2026-04-25', type: 'Income', amount: 30000 }),
      T({ id: 2, period: '2026-05-25', type: 'Income', amount: 40000 }),
      T({ id: 3, period: '2026-06-25', type: 'Income', amount: 50000 }),
      // Current month (July) is incomplete → excluded.
      T({ id: 4, period: '2026-07-05', type: 'Income', amount: 99999 }),
      // Expenses ignored.
      T({ id: 5, period: '2026-06-10', type: 'Expense', amount: 8000 }),
    ]
    const today = new Date(2026, 6, 15)
    expect(budgetIncome(txns, cfg({ mode: 'rolling', rollingMonths: 3 }), today)).toBe(40000)
    // Only the last 2 completed months (May, Jun).
    expect(budgetIncome(txns, cfg({ mode: 'rolling', rollingMonths: 2 }), today)).toBe(45000)
  })
})

describe('spendingByBucket', () => {
  it('sums expenses per Needs/Wants using the assignment map', () => {
    const txns = [
      T({ id: 1, period: '2026-07-02', category: 'Food', amount: 1200 }), // Needs
      T({ id: 2, period: '2026-07-04', category: 'Bills', amount: 3400 }), // Needs
      T({ id: 3, period: '2026-07-06', category: 'Travel', amount: 2000 }), // Wants
      T({ id: 4, period: '2026-07-06', category: 'Mystery', amount: 500 }), // unknown → Wants
      T({ id: 5, period: '2026-08-01', category: 'Food', amount: 999 }), // outside window
      T({ id: 6, period: '2026-07-06', type: 'Income', category: 'Salary', amount: 9 }), // not expense
    ]
    const spent = spendingByBucket(txns, '2026-07-01', '2026-08-01', DEFAULT_BUDGET.assignments)
    expect(spent).toEqual({ Needs: 4600, Wants: 2500 })
  })
})

describe('monthPieData', () => {
  const A = DEFAULT_BUDGET.assignments

  it('under budget: keeps a Remaining slice, no overflow', () => {
    const txns = [
      T({ id: 1, period: '2026-07-02', category: 'Food', amount: 1000 }),
      T({ id: 2, period: '2026-07-04', category: 'Travel', amount: 500 }),
    ]
    const d = monthPieData(txns, '2026-07', 10000, A)
    expect(d.over).toBe(false)
    expect(d.total).toBe(1500)
    expect(d.remaining).toBe(8500)
    expect(d.list).toHaveLength(0)
    // Needs (Food) is ordered before Wants (Travel).
    expect(d.pie.map((p) => p.label)).toEqual(['Food', 'Travel'])
  })

  it('over budget: Needs fill first, the rest spills to the overflow list', () => {
    const txns = [
      T({ id: 1, period: '2026-07-02', category: 'Bills', amount: 6000 }), // Needs
      T({ id: 2, period: '2026-07-03', category: 'Food', amount: 3000 }), // Needs
      T({ id: 3, period: '2026-07-04', category: 'Travel', amount: 4000 }), // Wants
    ]
    const d = monthPieData(txns, '2026-07', 8000, A)
    expect(d.over).toBe(true)
    expect(d.total).toBe(13000)
    expect(d.remaining).toBe(0)
    // Bills(6000) fits; Food(3000) pushes cum to 9000 ≥ budget so it still draws,
    // but Travel then overflows. Needs are protected, Wants get cut.
    expect(d.pie.map((p) => p.label)).toEqual(['Bills', 'Food'])
    expect(d.list.map((p) => p.label)).toEqual(['Travel'])
  })
})

describe('budgetSummary', () => {
  it('computes targets, spend and savings-as-leftover', () => {
    const txns = [
      T({ id: 1, period: '2026-07-02', category: 'Food', amount: 5000 }), // Needs
      T({ id: 2, period: '2026-07-04', category: 'Travel', amount: 3000 }), // Wants
    ]
    const cfg: BudgetCfg = { ...DEFAULT_BUDGET, mode: 'fixed', fixedIncome: 20000 }
    const s = budgetSummary(txns, cfg, 1, new Date(2026, 6, 15))
    expect(s.income).toBe(20000)
    expect(s.buckets.Needs).toEqual({ target: 10000, spent: 5000, remaining: 5000 })
    expect(s.buckets.Wants).toEqual({ target: 6000, spent: 3000, remaining: 3000 })
    // Savings actual = income − needs − wants = 12000; target = 4000; ahead 8000.
    expect(s.buckets.Savings).toEqual({ target: 4000, spent: 12000, remaining: 8000 })
  })
})

describe('bucketTone', () => {
  it('Needs/Wants: less is better', () => {
    expect(bucketTone('Needs', 40, 100)).toBe('good')
    expect(bucketTone('Wants', 70, 100)).toBe('warn')
    expect(bucketTone('Needs', 90, 100)).toBe('bad')
  })
  it('Savings: more is better', () => {
    expect(bucketTone('Savings', 95, 100)).toBe('good')
    expect(bucketTone('Savings', 70, 100)).toBe('warn')
    expect(bucketTone('Savings', 40, 100)).toBe('bad')
  })
})

describe('hiddenCostIn', () => {
  it('is Σ Adjustment-Out − Σ Adjustment-In, clamped at 0', () => {
    const txns = [
      T({ id: 1, period: '2026-07-05', type: 'Adjustment-Out', amount: 800 }),
      T({ id: 2, period: '2026-07-06', type: 'Adjustment-In', amount: 300 }),
    ]
    expect(hiddenCostIn(txns, '2026-07-01', '2026-08-01')).toBe(500)
    // Net-positive adjustments → clamped to 0.
    expect(hiddenCostIn([T({ id: 3, period: '2026-07-05', type: 'Adjustment-In', amount: 100 })], '2026-07-01', '2026-08-01')).toBe(0)
  })
})
