import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { DEFAULT_BUDGET, type BudgetCfg } from '../../data/defaults'
import {
  budgetPeriod, budgetIncome, spendingByBucket, monthPieData, budgetSummary,
  bucketTone, hiddenCostIn, bucketForTxn, subcatMonthVsAvg,
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

  it('honours a sub-category override, moving that subcat’s spend to the other bucket', () => {
    const txns = [
      T({ id: 1, period: '2026-07-02', category: 'Food', subcategory: 'Lunch', amount: 1000 }), // Needs (parent)
      T({ id: 2, period: '2026-07-03', category: 'Food', subcategory: 'Dinner', amount: 400 }), // → Wants (override)
      T({ id: 3, period: '2026-07-04', category: 'Food', amount: 100 }), // blank subcat → parent Needs
    ]
    const subAssignments = { Food: { Dinner: 'Wants' as const } }
    const spent = spendingByBucket(txns, '2026-07-01', '2026-08-01', DEFAULT_BUDGET.assignments, subAssignments)
    expect(spent).toEqual({ Needs: 1100, Wants: 400 })
  })
})

describe('bucketForTxn', () => {
  const A = { Food: 'Needs' as const }
  it('uses a sub-override, else the category, else Wants', () => {
    const S = { Food: { Dinner: 'Wants' as const } }
    expect(bucketForTxn('Food', 'Dinner', A, S)).toBe('Wants') // override
    expect(bucketForTxn('Food', 'Lunch', A, S)).toBe('Needs') // parent
    expect(bucketForTxn('Food', undefined, A, S)).toBe('Needs') // blank → parent
    expect(bucketForTxn('Mystery', 'x', A, S)).toBe('Wants') // unknown → Wants
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

  it('splits a category with a sub-override into "cat" + "cat:subcat" items', () => {
    const txns = [
      T({ id: 1, period: '2026-07-02', category: 'Food', subcategory: 'Lunch', amount: 1000 }),
      T({ id: 2, period: '2026-07-03', category: 'Food', subcategory: 'Dinner', amount: 400 }),
    ]
    const d = monthPieData(txns, '2026-07', 10000, A, { Food: { Dinner: 'Wants' } })
    // Food (Needs, 1000) ordered before the split Food:Dinner (Wants, 400).
    expect(d.pie.map((p) => [p.label, p.bucket, p.amount])).toEqual([
      ['Food', 'Needs', 1000],
      ['Food:Dinner', 'Wants', 400],
    ])
    expect(d.total).toBe(1400) // total preserved by the split
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

describe('subcatMonthVsAvg', () => {
  it('cuts the current month at today’s day-of-month and averages over the full window', () => {
    const today = new Date(2026, 6, 15) // 15 Jul 2026 → current month, cutoff day 15
    const txns = [
      // Current month (July): only spend on/before the 15th counts.
      T({ id: 1, period: '2026-07-05', category: 'Food', subcategory: 'Lunch', amount: 1000 }),
      T({ id: 2, period: '2026-07-20', category: 'Food', subcategory: 'Lunch', amount: 500 }), // after cutoff → excluded
      // Window = the 3 months before July: June, May, April (each cut at the 15th).
      T({ id: 3, period: '2026-06-10', category: 'Food', subcategory: 'Lunch', amount: 600 }),
      T({ id: 4, period: '2026-06-25', category: 'Food', subcategory: 'Lunch', amount: 9999 }), // after the 15th → excluded
      // May: nothing → contributes 0 to the average.
      T({ id: 5, period: '2026-04-03', category: 'Food', subcategory: 'Lunch', amount: 300 }),
    ]
    const groups = subcatMonthVsAvg(txns, '2026-07', 3, today)
    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBe('Food')
    // cur = 1000 (July 5 only); avg = (600 + 0 + 300) / 3 = 300.
    expect(groups[0].rows).toEqual([{ sub: 'Lunch', cur: 1000, avg: 300 }])
    expect(groups[0].cur).toBe(1000)
    expect(groups[0].avg).toBe(300)
  })

  it('normalises a blank sub-category to “—”, sums group totals, and drops zero/zero rows', () => {
    const today = new Date(2026, 6, 15)
    const txns = [
      T({ id: 1, period: '2026-07-02', category: 'Food', subcategory: 'Lunch', amount: 100 }),
      T({ id: 2, period: '2026-07-03', category: 'Food', amount: 50 }), // blank sub → “—”
      T({ id: 3, period: '2026-07-04', category: 'Food', subcategory: 'Snack', amount: 0 }), // zero on both sides → dropped
      T({ id: 4, period: '2026-06-08', category: 'Food', subcategory: 'Lunch', amount: 200 }),
    ]
    const groups = subcatMonthVsAvg(txns, '2026-07', 1, today) // window = June only
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.cur).toBe(150) // 100 + 50, Snack excluded
    expect(g.avg).toBe(200) // Lunch 200 / 1
    expect(g.rows.map((r) => r.sub).sort()).toEqual(['Lunch', '—'])
    expect(g.rows.find((r) => r.sub === 'Snack')).toBeUndefined()
  })

  it('for a past (non-current) month uses the full month for both sides', () => {
    const today = new Date(2026, 6, 15) // today is July; asking about May
    const txns = [
      T({ id: 1, period: '2026-05-20', category: 'Food', subcategory: 'Lunch', amount: 700 }), // day 20 counts (full month)
      T({ id: 2, period: '2026-04-28', category: 'Food', subcategory: 'Lunch', amount: 400 }),
    ]
    const groups = subcatMonthVsAvg(txns, '2026-05', 1, today) // window = April
    expect(groups[0].rows).toEqual([{ sub: 'Lunch', cur: 700, avg: 400 }])
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
