import { describe, it, expect } from 'vitest'
import { DEFAULT_LIMITS, DEFAULT_WARN_AT, normalizeLimits } from './defaults'

describe('normalizeLimits', () => {
  it('falls back to the default for unusable values', () => {
    for (const bad of [undefined, null, 'garbage', 42, {}]) {
      expect(normalizeLimits(bad)).toEqual(DEFAULT_LIMITS)
    }
  })

  // The reason this function exists: getBudget's spread is shallow, so a config
  // written before limits existed arrives with no warnAt at all — and
  // `remaining <= undefined` is false, so the alert would never fire.
  it('supplies warnAt when the stored object predates it', () => {
    const out = normalizeLimits({ categories: { Food: 5000 } })
    expect(out.warnAt).toBe(DEFAULT_WARN_AT)
    expect(out.categories).toEqual({ Food: 5000 })
    expect(out.subcategories).toEqual({})
  })

  it('rejects a non-numeric or negative warnAt', () => {
    expect(normalizeLimits({ warnAt: 'x' }).warnAt).toBe(DEFAULT_WARN_AT)
    expect(normalizeLimits({ warnAt: NaN }).warnAt).toBe(DEFAULT_WARN_AT)
    expect(normalizeLimits({ warnAt: -5 }).warnAt).toBe(DEFAULT_WARN_AT)
    expect(normalizeLimits({ warnAt: 0 }).warnAt).toBe(0) // "warn only once over" is legal
    expect(normalizeLimits({ warnAt: 1200 }).warnAt).toBe(1200)
  })

  it('drops amounts that are not a usable cap', () => {
    const out = normalizeLimits({
      categories: { Food: 5000, Travel: 0, Gift: -100, Bills: NaN, Car: 'x' },
    })
    expect(out.categories).toEqual({ Food: 5000 })
  })

  it('prunes sub-maps that end up empty', () => {
    const out = normalizeLimits({
      subcategories: { Food: { Lunch: 800, Dinner: 0 }, Travel: {}, Car: { Fuel: -1 } },
    })
    expect(out.subcategories).toEqual({ Food: { Lunch: 800 } })
  })

  it('round-trips a valid object', () => {
    const valid = {
      categories: { Food: 8000 },
      subcategories: { Food: { Dinner: 3000, Coffee: 800 } },
      warnAt: 500,
    }
    expect(normalizeLimits(valid)).toEqual(valid)
  })

  it('never shares structure with the input', () => {
    const src = { categories: { Food: 5000 }, subcategories: { Food: { Lunch: 1 } }, warnAt: 500 }
    const out = normalizeLimits(src)
    out.categories.Food = 1
    out.subcategories.Food.Lunch = 2
    expect(src.categories.Food).toBe(5000)
    expect(src.subcategories.Food.Lunch).toBe(1)
  })
})
