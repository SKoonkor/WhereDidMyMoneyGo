// Parity tests ported from tests/test_retirement.py — accumulation, draw-down,
// depletion, real vs nominal, goal buying, FIRE freedom age, late depletion.
import { describe, it, expect } from 'vitest'
import { computeRetirement, type Retirement } from './retirement'
import type { CompoundGoal } from './compound'

function plan(over: Partial<Parameters<typeof computeRetirement>[0]> = {}): Retirement {
  return computeRetirement({
    currentAge: 30, retirementAge: 60, lifeExpectancy: 85, principal: 0,
    monthlyDeposit: 10_000, increasement: 0, annualRate: 0.06, inflation: 0.03,
    retirementBonus: 0, pension: 0, expense: 30_000, ...over,
  })
}
const max = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), -Infinity)

describe('computeRetirement', () => {
  it('pot at retirement exceeds contributions and is the peak', () => {
    const r = plan()
    expect(r.balanceAtRetirement).toBeGreaterThan(r.totalContributions)
    expect(r.totalContributions).toBeGreaterThan(0)
    expect(r.balanceAtRetirement).toBe(max(r.balanceNominal))
  })

  it('increasement grows the pot and contributions', () => {
    const flat = plan({ increasement: 0, expense: 0 })
    const rising = plan({ increasement: 0.05, expense: 0 })
    expect(rising.balanceAtRetirement).toBeGreaterThan(flat.balanceAtRetirement)
    expect(rising.totalContributions).toBeGreaterThan(flat.totalContributions)
  })

  it('high expense depletes before life expectancy', () => {
    const r = plan({ monthlyDeposit: 2_000, expense: 60_000 })
    expect(r.covered).toBe(false)
    expect(r.depletionAge).not.toBeNull()
    expect(r.retirementAge).toBeLessThan(r.depletionAge!)
    expect(r.depletionAge!).toBeLessThan(r.lifeExpectancy)
    expect(r.endingNominal).toBe(0)
  })

  it('modest expense lasts and leaves an estate', () => {
    const r = plan({ monthlyDeposit: 20_000, expense: 15_000 })
    expect(r.covered).toBe(true)
    expect(r.depletionAge).toBeNull()
    expect(r.endingNominal).toBeGreaterThan(0)
  })

  it('real below nominal at end when inflation positive; equal at month 0', () => {
    const r = plan({ monthlyDeposit: 20_000, expense: 15_000, inflation: 0.03 })
    expect(r.endingReal).toBeLessThan(r.endingNominal)
    expect(r.balanceReal[0]).toBe(r.balanceNominal[0])
  })

  it('pension pushes depletion later', () => {
    const noP = plan({ monthlyDeposit: 2_000, expense: 60_000, pension: 0 })
    const withP = plan({ monthlyDeposit: 2_000, expense: 60_000, pension: 40_000 })
    if (withP.depletionAge === null) expect(noP.depletionAge).not.toBeNull()
    else expect(withP.depletionAge!).toBeGreaterThan(noP.depletionAge!)
  })

  it('retirement before current age is handled', () => {
    const r = plan({ currentAge: 65, retirementAge: 60, lifeExpectancy: 85 })
    expect(r.retireMonth).toBe(0)
    expect(r.balanceAtRetirement).toBe(r.balanceNominal[0])
    expect(r.ages.length).toBe(r.balanceNominal.length)
  })

  it('no goals keeps original shape, no goal keys leak', () => {
    const r = plan()
    expect(r.hasGoals).toBe(false)
    expect(r.summaryFactor).toBeUndefined()
    expect(r.goalHitsFactor).toBeUndefined()
  })

  it('goals reduce pot and ending; spent once', () => {
    const base = plan({ monthlyDeposit: 20_000, expense: 15_000 })
    const g = plan({ monthlyDeposit: 20_000, expense: 15_000, goals: [['Car', 500_000, 2]] })
    expect(g.hasGoals).toBe(true)
    expect(base.covered && g.summaryFactor!.covered).toBe(true)
    expect(g.summaryFactor!.potAtRetirement).toBeLessThan(base.balanceAtRetirement)
    expect(g.summaryFactor!.endingNominal).toBeLessThan(base.endingNominal)
    expect(g.summaryFactor!.totalSpent).toBe(500_000)
  })

  it('goal purchase causes a dip below prior month and baseline', () => {
    const g = plan({ goals: [['Car', 500_000, 2]] })
    const hits = g.goalHitsFactor!
    expect(hits.length).toBeGreaterThan(0)
    const series = g.balanceFactorNominal!
    const m = hits[0].month
    expect(series[m]).toBeLessThan(series[m - 1])
    expect(series[m]).toBeLessThan(g.balanceNominal[m])
  })

  it('plain buys no later than factor', () => {
    const g = plan({ goals: [['Car', 500_000, 2]] })
    expect(g.goalHitsPlain![0].month).toBeLessThanOrEqual(g.goalHitsFactor![0].month)
  })

  it('big goal hastens depletion or shrinks estate', () => {
    const base = plan({ monthlyDeposit: 12_000, expense: 20_000 })
    const g = plan({ monthlyDeposit: 12_000, expense: 20_000, goals: [['House', 3_000_000, 1]] })
    expect(g.summaryFactor!.totalSpent).toBeGreaterThan(0)
    if (base.covered) {
      expect(!g.summaryFactor!.covered || g.summaryFactor!.endingNominal < base.endingNominal).toBe(true)
    } else {
      expect(g.summaryFactor!.depletionAge!).toBeLessThanOrEqual(base.depletionAge!)
    }
  })

  it('hits carry age and ×factor target', () => {
    const g = plan({ goals: [['Car', 500_000, 2]] })
    for (const h of g.goalHitsFactor!) {
      expect(h.age).toBeGreaterThanOrEqual(30)
      expect(h.age).toBeLessThanOrEqual(85)
      expect(h.target).toBe(500_000 * 2)
    }
  })

  it('goal names in rank order', () => {
    const goals: CompoundGoal[] = [['Car', 500_000, 2], ['House', 3_000_000, 1]]
    expect(plan({ goals }).goalNames).toEqual(['Car', 'House'])
  })

  it('financial freedom within horizon', () => {
    const r = plan()
    expect(r.financialFreedomAge).not.toBeNull()
    expect(r.currentAge).toBeLessThan(r.financialFreedomAge!)
    expect(r.financialFreedomAge!).toBeLessThanOrEqual(r.lifeExpectancy)
  })

  it('pension covering expenses means immediate freedom', () => {
    const r = plan({ pension: 40_000, expense: 30_000 })
    expect(r.financialFreedomAge).toBe(r.currentAge)
  })

  it('more savings reaches freedom earlier', () => {
    const low = plan({ monthlyDeposit: 10_000 }).financialFreedomAge!
    const high = plan({ monthlyDeposit: 50_000 }).financialFreedomAge!
    expect(high).toBeLessThan(low)
  })

  it('freedom unreachable returns null', () => {
    const r = plan({ monthlyDeposit: 100, expense: 100_000, annualRate: 0.02, inflation: 0.05 })
    expect(r.financialFreedomAge).toBeNull()
  })

  it('goals delay financial freedom', () => {
    const base = plan({ monthlyDeposit: 30_000, expense: 15_000 }).financialFreedomAge!
    const withg = plan({ monthlyDeposit: 30_000, expense: 15_000, goals: [['House', 3_000_000, 1]] }).financialFreedomAge!
    expect(withg).toBeGreaterThan(base)
  })

  it('freedom waits until all goals bought', () => {
    const base = plan({ monthlyDeposit: 30_000, expense: 15_000 }).financialFreedomAge!
    const cheap = plan({ monthlyDeposit: 30_000, expense: 15_000, goals: [['Small', 200_000, 1]] }).financialFreedomAge!
    const pricey = plan({ monthlyDeposit: 30_000, expense: 15_000, goals: [['Big', 8_000_000, 1]] }).financialFreedomAge!
    expect(base).toBeLessThanOrEqual(cheap)
    expect(cheap).toBeLessThan(pricey)
  })

  it('unreachable goal blocks freedom', () => {
    expect(plan({ monthlyDeposit: 10_000, expense: 15_000 }).financialFreedomAge).not.toBeNull()
    const r = plan({ monthlyDeposit: 10_000, expense: 15_000, goals: [['Yacht', 900_000_000, 2]] })
    expect(r.financialFreedomAge).toBeNull()
  })

  it('late depletion after life expectancy', () => {
    const r = plan({ monthlyDeposit: 10_000, expense: 15_000 })
    expect(r.depletionAge).toBeNull()
    expect(r.covered).toBe(true)
    expect(r.lateDepletionAge).not.toBeNull()
    expect(r.lateDepletionAge!).toBeGreaterThan(r.lifeExpectancy)
  })

  it('grows forever has no late depletion', () => {
    const r = plan({ monthlyDeposit: 20_000, expense: 15_000 })
    expect(r.depletionAge).toBeNull()
    expect(r.lateDepletionAge).toBeNull()
  })

  it('within-life depletion has no late age', () => {
    const r = plan()
    expect(r.depletionAge).not.toBeNull()
    expect(r.lateDepletionAge).toBeNull()
  })

  it('goal reached plain but not factor', () => {
    const g = plan({ goals: [['Yacht', 5_000_000, 3]] })
    const factorNames = new Set(g.goalHitsFactor!.map((h) => h.name))
    const plainNames = new Set(g.goalHitsPlain!.map((h) => h.name))
    expect(plainNames.has('Yacht')).toBe(true)
    expect(factorNames.has('Yacht')).toBe(false)
    expect(g.summaryFactor!.totalSpent).toBe(0)
    expect(g.summaryPlain!.totalSpent).toBe(5_000_000)
  })
})
