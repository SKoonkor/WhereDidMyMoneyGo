import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import {
  categoryBreakdown, hiddenCost, sliceTotal,
  expenseBucketBreakdown, subcategoryBreakdown,
} from '../../lib/analytics/composition'
import { shade, buildDonutFigure, buildBarsFigure, RAMP } from './figure'
import { DEFAULT_BUDGET } from '../../data/defaults'

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 0,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

const ui = { ink: '#fff', muted: '#888', grid: '#333' }

describe('categoryBreakdown', () => {
  it('groups by category, amount-descending, filtered by type', () => {
    const rows = [
      T({ type: 'Expense', category: 'Food', amount: 100 }),
      T({ type: 'Expense', category: 'Food', amount: 50 }),
      T({ type: 'Expense', category: 'Bills', amount: 200 }),
      T({ type: 'Income', category: 'Salary', amount: 999 }), // ignored for Expense
    ]
    const b = categoryBreakdown(rows, 'Expense')
    expect(b).toEqual([{ category: 'Bills', amount: 200 }, { category: 'Food', amount: 150 }])
    expect(sliceTotal(b)).toBe(350)
  })

  it('folds everything past the slice cap into "Other"', () => {
    // 13 categories, cap 12 → 11 named + Other(sum of the smallest 2).
    const rows = Array.from({ length: 13 }, (_, i) =>
      T({ type: 'Expense', category: `C${i}`, amount: 100 - i }),
    )
    const b = categoryBreakdown(rows, 'Expense', 12, 'Other')
    expect(b).toHaveLength(12)
    expect(b[11].category).toBe('Other')
    expect(b[11].amount).toBe((100 - 11) + (100 - 12)) // tail folded
    // Total is preserved by the fold.
    expect(sliceTotal(b)).toBe(rows.reduce((s, r) => s + r.amount, 0))
  })

  it('returns nothing when the type is absent', () => {
    expect(categoryBreakdown([T({ type: 'Income', category: 'Salary', amount: 10 })], 'Expense')).toEqual([])
  })
})

describe('hiddenCost', () => {
  it('is Σ Adjustment-Out − Σ Adjustment-In, clamped ≥ 0', () => {
    const rows = [
      T({ type: 'Adjustment-Out', amount: 200 }),
      T({ type: 'Adjustment-In', amount: 50 }),
      T({ type: 'Expense', amount: 999 }), // ignored
    ]
    expect(hiddenCost(rows)).toBe(150)
    expect(hiddenCost([T({ type: 'Adjustment-In', amount: 30 })])).toBe(0) // net-positive → 0
  })
})

describe('hidden-cost slice colour', () => {
  it('paints a hidden slice slate, not from the expense ramp', () => {
    const slices = [
      { category: 'Food', amount: 150 },
      { category: 'Hidden cost', amount: 40, hidden: true },
    ]
    const fig = buildDonutFigure(slices, { total: 190, currency: 'THB', kind: 'expense', censor: false, ui, noData: 'No data' })
    const colors = (fig.data[0].marker as { colors: string[] }).colors
    expect(colors[1]).toBe('#5a6472') // slate for the hidden slice
    expect(colors[0]).not.toBe('#5a6472')
  })
})

describe('expenseBucketBreakdown', () => {
  const A = DEFAULT_BUDGET.assignments // Bills/Food/Household = Needs; Travel/Beauty default → Wants

  it('lists Needs (amount-desc) then Wants, tagged with bucket', () => {
    const rows = [
      T({ type: 'Expense', category: 'Food', amount: 100 }),
      T({ type: 'Expense', category: 'Travel', amount: 300 }),
      T({ type: 'Expense', category: 'Bills', amount: 200 }),
      T({ type: 'Income', category: 'Salary', amount: 999 }), // ignored
    ]
    expect(expenseBucketBreakdown(rows, A).map((s) => [s.category, s.bucket])).toEqual([
      ['Bills', 'Needs'], ['Food', 'Needs'], ['Travel', 'Wants'],
    ])
  })

  it('folds a bucket tail past the cap into "Other"', () => {
    // 9 Wants categories, cap 8 → 7 named + Other. (All default-Wants names.)
    const rows = Array.from({ length: 9 }, (_, i) => T({ type: 'Expense', category: `W${i}`, amount: 90 - i }))
    const wants = expenseBucketBreakdown(rows, A, 8, 'Other')
    expect(wants).toHaveLength(8)
    expect(wants[7]).toEqual({ category: 'Other', amount: (90 - 7) + (90 - 8), bucket: 'Wants' })
  })
})

