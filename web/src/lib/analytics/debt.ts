// Debts — what is owed, what it costs, and how it ends.
//
// The mirror of goalSavings.ts: pure and testable, with persistence in db.ts. The
// three things this module exists to answer are the three a user can't work out in
// their head — what share of my income goes to debt, which one to attack first,
// and when does this actually finish.
//
// A debt is either LINKED to an account or STANDALONE, and the difference runs all
// the way through:
//
//   linked      Its balance IS the account's (negative) balance, its payments are
//               the transfers already in the ledger, and its interest charges are
//               real Expense rows the user recorded. Nothing is modelled, so
//               nothing can double-count.
//   standalone  Nothing is in the ledger except payments the user tagged, so the
//               balance is DERIVED forward from `openingBalance`, accruing
//               interest between events. Derived rather than stored, so it can
//               never drift out of step with the payments that explain it.
import { signedAmount } from '../balances'
import type { Tone } from './budget'
import {
  DEFAULT_MIN_FLOOR,
  type Debt,
  type DebtsCfg,
  type MinPayment,
  type PayoffStrategy,
} from '../../data/defaults'
import type { Txn } from '../../db'

// Half a satang: below this a balance is settled, not "nearly settled".
const EPS = 0.005

// A tail smaller than one unit of currency is swept up by the final payment. A
// fixed installment rounded to the satang can't divide a balance exactly, so it
// always leaves a few of them behind — and no lender keeps a loan open over that.
const SETTLED_TAIL = 1

// ── Where a debt stands today ────────────────────────────────────────────────

export interface DebtState {
  balance: number
  /** The most this debt has ever been — what "paid off so far" is measured against. */
  peak: number
  /** Interest this module had to model. Always 0 for a linked debt: its interest
      charges are already real rows in the ledger. */
  interestAccrued: number
}

/** One row's effect on the debt, with the interest that accrued before it. */
export interface DebtEvent {
  txn: Txn
  /** Signed effect on what is owed: negative paid it down, positive added to it. */
  delta: number
  /** Interest charged between the previous event and this one. 0 when linked. */
  interest: number
  /** What was owed immediately after this row. */
  balance: number
}

export function debtHistory(debt: Debt, txns: Txn[], today = new Date()): DebtState {
  const { balance, peak, interestAccrued } = walk(debt, txns, today)
  return { balance, peak, interestAccrued }
}

/** Everything that has moved this debt, newest first — the payment history. */
export function debtEvents(debt: Debt, txns: Txn[], today = new Date()): DebtEvent[] {
  return walk(debt, txns, today).events.reverse()
}

// The single chronological pass both of the above read from. One walk, so a
// payment row's running balance can never disagree with the headline balance.
function walk(debt: Debt, txns: Txn[], today: Date): DebtState & { events: DebtEvent[] } {
  const linked = !!debt.account
  const rows = txns
    .filter((t) => (linked ? t.account === debt.account : t.debt === debt.id))
    .sort((a, b) => a.period.localeCompare(b.period) || a.id - b.id)

  // The sign flips between the two kinds, and that isn't a quirk to paper over: a
  // linked row sits ON the debt account, so buying with the card lowers that
  // account and RAISES what you owe. A standalone row sits on the account the
  // money came FROM, so an Expense paid toward the loan LOWERS what you owe.
  const owedDelta = (t: Txn) =>
    linked ? -signedAmount(t.type, t.amount) : signedAmount(t.type, t.amount)

  let balance = linked ? 0 : debt.openingBalance ?? 0
  let peak = Math.max(0, balance)
  let interestAccrued = 0
  // null for a linked debt — the marker that says "don't model interest here".
  let cursor: string | null = linked ? null : debt.openingDate ?? rows[0]?.period ?? isoDay(today)

  const charge = (to: string) => {
    if (cursor === null) return 0
    const i = accrue(balance, debt.apr, daysBetween(cursor, to))
    balance += i
    interestAccrued += i
    cursor = to
    // Interest counts toward the peak: on a debt left alone for a year, the most
    // it ever was is what it grew to, not what was originally borrowed.
    peak = Math.max(peak, balance)
    return i
  }

  const events: DebtEvent[] = []
  for (const t of rows) {
    const interest = charge(t.period)
    const delta = owedDelta(t)
    balance += delta
    peak = Math.max(peak, balance)
    events.push({ txn: t, delta: round2(delta), interest: round2(interest), balance: round2(balance) })
  }
  charge(isoDay(today))

  return {
    events,
    balance: round2(balance),
    // A debt can't have peaked below where it stands now.
    peak: round2(Math.max(peak, balance)),
    interestAccrued: round2(interestAccrued),
  }
}

