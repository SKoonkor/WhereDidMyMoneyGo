import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import type { SpendingLimits } from '../../data/defaults'
import { spendingBySubcategory, limitStatuses, limitAlerts } from './budget'

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 0,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

const LIMITS = (over: Partial<SpendingLimits> = {}): SpendingLimits => ({
  categories: {}, subcategories: {}, warnAt: 500, ...over,
})

const START = '2026-07-01'
const END = '2026-08-01'

describe('spendingBySubcategory', () => {
  const txns = [
    T({ period: '2026-07-02', amount: 100, subcategory: 'Lunch' }),
    T({ period: '2026-07-03', amount: 50, subcategory: 'Lunch' }),
    T({ period: '2026-07-04', amount: 200, subcategory: 'Dinner' }),
    T({ period: '2026-07-05', amount: 30 }), // untagged
    T({ period: '2026-07-06', amount: 900, category: 'Travel' }),
  ]

  it('groups by category and by category+sub in one pass', () => {
    const s = spendingBySubcategory(txns, START, END)
    expect(s.byCategory).toEqual({ Food: 380, Travel: 900 })
    expect(s.bySub).toEqual({ Food: { Lunch: 150, Dinner: 200, '': 30 }, Travel: { '': 900 } })
  })

  it('keeps a category total equal to the sum of its subs', () => {
    const s = spendingBySubcategory(txns, START, END)
    const summed = Object.values(s.bySub.Food).reduce((a, b) => a + b, 0)
    expect(summed).toBe(s.byCategory.Food)
  })

  it('files untagged rows under empty string, not the display sentinel', () => {
    const s = spendingBySubcategory([T({ amount: 30 })], START, END)
    expect(s.bySub.Food['']).toBe(30)
    expect(s.bySub.Food['—']).toBeUndefined()
  })

  // Note the contrast with the private sumBySubcat, whose end is inclusive.
  it('treats the end date as exclusive', () => {
    const rows = [T({ period: '2026-07-31', amount: 10 }), T({ period: '2026-08-01', amount: 99 })]
    expect(spendingBySubcategory(rows, START, END).byCategory).toEqual({ Food: 10 })
  })

  it('ignores anything that is not an expense', () => {
    const rows = [
      T({ amount: 10 }),
      T({ amount: 5000, type: 'Income', category: 'Salary' }),
      T({ amount: 500, type: 'Transfer-Out', category: 'Savings' }),
    ]
    expect(spendingBySubcategory(rows, START, END).byCategory).toEqual({ Food: 10 })
  })
})

describe('limitStatuses', () => {
  const txns = [
    T({ period: '2026-07-02', amount: 3000, subcategory: 'Lunch' }),
    T({ period: '2026-07-03', amount: 2000, subcategory: 'Dinner' }),
    T({ period: '2026-07-04', amount: 500 }), // untagged Food
  ]

  it('returns nothing when no limits are set', () => {
    expect(limitStatuses(txns, LIMITS(), START, END)).toEqual([])
  })

  // A category limit is an umbrella: it covers subbed AND untagged rows.
  it('counts every row in the category for a category limit', () => {
    const [s] = limitStatuses(txns, LIMITS({ categories: { Food: 8000 } }), START, END)
    expect(s.spent).toBe(5500)
    expect(s.remaining).toBe(2500)
    expect(s.sub).toBeUndefined()
    expect(s.label).toBe('Food')
  })

  it('counts only its own rows for a sub limit', () => {
    const [s] = limitStatuses(txns, LIMITS({ subcategories: { Food: { Lunch: 4000 } } }), START, END)
    expect(s.spent).toBe(3000)
    expect(s.sub).toBe('Lunch')
    expect(s.label).toBe('Food / Lunch')
  })

  it('reports both when a category and one of its subs are limited', () => {
    const out = limitStatuses(
      txns,
      LIMITS({ categories: { Food: 8000 }, subcategories: { Food: { Lunch: 4000 } } }),
      START, END,
    )
    expect(out).toHaveLength(2)
    expect(out.map((s) => s.spent).sort((a, b) => a - b)).toEqual([3000, 5500])
  })

  it('goes negative once overspent', () => {
    const [s] = limitStatuses(txns, LIMITS({ categories: { Food: 5000 } }), START, END)
    expect(s.remaining).toBe(-500)
    expect(s.tone).toBe('bad')
  })

  it('reports an unspent limit as clean', () => {
    const [s] = limitStatuses([], LIMITS({ categories: { Food: 5000 } }), START, END)
    expect(s).toMatchObject({ spent: 0, remaining: 5000, ratio: 0, tone: 'good' })
  })

  it('applies the shared 75/95 tone thresholds', () => {
    const at = (amount: number) =>
      limitStatuses([T({ amount })], LIMITS({ categories: { Food: 1000 } }), START, END)[0].tone
    expect(at(740)).toBe('good')
    expect(at(760)).toBe('warn')
    expect(at(960)).toBe('bad')
  })

  // Ranked by ratio, so the order matches the bars on screen — not by raw
  // headroom, which would put the tiny limit first.
  it('ranks the proportionally tightest limit first', () => {
    const rows = [
      T({ period: '2026-07-02', amount: 95_000, category: 'Big' }),
      T({ period: '2026-07-02', amount: 500, category: 'Small' }),
    ]
    const out = limitStatuses(
      rows, LIMITS({ categories: { Big: 100_000, Small: 1000 } }), START, END,
    )
    expect(out.map((s) => s.category)).toEqual(['Big', 'Small'])
    expect(out[0].remaining).toBeGreaterThan(out[1].remaining) // headroom disagrees
  })

  it('gives each entry a stable distinct key', () => {
    const out = limitStatuses(
      txns,
      LIMITS({ categories: { Food: 8000 }, subcategories: { Food: { Lunch: 4000 } } }),
      START, END,
    )
    expect(new Set(out.map((s) => s.key)).size).toBe(2)
    expect(out.map((s) => s.key).sort()).toEqual(['c:Food', 's:Food/Lunch'])
  })
})

describe('limitAlerts', () => {
  const statuses = (spent: number, limit = 1000) =>
    limitStatuses([T({ amount: spent })], LIMITS({ categories: { Food: limit } }), START, END)

  it('includes anything at or under the threshold', () => {
    expect(limitAlerts(statuses(500), 500)).toHaveLength(1) // exactly 500 left
    expect(limitAlerts(statuses(600), 500)).toHaveLength(1)
    expect(limitAlerts(statuses(1200), 500)).toHaveLength(1) // over
  })

  it('excludes anything with room to spare', () => {
    expect(limitAlerts(statuses(400), 500)).toEqual([])
  })

  // The absolute rule and the ratio-based colour genuinely disagree here; the
  // page shows a marker on these rows so the alert isn't unexplained.
  it('can fire on a limit whose bar is still green', () => {
    const s = statuses(600, 1000)
    expect(s[0].tone).toBe('good') // 60% used
    expect(limitAlerts(s, 500)).toHaveLength(1) // but only 400 left
  })
})
