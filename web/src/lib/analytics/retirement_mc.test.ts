// Parity tests ported from tests/test_retirement_mc.py. At zero volatility every
// path is identical, so the MC median must reproduce the deterministic
// computeRetirement (the anchor). Bands and events are 16/50/84th percentiles.
import { describe, it, expect } from 'vitest'
import { computeRetirement } from './retirement'
import { simulateRetirementMc } from './retirement_mc'
import type { CompoundGoal } from './compound'

type Args = Parameters<typeof simulateRetirementMc>[0]
function plan(over: Partial<Args> = {}): Args {
  return {
    currentAge: 30, retirementAge: 60, lifeExpectancy: 85, principal: 0,
    monthlyDeposit: 10_000, increasement: 0.03, annualRate: 0.06, inflation: 0.03,
    retirementBonus: 0, pension: 0, expense: 30_000, ...over,
  }
}
const det = (over: Partial<Args> = {}) => {
  const a = plan(over)
  return computeRetirement({ ...a, goals: a.goals })
}
const allClose = (a: number[], b: number[], rtol = 1e-6, atol = 1e-3) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= atol + rtol * Math.abs(b[i]))
const maxDiff = (a: number[], b: number[]) => a.reduce((mx, v, i) => Math.max(mx, Math.abs(v - b[i])), 0)
const isSorted = (a: number[]) => a.every((v, i) => i === 0 || a[i - 1] <= v)

describe('simulateRetirementMc — zero-vol equivalence', () => {
  it('median matches deterministic (nominal + real)', () => {
    const d = det()
    const mc = simulateRetirementMc({ ...plan(), volReturn: 0, volInflation: 0, volDeposit: 0, nMc: 64 })
    expect(allClose(mc.nominal.p50, d.balanceNominal)).toBe(true)
    expect(allClose(mc.real.p50, d.balanceReal)).toBe(true)
  })

  it('bands collapse (every path identical)', () => {
    const mc = simulateRetirementMc({ ...plan(), volReturn: 0, volInflation: 0, volDeposit: 0, nMc: 64 })
    expect(maxDiff(mc.nominal.p84, mc.nominal.p16)).toBe(0)
  })

  it('goal trajectories match deterministic', () => {
    const over = { monthlyDeposit: 20_000, expense: 15_000, goals: [['Car', 500_000, 2]] as CompoundGoal[] }
    const d = det(over)
    const mc = simulateRetirementMc({ ...plan(over), volReturn: 0, volInflation: 0, volDeposit: 0, nMc: 64 })
    expect(allClose(mc.factorNominal!.p50, d.balanceFactorNominal!)).toBe(true)
    expect(allClose(mc.plainNominal!.p50, d.balancePlainNominal!)).toBe(true)
  })

  it('freedom matches deterministic (band collapses)', () => {
    const over = { monthlyDeposit: 20_000, expense: 15_000 }
    const d = det(over)
    const mc = simulateRetirementMc({ ...plan(over), volReturn: 0, volInflation: 0, volDeposit: 0, nMc: 32 })
    expect(d.financialFreedomAge).not.toBeNull()
    expect(mc.freedom).not.toBeNull()
    expect(Math.abs(mc.freedom!.p50 - d.financialFreedomAge!)).toBeLessThan(1e-6)
    expect(mc.freedom!.p16).toBe(mc.freedom!.p50)
    expect(mc.freedom!.p84).toBe(mc.freedom!.p50)
  })

  it('goal events match deterministic ages (band collapses)', () => {
    const over = { monthlyDeposit: 20_000, expense: 15_000, goals: [['Car', 500_000, 2], ['House', 3_000_000, 1]] as CompoundGoal[] }
    const d = det(over)
    const mc = simulateRetirementMc({ ...plan(over), volReturn: 0, volInflation: 0, volDeposit: 0, nMc: 32 })
    const detAge = new Map(d.goalHitsFactor!.map((h) => [h.name, h.age]))
    for (const ev of mc.goalEvents!) {
      expect(detAge.has(ev.name)).toBe(true)
      expect(Math.abs(ev.p50! - detAge.get(ev.name)!)).toBeLessThan(1e-6)
      expect(ev.p16).toBe(ev.p50)
      expect(ev.p84).toBe(ev.p50)
    }
  })
})