// Simple interest over a gap, the way a card's average-daily-balance works. A
// negative balance (overpaid) earns nothing, and a payment dated before the
// opening date accrues nothing rather than crediting interest backwards.
function accrue(balance: number, apr: number, days: number): number {
  if (days <= 0 || balance <= 0 || !apr) return 0
  return balance * (apr / 100) * (days / 365)
}

// ── The monthly demand ───────────────────────────────────────────────────────

// What the lender asks for this month. Never more than the balance — the last
// payment on a debt is whatever is left, not a full installment.
export function minimumPayment(min: MinPayment, balance: number): number {
  if (balance <= EPS) return 0
  const raw = min.mode === 'percent' ? balance * (min.value / 100) : min.value
  // The floor is the revolving "…or ฿500, whichever is greater" clause. It is what
  // makes a card finish at all: a pure percentage of a shrinking balance shrinks
  // with it and only ever approaches zero.
  const floor = min.mode === 'percent' ? min.floor ?? DEFAULT_MIN_FLOOR : 0
  return round2(Math.min(balance, Math.max(raw, floor)))
}

/** Percent of the credit limit in use, or null for a debt that has no limit. */
export function utilization(balance: number, limit?: number): number | null {
  if (!limit || limit <= 0) return null
  return round2((Math.max(0, balance) / limit) * 100)
}

// ── Standings ────────────────────────────────────────────────────────────────

export interface DebtStanding {
  debt: Debt
  balance: number
  peak: number
  /** 0–1, how much of the peak is gone. Clamped: an overpaid debt is simply done. */
  paidOff: number
  minimum: number
  utilization: number | null
  interestAccrued: number
  tone: Tone
}

// Tone for a debt row. Revolving debts are judged on UTILISATION — how close to the
// limit is the actionable signal, and it moves long before the balance does —
// while everything else is judged on how much of it is gone.
export function debtTone(paidOff: number, util: number | null): Tone {
  if (util !== null) return util < 30 ? 'good' : util <= 75 ? 'warn' : 'bad'
  const pct = paidOff * 100
  return pct >= 66 ? 'good' : pct >= 33 ? 'warn' : 'bad'
}

// Every debt as it stands, in the user's own configured order. Sorting into a
// payoff order is `payoffOrder`'s job, deliberately kept separate: the list the
// user manages and the order they should pay in are two different things.
export function debtStandings(cfg: DebtsCfg, txns: Txn[], today = new Date()): DebtStanding[] {
  return cfg.debts.map((debt) => {
    const { balance, peak, interestAccrued } = debtHistory(debt, txns, today)
    const paidOff = peak > 0 ? clamp01(1 - balance / peak) : 0
    const util = utilization(balance, debt.creditLimit)
    return {
      debt,
      balance,
      peak,
      paidOff,
      minimum: minimumPayment(debt.minPayment, balance),
      utilization: util,
      interestAccrued,
      tone: debtTone(paidOff, util),
    }
  })
}

/** Total owed. Settled debts contribute nothing; an overpaid one doesn't net off
    a live one either — you can't pay the car with a credit balance on the card. */
export function totalOwed(standings: DebtStanding[]): number {
  return round2(standings.reduce((sum, s) => sum + Math.max(0, s.balance), 0))
}

// What net worth is missing, and only that.
//
// A LINKED debt is an account, and money spent on it already drove that account
// negative in the ledger — `netWorth` has been subtracting it all along. Only a
// standalone debt is invisible to the ledger, so only a standalone debt is
// subtracted here. Counting the linked ones too would take them off twice.
export function hiddenLiabilities(standings: DebtStanding[]): number {
  return round2(
    standings.reduce((sum, s) => (s.debt.account ? sum : sum + Math.max(0, s.balance)), 0),
  )
}

/** What must be paid every month just to stay current — the numerator of the DSR. */
export function monthlyObligation(standings: DebtStanding[]): number {
  return round2(standings.reduce((sum, s) => sum + s.minimum, 0))
}

/** Balance-weighted APR: the single rate the whole pile behaves like. */
export function weightedApr(standings: DebtStanding[]): number {
  let owed = 0
  let cost = 0
  for (const s of standings) {
    const b = Math.max(0, s.balance)
    owed += b
    cost += b * s.debt.apr
  }
  return owed > 0 ? round2(cost / owed) : 0
}

