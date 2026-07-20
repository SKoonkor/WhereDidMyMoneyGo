// Compound-interest calculator — a browser port of compute_schedule in
// src/app/figures/compound.py.
//
// A standalone learning tool (does not use tracked data). Deposits are treated
// as made at the start of each month (annuity due) and grow at a monthly-
// equivalent rate derived from the effective annual yield (APY) of the chosen
// compounding frequency, so the result is consistent with the displayed APY.
//
// Optionally overlays a "goals bought" trajectory: each goal, taken in
// Financial-Goals rank order, is bought (its amount spent) as the balance
// reaches its target. Two variants — buying at amount×factor and at the plain
// amount. Pure and testable; the Plotly figure lives in features/compound.

// A goal in rank order: [name, amount, factor]. factor ≥ 1.
export type CompoundGoal = [name: string, amount: number, factor: number]

// Compounding label → periods per year.
export const COMPOUNDING: Record<string, number> = {
  Monthly: 12,
  Quarterly: 4,
  '6 Months': 2,
  Annually: 1,
}

export const RATE_VARIATION = 0.2 // ±20% band on the annual rate

// Effective annual yield for a nominal rate at the given compounding.
export function apy(annualRate: number, periodsPerYear: number): number {
  const n = periodsPerYear
  return (1 + annualRate / n) ** n - 1
}

// Monthly-equivalent growth rate consistent with the displayed APY.
function monthlyRate(annualRate: number, n: number): number {
  return (1 + apy(annualRate, n)) ** (1 / 12) - 1
}

// Balance after each month 0..M (deposit at start of month, annuity due).
function maturitySeries(P: number, D: number, M: number, annualRate: number, n: number): number[] {
  const i = monthlyRate(annualRate, n)
  const values = new Array<number>(M + 1)
  let bal = P
  values[0] = bal
  for (let m = 1; m <= M; m++) {
    bal = (bal + D) * (1 + i)
    values[m] = bal
  }
  return values
}

export interface GoalHit {
  name: string
  month: number
  target: number
}

// Balance series when each goal is *bought* as it's reached. `goals` is in
// Financial-Goals rank order (top-ranked first) and forms a strict FIFO queue:
// the front goal must be bought before the next is considered. target =
// amount×factor when useFactor else the plain amount (target ≥ amount either way,
// so the balance never goes negative).
function simulateBought(
  P: number,
  D: number,
  cap: number,
  i: number,
  goals: CompoundGoal[],
  useFactor: boolean,
): { values: number[]; hits: GoalHit[] } {
  const queue = goals.map(([name, a, f]) => ({
    name,
    amount: a,
    target: a * (useFactor ? f : 1),
  }))
  const values = new Array<number>(cap + 1)
  const hits: GoalHit[] = []
  let bal = P

  const buy = (month: number) => {
    while (queue.length && bal >= queue[0].target) {
      const g = queue.shift()!
      hits.push({ name: g.name, month, target: g.target })
      bal -= g.amount
    }
  }

  buy(0)
  values[0] = bal
  for (let m = 1; m <= cap; m++) {
    bal = (bal + D) * (1 + i)
    buy(m)
    values[m] = bal
  }
  return { values, hits }
}

export interface Achievement {
  name: string
  amount: number
  factor: number
  monthNobuy: number | null
  monthPlain: number | null
  monthFactor: number | null
}

export interface Schedule {
  months: number[]
  principal: number[] // cumulative contributions P + D·month
  maturity: number[]
  maturityBought: number[]
  goalHits: GoalHit[]
  maturityBoughtPlain: number[]
  goalHitsPlain: GoalHit[]
  maturityLow: number[]
  maturityHigh: number[]
  period: number // M
  totalPrincipal: number
  maturityValue: number
  interest: number
  apy: number
  annualRate: number
  achievement: Achievement[]
}

// First index at which series ≥ target, or null if never within its length.
function firstReached(series: number[], target: number): number | null {
  for (let m = 0; m < series.length; m++) if (series[m] >= target) return m
  return null
}

// Totals and per-month series for the calculator. The series runs to an extended
// horizon H ≥ M (so the user can scroll past the set period to see when goals are
// reached), but reported totals are taken at M.
export function computeSchedule(
  P: number,
  D: number,
  M: number,
  annualRate: number,
  compounding: string = 'Annually',
  goals: CompoundGoal[] = [],
): Schedule {
  const n = COMPOUNDING[compounding] ?? 1
  const cap = Math.max(1200, M)
  const i = monthlyRate(annualRate, n)

  const pure = maturitySeries(P, D, cap, annualRate, n)
  const factor = simulateBought(P, D, cap, i, goals, true)
  const plain = simulateBought(P, D, cap, i, goals, false)

  const base = Math.max(M, Math.round(M * 1.5))
  const allHits = [...factor.hits, ...plain.hits]
  let H: number
  if (allHits.length) {
    H = Math.min(cap, Math.max(base, Math.max(...allHits.map((h) => h.month)) + 12))
  } else if (goals.length) {
    const target = Math.max(...goals.map(([, a, f]) => a * f))
    const reached = firstReached(pure, target)
    H = Math.min(cap, Math.max(base, (reached ?? cap) + 12))
  } else {
    H = Math.min(cap, base)
  }

  const months = Array.from({ length: H + 1 }, (_, k) => k)
  const principal = months.map((m) => P + D * m) // cumulative contributions
  const maturity = pure.slice(0, H + 1)

  const totalPrincipal = principal[M]
  const maturityValue = maturity[M]
  const interest = maturityValue - totalPrincipal

  // Per-goal "month reached" under the three strategies drawn on the chart.
  const hitF = new Map(factor.hits.map((h) => [h.name, h.month]))
  const hitP = new Map(plain.hits.map((h) => [h.name, h.month]))
  const achievement: Achievement[] = goals.map(([name, a, f]) => ({
    name,
    amount: a,
    factor: f,
    monthNobuy: firstReached(pure, a),
    monthPlain: hitP.has(name) ? hitP.get(name)! : null,
    monthFactor: hitF.has(name) ? hitF.get(name)! : null,
  }))

  return {
    months,
    principal,
    maturity,
    maturityBought: factor.values.slice(0, H + 1),
    goalHits: factor.hits.filter((h) => h.month <= H),
    maturityBoughtPlain: plain.values.slice(0, H + 1),
    goalHitsPlain: plain.hits.filter((h) => h.month <= H),
    maturityLow: maturitySeries(P, D, H, annualRate * (1 - RATE_VARIATION), n),
    maturityHigh: maturitySeries(P, D, H, annualRate * (1 + RATE_VARIATION), n),
    period: M,
    totalPrincipal,
    maturityValue,
    interest,
    apy: apy(annualRate, n),
    annualRate,
    achievement,
  }
}
