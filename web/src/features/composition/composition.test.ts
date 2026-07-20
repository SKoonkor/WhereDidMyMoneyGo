import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { categoryBreakdown, sliceTotal } from '../../lib/analytics/composition'
import { shade, buildDonutFigure, buildBarsFigure, RAMP } from './figure'

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