// ── Debt service ratio ───────────────────────────────────────────────────────
//
// The share of monthly income that monthly debt payments eat. Three lines are
// worth drawing on it: the classic 28/36 rule caps ALL debt at 36% of gross
// income; lenders in practice stretch to around 50%; and the Bank of Thailand's
// retail-lending guidance caps DSR at 70% for vulnerable borrowers, which is the
// wall rather than a guideline.

export const DSR_COMFORT = 36
export const DSR_STRETCHED = 50
export const DSR_CAP = 70

/** Percent. 0 when income is unknown — the UI asks for it rather than dividing by zero. */
export function debtServiceRatio(obligation: number, income: number): number {
  if (!(income > 0)) return 0
  return round2((obligation / income) * 100)
}

export function dsrTone(pct: number): Tone {
  return pct <= DSR_COMFORT ? 'good' : pct <= DSR_STRETCHED ? 'warn' : 'bad'
}

// ── Priority ─────────────────────────────────────────────────────────────────

// Avalanche pays the most expensive debt first and always costs the least
// interest. Snowball clears the smallest balance first, which is measurably
// better for follow-through and, on realistic balances and rates, usually costs
// very little more. Both are offered because the difference is normally small
// enough that whichever the user will actually stick to wins.
//
// Tie-breaks are explicit so the order can't wobble between renders.
export function payoffOrder<T extends { balance: number; debt: Debt }>(
  standings: T[],
  strategy: PayoffStrategy,
): T[] {
  return [...standings].sort((a, b) =>
    strategy === 'avalanche'
      ? b.debt.apr - a.debt.apr || a.balance - b.balance || cmp(a.debt.id, b.debt.id)
      : a.balance - b.balance || b.debt.apr - a.debt.apr || cmp(a.debt.id, b.debt.id))
}

// ── Payoff simulation ────────────────────────────────────────────────────────

/** 50 years. Past this a plan isn't slow, it's broken — see the null payoff below. */
export const MAX_MONTHS = 600

export interface PayoffResult {
  /** Months until everything is clear, or **null** for "never at this rate". */
  months: number | null
  totalInterest: number
  /** Debt id → the month it hit zero; null for one that never does. */
  perDebt: Record<string, number | null>
  /** Total owed after each month, index 0 = today. For the projection chart. */
  balances: number[]
  /** True when the monthly amount couldn't even cover the minimums. */
  underfunded: boolean
}

