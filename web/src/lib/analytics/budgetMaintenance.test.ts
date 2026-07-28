import { describe, it, expect } from 'vitest'
import { DEFAULT_BUDGET, type BudgetCfg } from '../../data/defaults'
import { remapBudget } from './budgetMaintenance'

const cfg = (over: Partial<BudgetCfg> = {}): BudgetCfg => ({
  ...DEFAULT_BUDGET,
  assignments: { Food: 'Needs', Travel: 'Wants' },
  subAssignments: { Food: { Dinner: 'Wants' } },
  limits: {
    categories: { Food: 8000, Travel: 3000 },
    subcategories: { Food: { Dinner: 3000, Coffee: 800 } },
    warnAt: 500,
  },
  ...over,
})

describe('remapBudget — category rename', () => {
  const out = remapBudget(cfg(), { kind: 'category', from: 'Food', to: 'Meals' })

  it('carries the bucket, the sub-overrides and both limit maps across', () => {
    expect(out.assignments).toEqual({ Meals: 'Needs', Travel: 'Wants' })
    expect(out.subAssignments).toEqual({ Meals: { Dinner: 'Wants' } })
    expect(out.limits.categories).toEqual({ Meals: 8000, Travel: 3000 })
    expect(out.limits.subcategories).toEqual({ Meals: { Dinner: 3000, Coffee: 800 } })
  })

  it('leaves the input untouched', () => {
    const src = cfg()
    remapBudget(src, { kind: 'category', from: 'Food', to: 'Meals' })
    expect(src.assignments.Food).toBe('Needs')
    expect(src.limits.categories.Food).toBe(8000)
  })

  it('is a no-op for an unknown or unchanged name', () => {
    const same = remapBudget(cfg(), { kind: 'category', from: 'Food', to: 'Food' })
    expect(same.limits.categories).toEqual({ Food: 8000, Travel: 3000 })
    const missing = remapBudget(cfg(), { kind: 'category', from: 'Ghost', to: 'X' })
    expect(missing.assignments).toEqual({ Food: 'Needs', Travel: 'Wants' })
  })
})

describe('remapBudget — category delete', () => {
  const out = remapBudget(cfg(), { kind: 'category-delete', name: 'Travel', into: 'Other' })

  // The rows are funnelled into Other, so the bucket should follow them…
  it('moves the bucket to the destination', () => {
    expect(out.assignments).toEqual({ Food: 'Needs', Other: 'Wants' })
  })

  // …but a cap set on Travel must NOT start capping Other, which holds
  // unrelated spending. Dropping it is the honest outcome.
  it('drops the limit rather than transferring it', () => {
    expect(out.limits.categories).toEqual({ Food: 8000 })
    expect('Other' in out.limits.categories).toBe(false)
  })

  it('drops the deleted category’s sub entries too', () => {
    const withSubs = remapBudget(cfg(), { kind: 'category-delete', name: 'Food', into: 'Other' })
    expect(withSubs.subAssignments).toEqual({})
    expect(withSubs.limits.subcategories).toEqual({})
  })

  it('does not clobber an existing bucket on the destination', () => {
    const c = cfg({ assignments: { Food: 'Needs', Travel: 'Wants', Other: 'Needs' } })
    const o = remapBudget(c, { kind: 'category-delete', name: 'Travel', into: 'Other' })
    expect(o.assignments.Other).toBe('Needs')
  })
})

describe('remapBudget — subcategory rename', () => {
  const out = remapBudget(cfg(), { kind: 'sub', category: 'Food', from: 'Dinner', to: 'Supper' })

  it('carries the override and the sub limit across', () => {
    expect(out.subAssignments).toEqual({ Food: { Supper: 'Wants' } })
    expect(out.limits.subcategories).toEqual({ Food: { Supper: 3000, Coffee: 800 } })
  })

  it('leaves the category-level limit alone', () => {
    expect(out.limits.categories).toEqual({ Food: 8000, Travel: 3000 })
  })
})

describe('remapBudget — subcategory delete', () => {
  const out = remapBudget(cfg(), { kind: 'sub-delete', category: 'Food', name: 'Dinner' })

  it('removes just that sub entry', () => {
    expect(out.subAssignments).toEqual({})
    expect(out.limits.subcategories).toEqual({ Food: { Coffee: 800 } })
  })

  // The rows keep their category, so the umbrella limit still covers them.
  it('keeps the category limit', () => {
    expect(out.limits.categories).toEqual({ Food: 8000, Travel: 3000 })
  })

  it('prunes a map that empties out', () => {
    const once = remapBudget(cfg(), { kind: 'sub-delete', category: 'Food', name: 'Dinner' })
    const twice = remapBudget(once, { kind: 'sub-delete', category: 'Food', name: 'Coffee' })
    expect(twice.limits.subcategories).toEqual({})
  })
})
