// Retirement planning projection — a browser port of src/analytics/retirement.py.
//
// Models a retirement plan month by month across three phases:
//   • Accumulation (current age → retirement age): escalating monthly deposits
//     (annuity due) grow at a monthly-equivalent rate; the deposit rises once a
//     year by the increasement rate.
//   • Retirement bonus: a lump sum the month retirement begins (the pot's peak).
//   • Decumulation (retirement → life expectancy): no deposits; expenses (given
//     in today's money) inflate, a fixed nominal pension offsets them, the rest
//     is funded by the balance which keeps earning. Depletion age is recorded if
//     it hits zero.
//
// Financial goals may optionally be bought as the balance reaches their target
// (rank order, FIFO), dipping the trajectory — two strategies (×factor / plain).
// Pure and testable; the Plotly figure lives in features/compound.
import type { CompoundGoal } from './compound'

// Monthly-equivalent rate for an effective annual yield.
export function monthlyRate(annualRate: number): number {
  return (1 + annualRate) ** (1 / 12) - 1
}

// The FIRE "financial freedom" age: earliest age at which the pot's return alone
// covers expenses (net of pension) so savings never need to shrink. Pure
// accumulation path (deposits keep going, no draw-down, no bonus). Selected goals
// are bought at their ×factor target (FIFO); freedom is only declared once every
// goal is bought AND the remaining return covers expenses. Returns an age or null.
function financialFreedomAge(
  P: number, D0: number, g: number, i: number, infl: number, pension: number,
  expense0: number, totalMonths: number, currentAge: number, goals: CompoundGoal[],
): number | null {
  const queue = goals.map(([, a, f]) => ({ amount: a, target: a * f }))
  let bal = P
  const buy = () => {
    while (queue.length && bal >= queue[0].target) bal -= queue.shift()!.amount
  }
  buy()
  for (let t = 0; t <= totalMonths; t++) {
    if (t > 0) {
      const year = Math.floor((t - 1) / 12)
      bal = (bal + D0 * (1 + g) ** year) * (1 + i)
      buy()
    }
    const netMonthlyExpense = expense0 * (1 + infl) ** (t / 12) - pension
    if (queue.length === 0 && bal * i >= netMonthlyExpense) return currentAge + t / 12
  }
  return null
}

// When savings survive to life expectancy, keep drawing down past it to find when
// they eventually hit zero. Returns that age (> life expectancy), or null if they
// last beyond capAge (caller shows "100+") or were already depleted in horizon.
function lateDepletionAge(
  balAtLife: number, i: number, infl: number, pension: number, expense0: number,
  totalMonths: number, currentAge: number, capAge = 100,
): number | null {
  if (balAtLife <= 0) return null
  let bal = balAtLife
  const capMonth = Math.round((capAge - currentAge) * 12)
  for (let t = totalMonths + 1; t <= capMonth; t++) {
    const expenseNominal = expense0 * (1 + infl) ** (t / 12)
    bal = (bal + pension - expenseNominal) * (1 + i)
    if (bal <= 0) return currentAge + t / 12
  }
  return null
}

export interface RetHit { name: string; month: number; age: number; target: number }
interface SimResult {
  nominal: number[]
  hits: RetHit[]
  contributions: number
  depletionMonth: number | null
  totalSpent: number
}

// Run the month-by-month projection, optionally buying goals as reached.
function simulate(
  P: number, D0: number, g: number, i: number, infl: number, pension: number,
  expense0: number, bonus: number, totalMonths: number, retireMonth: number,
  currentAge: number, goals: CompoundGoal[], useFactor: boolean,
): SimResult {
  const queue = goals.map(([name, a, f]) => ({ name, amount: a, target: a * (useFactor ? f : 1) }))
  const nominal = new Array<number>(totalMonths + 1)
  let bal = P
  let contributions = P
  let totalSpent = 0
  let depletionMonth: number | null = null
  const hits: RetHit[] = []

  const buy = (month: number) => {
    while (queue.length && bal >= queue[0].target) {
      const gg = queue.shift()!
      hits.push({ name: gg.name, month, age: currentAge + month / 12, target: gg.target })
      bal -= gg.amount
      totalSpent += gg.amount
    }
  }

  buy(0)
  nominal[0] = bal
  for (let t = 1; t <= totalMonths; t++) {
    if (t <= retireMonth) {
      const year = Math.floor((t - 1) / 12)
      const deposit = D0 * (1 + g) ** year
      bal = (bal + deposit) * (1 + i)
      contributions += deposit
      if (t === retireMonth) bal += bonus // lump sum at retirement
    } else {
      const expenseNominal = expense0 * (1 + infl) ** (t / 12)
      bal = (bal + pension - expenseNominal) * (1 + i)
    }
    buy(t)
    if (bal <= 0) {
      bal = 0
      if (depletionMonth === null) depletionMonth = t
    }
    nominal[t] = bal
  }
  return { nominal, hits, contributions, depletionMonth, totalSpent }
}

export interface RetSummary {
  potAtRetirement: number
  depletionAge: number | null
  covered: boolean
  endingNominal: number
  endingReal: number
  totalSpent: number
  lateDepletionAge: number | null
}

