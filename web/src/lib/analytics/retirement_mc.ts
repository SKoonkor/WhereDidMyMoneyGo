// Monte Carlo retirement projection — a browser port of
// src/analytics/retirement_mc.py.
//
// The deterministic computeRetirement applies one fixed return/inflation/raise.
// Real markets vary year to year and the *order* of good and bad years matters,
// so this simulates the balance path many times (a fresh random monthly return,
// plus per-year random inflation and raise) and summarises the spread across
// paths as month-by-month 16/50/84th percentiles — a stable median with a ±1σ
// band. At zero volatility every path collapses onto computeRetirement (the
// correctness anchor). numpy's PRNG isn't reproduced exactly (a seeded Mulberry32
// + Box–Muller stands in); the guarantees are the statistical/zero-vol ones.
import type { CompoundGoal } from './compound'

// ── Seeded PRNG (Mulberry32) with Normal draws via Box–Muller ────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
class Rng {
  private u: () => number
  private spare: number | null = null
  constructor(seed: number) { this.u = mulberry32(seed) }
  normal(mean = 0, sd = 1): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return mean + sd * v }
    let u1 = 0
    while (u1 <= 1e-12) u1 = this.u()
    const u2 = this.u()
    const r = Math.sqrt(-2 * Math.log(u1))
    const z0 = r * Math.cos(2 * Math.PI * u2)
    this.spare = r * Math.sin(2 * Math.PI * u2)
    return mean + sd * z0
  }
}

// ── Percentile helpers (numpy-compatible) ────────────────────────────────────
// Linear interpolation between closest ranks (numpy default).
function pctLinear(sortedAsc: Float64Array, q: number): number {
  const N = sortedAsc.length
  if (N === 1) return sortedAsc[0]
  const pos = (q / 100) * (N - 1)
  const lo = Math.floor(pos)
  if (lo >= N - 1) return sortedAsc[N - 1]
  return sortedAsc[lo] + (pos - lo) * (sortedAsc[lo + 1] - sortedAsc[lo])
}
// Lower sample value at the rank (numpy method="lower") — keeps censored +Inf ages.
function pctLower(sortedAsc: Float64Array, q: number): number {
  const idx = Math.floor((q / 100) * (sortedAsc.length - 1))
  return sortedAsc[idx]
}

export interface Band { p16: number[]; p50: number[]; p84: number[] }
export interface Event { p16: number; p50: number; p84: number; prob: number }
export interface DepEvent { p16: number | null; p50: number | null; p84: number | null; prob: number }
export interface GoalEvent { name: string; p16?: number; p50?: number; p84?: number; prob: number }

// Month-by-month 16/50/84th percentiles across paths. `series[t]` is the length-
// n_mc vector of balances at month t.
function band(series: Float64Array[]): Band {
  const p16: number[] = [], p50: number[] = [], p84: number[] = []
  for (const col of series) {
    const s = Float64Array.from(col)
    s.sort()
    p16.push(pctLinear(s, 16)); p50.push(pctLinear(s, 50)); p84.push(pctLinear(s, 84))
  }
  return { p16, p50, p84 }
}

// Event-age percentiles over the paths where it occurred (month ≥ 0), plus prob.
function eventPcts(months: Int32Array, currentAge: number): Event | null {
  const occurred: number[] = []
  for (const m of months) if (m >= 0) occurred.push(currentAge + m / 12)
  if (occurred.length === 0) return null
  const s = Float64Array.from(occurred); s.sort()
  return { p16: pctLinear(s, 16), p50: pctLinear(s, 50), p84: pctLinear(s, 84), prob: occurred.length / months.length }
}

// Funds-out percentiles over ALL paths (non-depleting paths → +Inf age, so a
// percentile past life expectancy is reported as null → "life+"), plus prob.
function depletionPcts(months: Int32Array, currentAge: number, life: number): DepEvent | null {
  let any = false
  const ages = new Float64Array(months.length)
  for (let k = 0; k < months.length; k++) {
    if (months[k] >= 0) { ages[k] = currentAge + months[k] / 12; any = true }
    else ages[k] = Infinity
  }
  if (!any) return null
  ages.sort()
  const clamp = (v: number) => (v <= life ? v : null)
  let depleted = 0
  for (const m of months) if (m >= 0) depleted++
  return { p16: clamp(pctLower(ages, 16)), p50: clamp(pctLower(ages, 50)), p84: clamp(pctLower(ages, 84)), prob: depleted / months.length }
}

export interface McResult {
  ages: number[]
  nMc: number
  hasGoals: boolean
  nominal: Band
  real: Band
  factorNominal?: Band
  factorReal?: Band
  plainNominal?: Band
  depletionPlain?: DepEvent | null
  successProbPlain?: number
  goalEvents?: GoalEvent[]
  goalEventsPlain?: GoalEvent[]
  expenseAtRetirement?: { p16: number; p50: number; p84: number }
  successProb: number
  depletion: DepEvent | null
  freedom: Event | null
}

