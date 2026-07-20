// Parity tests ported from tests/test_compound.py — totals, APY, goal buying
// order, and invariants of computeSchedule.
import { describe, it, expect } from 'vitest'
import { computeSchedule, apy, type CompoundGoal } from './compound'

const sched = (goals?: CompoundGoal[]) =>
  computeSchedule(0, 5_000, 120, 0.1, 'Annually', goals)

describe('computeSchedule', () => {
  it('totals and APY (annual compounding)', () => {
    const s = sched()
    expect(s.totalPrincipal).toBe(5_000 * 120) // P=0, cumulative deposits
    expect(s.maturityValue).toBeGreaterThan(s.totalPrincipal) // growth beats contributions
    expect(s.apy).toBeCloseTo(0.1, 10)
  })

  it('goals do not change the pure maturity', () => {
    const plain = sched()
    const withg = sched([['Trip', 150_000, 3], ['iPad', 25_000, 5]])
    expect(withg.maturityValue).toBe(plain.maturityValue)
    expect(withg.totalPrincipal).toBe(plain.totalPrincipal)
  })

  it('rank order buys the top goal first', () => {
    // Trip is ranked first though iPad is cheaper — strict rank order must buy
    // Trip before iPad on both bought lines.
    const s = sched([['Trip', 150_000, 3], ['iPad', 25_000, 5]])
    const factorNames = s.goalHits.map((h) => h.name)
    const plainNames = s.goalHitsPlain.map((h) => h.name)
    expect(factorNames[0]).toBe('Trip')
    expect(plainNames[0]).toBe('Trip')
    if (factorNames.includes('iPad')) {
      expect(factorNames.indexOf('Trip')).toBeLessThan(factorNames.indexOf('iPad'))
    }
  })

  it('factor target is amount × factor', () => {
    const s = sched([['Trip', 150_000, 3]])
    const tripFactor = s.goalHits.find((h) => h.name === 'Trip')!
    const tripPlain = s.goalHitsPlain.find((h) => h.name === 'Trip')!
    expect(tripFactor.target).toBe(450_000) // 150k × 3
    expect(tripPlain.target).toBe(150_000) // no factor
    expect(tripPlain.month).toBeLessThanOrEqual(tripFactor.month)
  })

  it('achievement month ordering: nobuy ≤ plain ≤ factor', () => {
    const s = sched([['Trip', 150_000, 3], ['iPad', 25_000, 5]])
    for (const g of s.achievement) {
      if (g.monthNobuy != null && g.monthPlain != null && g.monthFactor != null) {
        expect(g.monthNobuy).toBeLessThanOrEqual(g.monthPlain)
        expect(g.monthPlain).toBeLessThanOrEqual(g.monthFactor)
      }
    }
  })

  it('apy matches compounding frequency', () => {
    expect(apy(0.12, 12)).toBeCloseTo((1 + 0.12 / 12) ** 12 - 1, 12)
    expect(apy(0.1, 1)).toBeCloseTo(0.1, 12)
  })
})