// Roll the whole pile forward a month at a time: charge interest, pay every
// minimum, then throw whatever is left at the top of the priority order — the
// avalanche/snowball "rollover" that makes each cleared debt accelerate the next.
//
// The order is recomputed every month on purpose. Under snowball the smallest
// balance changes hands as debts shrink at different speeds, and freezing the
// order at month zero would quietly simulate a different strategy than the one the
// user picked.
//
// A percentage minimum can be smaller than the interest it is meant to cover, and
// then the balance grows forever. That is a real answer, not a bug, so the loop is
// bounded and returns `months: null` rather than spinning or reporting a date no
// one will live to see.
//
// `monthly: null` means "pay exactly the minimums, whatever they come to" — the
// baseline the whole feature is arguing against. It can't be expressed as a fixed
// budget, because a revolving minimum SHRINKS with the balance: hand the simulator
// this month's minimum as a fixed amount and next month it becomes a surplus
// payment, quietly modelling a much better payer than the user.
export function simulatePayoff(
  standings: DebtStanding[],
  monthly: number | null,
  strategy: PayoffStrategy,
): PayoffResult {
  const loans = standings
    .filter((s) => s.balance > EPS)
    .map((s) => ({ debt: s.debt, balance: s.balance }))

  const perDebt: Record<string, number | null> = {}
  if (loans.length === 0) {
    return { months: 0, totalInterest: 0, perDebt, balances: [0], underfunded: false }
  }

  const balances = [round2(sum(loans))]
  let totalInterest = 0
  // Judged once, against the minimums as they stand today — the same figure the
  // page shows the user. Deciding it inside the loop instead would fire on a plan
  // that exactly covers the minimums, because a percentage minimum is recomputed
  // AFTER the month's interest and so asks for a few baht more than it did when
  // the user read it off the screen.
  const underfunded =
    monthly !== null
    && monthly + EPS < loans.reduce((s, l) => s + minimumPayment(l.debt.minPayment, l.balance), 0)

  for (let month = 1; month <= MAX_MONTHS; month++) {
    for (const l of loans) {
      if (l.balance <= EPS) continue
      const i = l.balance * (l.debt.apr / 100 / 12)
      l.balance += i
      totalInterest += i
    }

    const order = payoffOrder(loans, strategy)
    const minimumsOnly = monthly === null
    let budget = minimumsOnly ? Infinity : Math.max(0, monthly)

    // Minimums first, in priority order — an underfunded month should at least
    // keep the debt that matters most from sliding.
    for (const l of order) {
      if (l.balance <= EPS) continue
      const due = minimumPayment(l.debt.minPayment, l.balance)
      // The last payment sweeps the tail (see SETTLED_TAIL) — but "did the user
      // cover the minimum" is still judged against the minimum itself, so a debt
      // finishing this month can't be mistaken for an underfunded plan.
      const owed = l.balance - due < SETTLED_TAIL ? l.balance : due
      const pay = Math.min(owed, budget)
      l.balance -= pay
      budget -= pay
    }

    // Then everything left over onto the front of the queue — the rollover that
    // makes each cleared debt accelerate the next one.
    if (!minimumsOnly) {
      for (const l of order) {
        if (budget <= EPS) break
        if (l.balance <= EPS) continue
        const pay = Math.min(l.balance, budget)
        l.balance -= pay
        budget -= pay
      }
    }

    for (const l of loans) {
      if (l.balance <= EPS && perDebt[l.debt.id] === undefined) perDebt[l.debt.id] = month
    }

    const total = sum(loans)
    balances.push(round2(total))
    if (total <= EPS) {
      return { months: month, totalInterest: round2(totalInterest), perDebt, balances, underfunded }
    }
  }

  for (const l of loans) if (perDebt[l.debt.id] === undefined) perDebt[l.debt.id] = null
  return { months: null, totalInterest: round2(totalInterest), perDebt, balances, underfunded }
}

/** How a single payment divides. Interest never exceeds the payment itself — a
    payment too small to cover the interest is all interest and no progress. */
export function paymentSplit(balance: number, apr: number, payment: number): {
  interest: number
  principal: number
} {
  const owed = Math.max(0, balance) * (apr / 100 / 12)
  const interest = Math.min(owed, Math.max(0, payment))
  return { interest: round2(interest), principal: round2(Math.max(0, payment - interest)) }
}

// ── What-if: borrowing more ──────────────────────────────────────────────────

export interface NewLoan {
  name: string
  amount: number
  apr: number
  /** Term in months. */
  months: number
}

/** The level payment that clears `principal` over `months` — the standard annuity
    formula, and the number a lender would quote.
    Rounded UP, the way lenders quote it: rounding down leaves the loan a few satang
    short at the end of its term, which is a rounding artifact, not an extra month. */
export function installmentPayment(principal: number, apr: number, months: number): number {
  if (months <= 0 || principal <= 0) return 0
  const r = apr / 100 / 12
  if (r === 0) return ceil2(principal / months)
  return ceil2((principal * r) / (1 - Math.pow(1 + r, -months)))
}

/** A prospective loan as a standing, so the what-if runs through exactly the same
    simulator as the real debts rather than a parallel approximation of it. */
export const WHAT_IF_ID = '__what-if__'

export function newLoanStanding(loan: NewLoan): DebtStanding {
  const debt: Debt = {
    id: WHAT_IF_ID,
    name: loan.name,
    kind: 'installment',
    apr: loan.apr,
    minPayment: { mode: 'fixed', value: installmentPayment(loan.amount, loan.apr, loan.months) },
  }
  return {
    debt,
    balance: round2(loan.amount),
    peak: round2(loan.amount),
    paidOff: 0,
    minimum: debt.minPayment.value,
    utilization: null,
    interestAccrued: 0,
    tone: 'bad',
  }
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** `from` plus n months, clamped to the end of the month — so a plan starting on
    the 31st lands on the 28th/30th rather than skidding into the next month. */
export function addMonths(from: Date, n: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth() + n, 1)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(from.getDate(), lastDay))
  return d
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000
const sum = (loans: Array<{ balance: number }>) =>
  loans.reduce((s, l) => s + Math.max(0, l.balance), 0)
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const round2 = (n: number) => Math.round(n * 100) / 100
const ceil2 = (n: number) => Math.ceil(n * 100) / 100