export interface Retirement {
  ages: number[]
  months: number[]
  balanceNominal: number[]
  balanceReal: number[]
  currentAge: number
  retirementAge: number
  lifeExpectancy: number
  retireMonth: number
  balanceAtRetirement: number
  expenseAtRetirement: number
  pension: number
  yearsInRetirement: number
  depletionAge: number | null
  covered: boolean
  endingNominal: number
  endingReal: number
  totalContributions: number
  annualRate: number
  inflation: number
  hasGoals: boolean
  financialFreedomAge: number | null
  lateDepletionAge: number | null
  // Goal-buying extras (present only when goals are supplied).
  balanceFactorNominal?: number[]
  balanceFactorReal?: number[]
  balancePlainNominal?: number[]
  balancePlainReal?: number[]
  goalHitsFactor?: RetHit[]
  goalHitsPlain?: RetHit[]
  summaryFactor?: RetSummary
  summaryPlain?: RetSummary
  goalNames?: string[]
}

// Project a retirement plan month by month. Rates (increasement, annualRate,
// inflation) are decimals; expense and pension are monthly amounts; expense is in
// today's money and inflates. goals is optional [name, amount, factor] in rank
// order; when given, two extra goal-buying trajectories and summaries are added.
export function computeRetirement(args: {
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
}): Retirement {
  const currentAge = args.currentAge || 0
  const retirementAge = Math.max(currentAge, args.retirementAge || 0)
  const lifeExpectancy = Math.max(retirementAge, args.lifeExpectancy || 0)

  const i = monthlyRate(args.annualRate)
  const g = args.increasement || 0
  const infl = args.inflation || 0
  const D0 = args.monthlyDeposit || 0
  const pension = args.pension || 0
  const expense0 = args.expense || 0
  const bonus = args.retirementBonus || 0
  const P = args.principal || 0
  const goals = args.goals ?? []

  let totalMonths = Math.round((lifeExpectancy - currentAge) * 12)
  const retireMonth = Math.round((retirementAge - currentAge) * 12)
  totalMonths = Math.max(totalMonths, retireMonth, 1)

  const ages = Array.from({ length: totalMonths + 1 }, (_, k) => currentAge + k / 12)
  const deflator = ages.map((a) => (1 + infl) ** (a - currentAge)) // nominal → today's money

  const run = (gs: CompoundGoal[], useFactor: boolean) =>
    simulate(P, D0, g, i, infl, pension, expense0, bonus, totalMonths, retireMonth, currentAge, gs, useFactor)

  // Base (no goals) — the faint baseline and the source of the top-level keys.
  const base = run([], true)
  const nominal = base.nominal
  const real = nominal.map((v, k) => v / deflator[k])

  const expenseAtRetirement = expense0 ? expense0 * (1 + infl) ** (retireMonth / 12) : 0
  const depletionAge = base.depletionMonth !== null ? currentAge + base.depletionMonth / 12 : null

  const result: Retirement = {
    ages,
    months: Array.from({ length: totalMonths + 1 }, (_, k) => k),
    balanceNominal: nominal,
    balanceReal: real,
    currentAge,
    retirementAge,
    lifeExpectancy,
    retireMonth,
    balanceAtRetirement: nominal[retireMonth],
    expenseAtRetirement,
    pension,
    yearsInRetirement: lifeExpectancy - retirementAge,
    depletionAge,
    covered: depletionAge === null,
    endingNominal: nominal[nominal.length - 1],
    endingReal: real[real.length - 1],
    totalContributions: base.contributions,
    annualRate: args.annualRate || 0,
    inflation: infl,
    hasGoals: goals.length > 0,
    financialFreedomAge: financialFreedomAge(P, D0, g, i, infl, pension, expense0, totalMonths, currentAge, goals),
    lateDepletionAge: lateDepletionAge(nominal[nominal.length - 1], i, infl, pension, expense0, totalMonths, currentAge),
  }

  if (goals.length) {
    const strategy = (useFactor: boolean) => {
      const s = run(goals, useFactor)
      const rl = s.nominal.map((v, k) => v / deflator[k])
      const depAge = s.depletionMonth !== null ? currentAge + s.depletionMonth / 12 : null
      const summary: RetSummary = {
        potAtRetirement: s.nominal[retireMonth],
        depletionAge: depAge,
        covered: depAge === null,
        endingNominal: s.nominal[s.nominal.length - 1],
        endingReal: rl[rl.length - 1],
        totalSpent: s.totalSpent,
        lateDepletionAge: lateDepletionAge(s.nominal[s.nominal.length - 1], i, infl, pension, expense0, totalMonths, currentAge),
      }
      return { nominal: s.nominal, real: rl, hits: s.hits, summary }
    }
    const f = strategy(true)
    const p = strategy(false)
    result.balanceFactorNominal = f.nominal
    result.balanceFactorReal = f.real
    result.balancePlainNominal = p.nominal
    result.balancePlainReal = p.real
    result.goalHitsFactor = f.hits
    result.goalHitsPlain = p.hits
    result.summaryFactor = f.summary
    result.summaryPlain = p.summary
    result.goalNames = goals.map(([nm]) => nm)
  }

  return result
}