describe('simulateRetirementMc — structure & statistics', () => {
  it('series percentiles ordered everywhere', () => {
    const mc = simulateRetirementMc({ ...plan(), volReturn: 0.15, volInflation: 0.01, volDeposit: 0.02, nMc: 500 })
    for (let i = 0; i < mc.nominal.p50.length; i++) {
      expect(mc.nominal.p16[i]).toBeLessThanOrEqual(mc.nominal.p50[i])
      expect(mc.nominal.p50[i]).toBeLessThanOrEqual(mc.nominal.p84[i])
    }
  })

  it('events ordered and prob in [0,1]', () => {
    const over = { monthlyDeposit: 20_000, expense: 15_000, goals: [['Car', 500_000, 2], ['House', 3_000_000, 1]] as CompoundGoal[] }
    const mc = simulateRetirementMc({ ...plan(over), volReturn: 0.15, volInflation: 0.01, volDeposit: 0.02, nMc: 800 })
    for (const ev of [mc.freedom, mc.depletion, mc.depletionPlain, ...(mc.goalEvents ?? [])]) {
      if (!ev || ('prob' in ev && ev.prob === 0)) continue
      const vals = [ev.p16, ev.p50, ev.p84]
      const known = vals.filter((v): v is number => v != null)
      expect(isSorted(known)).toBe(true)
      expect(vals.slice(known.length).every((v) => v == null)).toBe(true)
      expect(ev.prob).toBeGreaterThanOrEqual(0)
      expect(ev.prob).toBeLessThanOrEqual(1)
    }
  })

  it('higher return volatility widens the band', () => {
    const lo = simulateRetirementMc({ ...plan(), volReturn: 0.05, nMc: 500 })
    const hi = simulateRetirementMc({ ...plan(), volReturn: 0.25, nMc: 500 })
    const mid = Math.floor(lo.ages.length / 2)
    expect(hi.nominal.p84[mid] - hi.nominal.p16[mid]).toBeGreaterThan(lo.nominal.p84[mid] - lo.nominal.p16[mid])
  })

  it('higher volatility widens the freedom range', () => {
    const over = { monthlyDeposit: 20_000, expense: 15_000 }
    const lo = simulateRetirementMc({ ...plan(over), volReturn: 0.05, nMc: 1500 })
    const hi = simulateRetirementMc({ ...plan(over), volReturn: 0.25, nMc: 1500 })
    expect(lo.freedom).not.toBeNull()
    expect(hi.freedom).not.toBeNull()
    expect(hi.freedom!.p84 - hi.freedom!.p16).toBeGreaterThan(lo.freedom!.p84 - lo.freedom!.p16)
  })

  it('higher volatility widens the depletion range', () => {
    const over = { monthlyDeposit: 5_000, expense: 40_000 }
    const lo = simulateRetirementMc({ ...plan(over), volReturn: 0.05, nMc: 1500 })
    const hi = simulateRetirementMc({ ...plan(over), volReturn: 0.25, nMc: 1500 })
    expect(lo.depletion!.p84).not.toBeNull()
    expect(hi.depletion!.p84).not.toBeNull()
    expect(hi.depletion!.p84! - hi.depletion!.p16!).toBeGreaterThan(lo.depletion!.p84! - lo.depletion!.p16!)
  })

  it('fixed params identical across paths (month 0)', () => {
    const mc = simulateRetirementMc({ ...plan({ principal: 250_000 }), volReturn: 0.2, volInflation: 0.05, nMc: 400 })
    expect(mc.nominal.p16[0]).toBe(250_000)
    expect(mc.nominal.p84[0]).toBe(250_000)
  })

  it('success prob in [0,1]', () => {
    const mc = simulateRetirementMc({ ...plan(), volReturn: 0.15, nMc: 500 })
    expect(mc.successProb).toBeGreaterThanOrEqual(0)
    expect(mc.successProb).toBeLessThanOrEqual(1)
  })

  it('higher expense lowers success', () => {
    const easy = simulateRetirementMc({ ...plan({ monthlyDeposit: 25_000, expense: 12_000 }), volReturn: 0.15, nMc: 800 })
    const hard = simulateRetirementMc({ ...plan({ monthlyDeposit: 25_000, expense: 45_000 }), volReturn: 0.15, nMc: 800 })
    expect(hard.successProb).toBeLessThan(easy.successProb)
  })

  it('big goal lowers success', () => {
    const base = simulateRetirementMc({ ...plan({ monthlyDeposit: 20_000, expense: 15_000 }), volReturn: 0.15, nMc: 800 })
    const withg = simulateRetirementMc({ ...plan({ monthlyDeposit: 20_000, expense: 15_000, goals: [['House', 4_000_000, 1]] }), volReturn: 0.15, nMc: 800 })
    expect(withg.successProb).toBeLessThanOrEqual(base.successProb)
  })

  it('depletion event within horizon or null', () => {
    const mc = simulateRetirementMc({ ...plan(), volReturn: 0.15, nMc: 500 })
    const dep = mc.depletion
    if (dep) {
      const known = [dep.p16, dep.p50, dep.p84].filter((v): v is number => v != null)
      expect(isSorted(known)).toBe(true)
      expect(known.every((v) => v >= 60 && v <= 85)).toBe(true)
    }
  })

  it('depletion percentiles match band zero-crossings', () => {
    const p = plan()
    const mc = simulateRetirementMc({ ...p, volReturn: 0.15, volInflation: 0.01, volDeposit: 0.02, nMc: 1000 })
    const retIdx = Math.round((p.retirementAge - p.currentAge) * 12)
    for (const key of ['p16', 'p50'] as const) {
      expect(mc.depletion![key]).not.toBeNull()
      const curve = mc.nominal[key].slice(retIdx)
      const cross = curve.findIndex((v) => v <= 0)
      expect(cross).toBeGreaterThanOrEqual(0)
      const zeroAge = mc.ages[retIdx + cross]
      expect(Math.abs(zeroAge - mc.depletion![key]!)).toBeLessThanOrEqual(1 / 12 + 1e-9)
    }
  })

  it('depletion censored past life expectancy', () => {
    const mc = simulateRetirementMc({ ...plan({ monthlyDeposit: 25_000, expense: 12_000 }), volReturn: 0.15, nMc: 800 })
    expect(mc.successProb).toBeGreaterThan(0.16)
    if (mc.depletion) {
      expect(mc.depletion.p84).toBeNull()
      expect(mc.depletion.prob).toBeGreaterThan(0)
      expect(mc.depletion.prob).toBeLessThan(1)
    }
  })

  it('same seed reproducible; different seed differs', () => {
    const a = simulateRetirementMc({ ...plan(), volReturn: 0.15, nMc: 300, seed: 7 })
    const b = simulateRetirementMc({ ...plan(), volReturn: 0.15, nMc: 300, seed: 7 })
    expect(a.nominal.p50).toEqual(b.nominal.p50)
    expect(a.successProb).toBe(b.successProb)
    const c = simulateRetirementMc({ ...plan(), volReturn: 0.15, nMc: 300, seed: 2 })
    expect(a.nominal.p50).not.toEqual(c.nominal.p50)
  })
})