export function simulateRetirementMc(args: {
  currentAge: number
  retirementAge: number
  lifeExpectancy: number
  principal: number
  monthlyDeposit: number
  increasement: number
  annualRate: number
  inflation: number
  retirementBonus?: number
  pension?: number
  expense?: number
  goals?: CompoundGoal[]
  volReturn?: number
  volInflation?: number
  volDeposit?: number
  nMc?: number
  seed?: number
}): McResult {
  const currentAge = args.currentAge || 0
  const retirementAge = Math.max(currentAge, args.retirementAge || 0)
  const lifeExpectancy = Math.max(retirementAge, args.lifeExpectancy || 0)

  const g = args.increasement || 0
  const infl = args.inflation || 0
  const D0 = args.monthlyDeposit || 0
  const pension = args.pension || 0
  const expense0 = args.expense || 0
  const bonus = args.retirementBonus || 0
  const P = args.principal || 0
  const goals = args.goals ?? []
  const volReturn = args.volReturn || 0
  const volInflation = args.volInflation || 0
  const volDeposit = args.volDeposit || 0
  const nMc = Math.max(Math.trunc(args.nMc || 1000), 1)
  const seed = args.seed ?? 12345

  let totalMonths = Math.round((lifeExpectancy - currentAge) * 12)
  const retireMonth = Math.round((retirementAge - currentAge) * 12)
  totalMonths = Math.max(totalMonths, retireMonth, 1)
  const nYears = Math.floor(totalMonths / 12) + 2

  const ages = Array.from({ length: totalMonths + 1 }, (_, k) => currentAge + k / 12)
  const rng = new Rng(seed)

  // Monthly gross investment return: lognormal, mean-matched to (1+annualRate)^(1/12).
  const s = volReturn / Math.sqrt(12)
  const m = Math.log(Math.max(1 + (args.annualRate || 0), 1e-9)) / 12 - 0.5 * s * s
  const retGross: Float64Array[] = []
  for (let t = 0; t <= totalMonths; t++) {
    const col = new Float64Array(nMc)
    for (let k = 0; k < nMc; k++) col[k] = Math.exp(rng.normal(m, s))
    retGross.push(col) // retGross[0] unused
  }
  // Per-year inflation and deposit-growth draws (held across each year's 12 months).
  const phiYear: Float64Array[] = []
  for (let y = 0; y < nYears; y++) {
    const col = new Float64Array(nMc)
    for (let k = 0; k < nMc; k++) col[k] = Math.max(rng.normal(infl, volInflation), -0.999)
    phiYear.push(col)
  }
  const gYear: Float64Array[] = []
  for (let y = 0; y < nYears; y++) {
    const col = new Float64Array(nMc)
    for (let k = 0; k < nMc; k++) col[k] = Math.max(rng.normal(g, volDeposit), -0.999)
    gYear.push(col)
  }

  // Deposit multiplier for year y = product of (1+raise) over prior years.
  const depositFactor: Float64Array[] = [new Float64Array(nMc).fill(1)]
  const acc = new Float64Array(nMc).fill(1)
  for (let y = 1; y < nYears; y++) {
    for (let k = 0; k < nMc; k++) acc[k] *= 1 + gYear[y - 1][k]
    depositFactor.push(Float64Array.from(acc))
  }
  // Monthly price index (per path): month t uses year (t-1)//12's inflation draw.
  const priceIndex: Float64Array[] = [new Float64Array(nMc).fill(1)]
  for (let t = 1; t <= totalMonths; t++) {
    const yr = Math.floor((t - 1) / 12)
    const prev = priceIndex[t - 1]
    const col = new Float64Array(nMc)
    for (let k = 0; k < nMc; k++) col[k] = prev[k] * (1 + phiYear[yr][k]) ** (1 / 12)
    priceIndex.push(col)
  }

  interface Run { nominal: Float64Array[]; depMonth: Int32Array; depleted: Uint8Array; hitMonth: Int32Array[] }
  const run = (targets: number[], amounts: number[]): Run => {
    const ng = targets.length
    const nominal: Float64Array[] = []
    let bal = new Float64Array(nMc).fill(P)
    const gp = new Int32Array(nMc) // next unbought goal per path
    const depleted = new Uint8Array(nMc)
    const depMonth = new Int32Array(nMc).fill(-1)
    const hitMonth: Int32Array[] = Array.from({ length: Math.max(ng, 1) }, () => new Int32Array(nMc).fill(-1))

    const buy = (t: number) => {
      if (ng === 0) return
      for (let k = 0; k < nMc; k++) {
        while (gp[k] < ng && bal[k] >= targets[gp[k]]) {
          hitMonth[gp[k]][k] = t
          bal[k] -= amounts[gp[k]]
          gp[k]++
        }
      }
    }

    buy(0)
    nominal.push(Float64Array.from(bal))
    for (let t = 1; t <= totalMonths; t++) {
      const col = new Float64Array(nMc)
      if (t <= retireMonth) {
        const df = depositFactor[Math.floor((t - 1) / 12)]
        const rg = retGross[t]
        for (let k = 0; k < nMc; k++) col[k] = (bal[k] + D0 * df[k]) * rg[k]
        if (t === retireMonth) for (let k = 0; k < nMc; k++) col[k] += bonus
      } else {
        const rg = retGross[t]
        const ex = priceIndex[t]
        for (let k = 0; k < nMc; k++) col[k] = (bal[k] + pension - expense0 * ex[k]) * rg[k]
      }
      bal = col
      buy(t)
      for (let k = 0; k < nMc; k++) {
        if (bal[k] <= 0) {
          if (!depleted[k]) { depMonth[k] = t; depleted[k] = 1 }
          bal[k] = 0
        }
      }
      nominal.push(Float64Array.from(bal))
    }
    return { nominal, depMonth, depleted, hitMonth }
  }

  // Per-path financial-freedom month (pure accumulation, every goal bought, mean
  // return covers net expense). -1 if never reached.
  const freedomMonths = (targets: number[], amounts: number[]): Int32Array => {
    const iMean = Math.max(1 + (args.annualRate || 0), 1e-9) ** (1 / 12) - 1
    const ng = targets.length
    const bal = new Float64Array(nMc).fill(P)
    const gp = new Int32Array(nMc)
    const freed = new Int32Array(nMc).fill(-1)
    const buy = () => {
      if (ng === 0) return
      for (let k = 0; k < nMc; k++) while (gp[k] < ng && bal[k] >= targets[gp[k]]) { bal[k] -= amounts[gp[k]]; gp[k]++ }
    }
    const check = (t: number) => {
      const ex = priceIndex[t]
      for (let k = 0; k < nMc; k++) {
        const net = expense0 * ex[k] - pension
        if (gp[k] >= ng && bal[k] * iMean >= net && freed[k] < 0) freed[k] = t
      }
    }
    buy(); check(0)
    for (let t = 1; t <= totalMonths; t++) {
      const df = depositFactor[Math.floor((t - 1) / 12)]
      const rg = retGross[t]
      for (let k = 0; k < nMc; k++) bal[k] = (bal[k] + D0 * df[k]) * rg[k]
      buy(); check(t)
    }
    return freed
  }

  const hasGoals = goals.length > 0
  const realOf = (nominal: Float64Array[]): Float64Array[] =>
    nominal.map((col, t) => { const out = new Float64Array(nMc); const pi = priceIndex[t]; for (let k = 0; k < nMc; k++) out[k] = col[k] / pi[k]; return out })
  const successProb = (depleted: Uint8Array) => { let ok = 0; for (const d of depleted) if (!d) ok++; return ok / nMc }

  const result: McResult = { ages, nMc, hasGoals, nominal: { p16: [], p50: [], p84: [] }, real: { p16: [], p50: [], p84: [] }, successProb: 0, depletion: null, freedom: null }

  const base = run([], [])
  result.nominal = band(base.nominal)
  result.real = band(realOf(base.nominal))

  let depMonth = base.depMonth
  let depleted = base.depleted
  let freedomTargets: number[] = []
  let freedomAmounts: number[] = []

  if (hasGoals) {
    const amounts = goals.map(([, a]) => a)
    const fTargets = goals.map(([, a, f]) => a * f)
    const pTargets = amounts.slice()
    const f = run(fTargets, amounts)
    const p = run(pTargets, amounts)
    result.factorNominal = band(f.nominal)
    result.factorReal = band(realOf(f.nominal))
    result.plainNominal = band(p.nominal)
    result.depletionPlain = depletionPcts(p.depMonth, currentAge, lifeExpectancy)
    result.successProbPlain = successProb(p.depleted)
    depMonth = f.depMonth // ×factor is the primary plan
    depleted = f.depleted
    result.goalEvents = goals.map(([name], k) => {
      const ev = eventPcts(f.hitMonth[k], currentAge)
      return ev ? { name, ...ev } : { name, prob: 0 }
    })
    result.goalEventsPlain = goals.map(([name], k) => {
      const ev = eventPcts(p.hitMonth[k], currentAge)
      return ev ? { name, ...ev } : { name, prob: 0 }
    })
    freedomTargets = fTargets
    freedomAmounts = amounts
  }

  result.successProb = successProb(depleted)
  result.depletion = depletionPcts(depMonth, currentAge, lifeExpectancy)
  result.freedom = eventPcts(freedomMonths(freedomTargets, freedomAmounts), currentAge)

  // Expense at retirement is inflation-driven, so it inherits inflation volatility.
  if (expense0 > 0) {
    const pi = priceIndex[retireMonth]
    const exp = new Float64Array(nMc)
    for (let k = 0; k < nMc; k++) exp[k] = expense0 * pi[k]
    exp.sort()
    result.expenseAtRetirement = { p16: pctLinear(exp, 16), p50: pctLinear(exp, 50), p84: pctLinear(exp, 84) }
  }
  return result
}