describe('subcategoryBreakdown', () => {
  it('nests categories (total-desc) → subcategories (amount-desc); blanks → —', () => {
    const rows = [
      T({ type: 'Expense', category: 'Food', subcategory: 'Lunch', amount: 170 }),
      T({ type: 'Expense', category: 'Food', subcategory: 'Dinner', amount: 300 }),
      T({ type: 'Expense', category: 'Bills', amount: 1200 }),
    ]
    const g = subcategoryBreakdown(rows, 'Expense')
    expect(g.map((x) => [x.category, x.total])).toEqual([['Bills', 1200], ['Food', 470]])
    expect(g[1].subs).toEqual([{ name: 'Dinner', amount: 300 }, { name: 'Lunch', amount: 170 }])
    expect(g[0].subs).toEqual([{ name: '—', amount: 1200 }]) // blank subcategory normalised
  })
})

describe('bucket slice colours', () => {
  it('colours Needs from the blue ramp and Wants from the orange ramp', () => {
    const slices = [
      { category: 'Bills', amount: 200, bucket: 'Needs' as const },
      { category: 'Travel', amount: 300, bucket: 'Wants' as const },
    ]
    const fig = buildBarsFigure(slices, { currency: 'THB', kind: 'expense', censor: false, ui, noData: 'No data' })
    const colors = (fig.data[0].marker as { color: string[] }).color
    expect(colors[0]).toBe(shade(1, RAMP.needs)[0]) // Needs → blue
    expect(colors[1]).toBe(shade(1, RAMP.wants)[0]) // Wants → orange
  })
})

describe('shade', () => {
  it('samples n colours light → dark', () => {
    expect(shade(0, RAMP.income)).toEqual([])
    expect(shade(1, RAMP.expense)).toHaveLength(1)
    const three = shade(3, RAMP.income)
    expect(three).toHaveLength(3)
    expect(three[0]).toBe('#a7e8c4') // light end
    expect(three[2]).toBe('#0e6b3f') // dark end
    expect(three.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  })
})

describe('figures', () => {
  const slices = [{ category: 'Food', amount: 150 }, { category: 'Bills', amount: 200 }]

  it('donut: pie trace with centre total; censored hides value', () => {
    const fig = buildDonutFigure(slices, { total: 350, currency: 'THB', kind: 'expense', censor: false, ui, noData: 'No data' })
    expect(fig.data[0].type).toBe('pie')
    expect(fig.data[0].values).toEqual([150, 200])
    expect(String((fig.layout.annotations as { text: string }[])[0].text)).toContain('350')

    const c = buildDonutFigure(slices, { total: 350, currency: 'THB', kind: 'expense', censor: true, ui, noData: 'No data' })
    expect(String((c.layout.annotations as { text: string }[])[0].text)).toBe('*****')
    expect(c.data[0].hovertemplate).not.toContain('%{value')
  })

  it('donut: empty slices → No data annotation, no trace', () => {
    const fig = buildDonutFigure([], { total: 0, currency: 'THB', kind: 'income', censor: false, ui, noData: 'No data' })
    expect(fig.data).toHaveLength(0)
    expect((fig.layout.annotations as { text: string }[])[0].text).toBe('No data')
  })

  it('bars: locked interaction, hidden y-ticks when censored', () => {
    const fig = buildBarsFigure(slices, { currency: 'THB', kind: 'expense', censor: true, ui, noData: 'No data' })
    expect(fig.data[0].type).toBe('bar')
    expect(fig.layout.dragmode).toBe(false)
    expect((fig.layout.yaxis as { showticklabels: boolean }).showticklabels).toBe(false)
  })
})
