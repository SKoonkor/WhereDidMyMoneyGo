import { describe, it, expect } from 'vitest'
import {
  addMonths,
  debtEvents,
  debtHistory,
  debtServiceRatio,
  debtStandings,
  debtTone,
  dsrTone,
  hiddenLiabilities,
  installmentPayment,
  MAX_MONTHS,
  minimumPayment,
  monthlyObligation,
  newLoanStanding,
  paymentSplit,
  payoffOrder,
  simulatePayoff,
  totalOwed,
  utilization,
  weightedApr,
  type DebtStanding,
} from './debt'
import type { Debt, DebtsCfg } from '../../data/defaults'
import type { Txn } from '../../db'

const card = (over: Partial<Debt> = {}): Debt => ({
  id: 'card',
  name: 'Credit Card',
  kind: 'revolving',
  account: 'Credit Card',
  apr: 16,
  minPayment: { mode: 'percent', value: 8 },
  ...over,
})

const loan = (over: Partial<Debt> = {}): Debt => ({
  id: 'loan',
  name: 'Car Loan',
  kind: 'installment',
  openingBalance: 300000,
  openingDate: '2026-01-01',
  apr: 6,
  minPayment: { mode: 'fixed', value: 8000 },
  ...over,
})

let nextId = 1
const txn = (over: Partial<Txn> = {}): Txn => ({
  id: nextId++,
  period: '2026-01-15',
  account: 'Credit Card',
  amount: 1000,
  type: 'Expense',
  category: 'Food',
  currency: 'THB',
  ...over,
})

// A standing built by hand, for the simulator tests where the ledger is beside
// the point.
const mk = (debt: Debt, balance: number): DebtStanding => ({
  debt,
  balance,
  peak: balance,
  paidOff: 0,
  minimum: minimumPayment(debt.minPayment, balance),
  utilization: null,
  interestAccrued: 0,
  tone: 'bad',
})

describe('debtHistory — linked', () => {
  it('owes what the account is down, and models no interest of its own', () => {
    // Two purchases on the card, then a 3,000 payment into it.
    const txns = [
      txn({ amount: 4000, period: '2026-01-05' }),
      txn({ amount: 2000, period: '2026-01-20' }),
      txn({ amount: 3000, period: '2026-02-01', type: 'Transfer-In', category: 'Bank Accounts' }),
    ]
    const state = debtHistory(card(), txns, new Date('2026-06-01'))
    expect(state.balance).toBe(3000)
    expect(state.peak).toBe(6000)
    // The card's real interest charges are Expense rows the user records; modelling
    // them here as well would count them twice.
    expect(state.interestAccrued).toBe(0)
  })

  it('ignores rows on other accounts', () => {
    const txns = [txn({ amount: 4000 }), txn({ account: 'Cash', amount: 9999 })]
    expect(debtHistory(card(), txns, new Date('2026-06-01')).balance).toBe(4000)
  })

  it('reports a fully repaid card as settled, and peak as what it once was', () => {
    const txns = [
      txn({ amount: 5000, period: '2026-01-05' }),
      txn({ amount: 5000, period: '2026-02-05', type: 'Transfer-In', category: 'Cash' }),
    ]
    const state = debtHistory(card(), txns, new Date('2026-03-01'))
    expect(state.balance).toBe(0)
    expect(state.peak).toBe(5000)
  })
})

describe('debtHistory — standalone', () => {
  it('derives the balance forward from the opening balance, accruing interest', () => {
    // 300,000 at 6% for a year with no payments: 300,000 × 6% = 18,000.
    const state = debtHistory(loan(), [], new Date('2027-01-01'))
    expect(state.balance).toBeCloseTo(318000, 0)
    expect(state.interestAccrued).toBeCloseTo(18000, 0)
  })

  it('applies tagged payments, which sit on the account the money came FROM', () => {
    const txns = [
      txn({ account: 'Bank Accounts', amount: 50000, period: '2026-07-01', debt: 'loan' }),
    ]
    const state = debtHistory(loan(), txns, new Date('2027-01-01'))
    // 300k accrues ~half a year (≈8,950), pays 50k, then the rest accrues.
    expect(state.balance).toBeLessThan(318000 - 50000)
    expect(state.balance).toBeGreaterThan(260000)
    expect(state.peak).toBeCloseTo(308950, -2)
  })

  it('treats tagged income as new borrowing', () => {
    const txns = [
      txn({ account: 'Bank Accounts', amount: 100000, type: 'Income', period: '2026-01-01', debt: 'loan' }),
    ]
    const state = debtHistory(loan({ apr: 0 }), txns, new Date('2026-06-01'))
    expect(state.balance).toBe(400000)
    expect(state.peak).toBe(400000)
  })

  it('only counts rows tagged with its own id', () => {
    const txns = [txn({ account: 'Cash', amount: 50000, debt: 'other-debt' })]
    expect(debtHistory(loan({ apr: 0 }), txns, new Date('2026-06-01')).balance).toBe(300000)
  })

  it('accrues nothing on a payment dated before the debt opened', () => {
    const txns = [txn({ account: 'Cash', amount: 1000, period: '2025-01-01', debt: 'loan' })]
    const state = debtHistory(loan({ apr: 0 }), txns, new Date('2026-01-01'))
    expect(state.balance).toBe(299000)
    expect(state.interestAccrued).toBe(0)
  })
})

describe('debtEvents', () => {
  it('lists what moved the debt, newest first, with the running balance', () => {
    const txns = [
      txn({ amount: 4000, period: '2026-01-05' }),
      txn({ amount: 3000, period: '2026-02-01', type: 'Transfer-In', category: 'Bank Accounts' }),
    ]
    const rows = debtEvents(card(), txns, new Date('2026-06-01'))
    expect(rows.map((r) => r.txn.period)).toEqual(['2026-02-01', '2026-01-05'])
    expect(rows[0].delta).toBe(-3000) // a payment brings the debt down
    expect(rows[0].balance).toBe(1000)
    expect(rows[1].delta).toBe(4000) // a purchase on the card adds to it
    // A linked debt's interest is its own row in the ledger, so nothing is split.
    expect(rows.every((r) => r.interest === 0)).toBe(true)
  })

  it('shows the interest charged before each payment on a standalone debt', () => {
    const txns = [
      txn({ account: 'Cash', amount: 20000, period: '2026-07-01', debt: 'loan' }),
    ]
    const [payment] = debtEvents(loan(), txns, new Date('2026-08-01'))
    // Half a year of 6% on 300,000 ≈ 8,950 accrued before the payment landed.
    expect(payment.interest).toBeGreaterThan(8000)
    expect(payment.interest).toBeLessThan(9500)
    expect(payment.delta).toBe(-20000)
    expect(payment.balance).toBeCloseTo(288950, -2)
  })

  it('is empty for a debt nothing has touched', () => {
    expect(debtEvents(card(), [], new Date('2026-06-01'))).toEqual([])
  })

  it('agrees with the headline balance', () => {
    const txns = [
      txn({ amount: 4000, period: '2026-01-05' }),
      txn({ amount: 1500, period: '2026-02-01', type: 'Transfer-In', category: 'Cash' }),
    ]
    const rows = debtEvents(card(), txns, new Date('2026-06-01'))
    expect(rows[0].balance).toBe(debtHistory(card(), txns, new Date('2026-06-01')).balance)
  })
})

describe('minimumPayment', () => {
  it('takes a percentage of the balance for a revolving debt', () => {
    expect(minimumPayment({ mode: 'percent', value: 8 }, 50000)).toBe(4000)
  })

  it('applies the floor when the percentage falls under it', () => {
    // 8% of 2,000 is 160 — the "or ฿500, whichever is greater" clause takes over.
    expect(minimumPayment({ mode: 'percent', value: 8 }, 2000)).toBe(500)
    expect(minimumPayment({ mode: 'percent', value: 8, floor: 100 }, 2000)).toBe(160)
  })

  it('never asks for more than is owed', () => {
    expect(minimumPayment({ mode: 'percent', value: 8 }, 300)).toBe(300)
    expect(minimumPayment({ mode: 'fixed', value: 8000 }, 2500)).toBe(2500)
  })

  it('is zero on a settled debt', () => {
    expect(minimumPayment({ mode: 'fixed', value: 8000 }, 0)).toBe(0)
    expect(minimumPayment({ mode: 'percent', value: 8 }, -100)).toBe(0)
  })
})

describe('utilization', () => {
  it('is null without a credit limit', () => {
    expect(utilization(20000)).toBeNull()
    expect(utilization(20000, 0)).toBeNull()
  })

  it('is the share of the limit in use', () => {
    expect(utilization(20000, 50000)).toBe(40)
  })

  it('floors an overpaid card at zero rather than going negative', () => {
    expect(utilization(-500, 50000)).toBe(0)
  })
})

describe('debtTone', () => {
  it('judges a card on utilisation, where less is better', () => {
    expect(debtTone(0, 25)).toBe('good')
    expect(debtTone(0, 50)).toBe('warn')
    expect(debtTone(0, 90)).toBe('bad')
  })

  it('judges everything else on how much is paid off, where more is better', () => {
    expect(debtTone(0.8, null)).toBe('good')
    expect(debtTone(0.4, null)).toBe('warn')
    expect(debtTone(0.1, null)).toBe('bad')
  })
})

describe('debtStandings', () => {
  const cfg: DebtsCfg = {
    debts: [card({ creditLimit: 50000 }), loan()],
    strategy: 'avalanche',
    extraPayment: 0,
  }

  it('keeps the user\'s configured order, not a payoff order', () => {
    const rows = debtStandings(cfg, [], new Date('2026-01-01'))
    expect(rows.map((r) => r.debt.id)).toEqual(['card', 'loan'])
  })

  it('reports paid-off against the peak, so a repaid card reads as done', () => {
    const txns = [
      txn({ amount: 10000, period: '2026-01-05' }),
      txn({ amount: 7500, period: '2026-02-05', type: 'Transfer-In', category: 'Cash' }),
    ]
    const rows = debtStandings(cfg, txns, new Date('2026-03-01'))
    expect(rows[0].balance).toBe(2500)
    expect(rows[0].paidOff).toBeCloseTo(0.75, 5)
    expect(rows[0].utilization).toBe(5)
  })

  it('clamps an overpaid debt to fully paid rather than past it', () => {
    const txns = [
      txn({ amount: 1000, period: '2026-01-05' }),
      txn({ amount: 4000, period: '2026-02-05', type: 'Transfer-In', category: 'Cash' }),
    ]
    const rows = debtStandings(cfg, txns, new Date('2026-03-01'))
    expect(rows[0].balance).toBe(-3000)
    expect(rows[0].paidOff).toBe(1)
  })
})

describe('totals', () => {
  const rows = [mk(card(), 50000), mk(loan(), 300000)]

  it('adds up what is owed and what must be paid monthly', () => {
    expect(totalOwed(rows)).toBe(350000)
    expect(monthlyObligation(rows)).toBe(12000) // 8% of 50k + the 8,000 installment
  })

  it("doesn't let a credit balance on one debt cancel another", () => {
    expect(totalOwed([mk(card(), -5000), mk(loan(), 300000)])).toBe(300000)
  })

  it('weights the average rate by balance', () => {
    // 50k @ 16% + 300k @ 6% → much closer to 6.
    expect(weightedApr(rows)).toBeCloseTo(7.43, 1)
    expect(weightedApr([])).toBe(0)
  })
})

describe('hiddenLiabilities', () => {
  it('counts only standalone debts — a linked one is already in the ledger', () => {
    // The card's 50,000 has already driven its account negative, so net worth has
    // been subtracting it all along; only the loan is missing from it.
    expect(hiddenLiabilities([mk(card(), 50000), mk(loan(), 300000)])).toBe(300000)
  })

  it('is zero when every debt is linked', () => {
    expect(hiddenLiabilities([mk(card(), 50000)])).toBe(0)
    expect(hiddenLiabilities([])).toBe(0)
  })

  it('ignores an overpaid standalone debt rather than adding to net worth', () => {
    expect(hiddenLiabilities([mk(loan(), -5000)])).toBe(0)
  })
})

describe('debtServiceRatio', () => {
  it('is the share of income the payments take', () => {
    expect(debtServiceRatio(12000, 40000)).toBe(30)
  })

  it('is zero when income is unknown, rather than infinite', () => {
    expect(debtServiceRatio(12000, 0)).toBe(0)
  })

  it('turns at the comfort and stretched lines', () => {
    expect(dsrTone(30)).toBe('good')
    expect(dsrTone(36)).toBe('good')
    expect(dsrTone(36.1)).toBe('warn')
    expect(dsrTone(50)).toBe('warn')
    expect(dsrTone(50.1)).toBe('bad')
    expect(dsrTone(70)).toBe('bad')
  })
})

describe('payoffOrder', () => {
  const small = mk(card({ id: 'small', apr: 5 }), 10000)
  const pricey = mk(card({ id: 'pricey', apr: 22 }), 80000)
  const middle = mk(card({ id: 'middle', apr: 12 }), 40000)

  it('avalanche puts the most expensive first', () => {
    expect(payoffOrder([small, pricey, middle], 'avalanche').map((s) => s.debt.id))
      .toEqual(['pricey', 'middle', 'small'])
  })

  it('snowball puts the smallest first', () => {
    expect(payoffOrder([middle, pricey, small], 'snowball').map((s) => s.debt.id))
      .toEqual(['small', 'middle', 'pricey'])
  })

  it('breaks ties the same way every time', () => {
    const a = mk(card({ id: 'a', apr: 10 }), 5000)
    const b = mk(card({ id: 'b', apr: 10 }), 5000)
    expect(payoffOrder([b, a], 'avalanche').map((s) => s.debt.id)).toEqual(['a', 'b'])
    expect(payoffOrder([b, a], 'snowball').map((s) => s.debt.id)).toEqual(['a', 'b'])
  })

  it('leaves the input array alone', () => {
    const rows = [small, pricey]
    payoffOrder(rows, 'avalanche')
    expect(rows.map((s) => s.debt.id)).toEqual(['small', 'pricey'])
  })
})

describe('installmentPayment', () => {
  it('splits a 0% loan evenly', () => {
    expect(installmentPayment(12000, 0, 12)).toBe(1000)
  })

  it('matches the annuity formula, rounded up to close the loan', () => {
    // 300,000 over 60 months at 6% = 5,799.8404…/month → quoted as 5,799.85.
    expect(installmentPayment(300000, 6, 60)).toBe(5799.85)
  })

  it('is zero for a loan with no term or no principal', () => {
    expect(installmentPayment(100000, 6, 0)).toBe(0)
    expect(installmentPayment(0, 6, 24)).toBe(0)
  })
})

describe('simulatePayoff', () => {
  it('is already done when there is nothing owed', () => {
    const res = simulatePayoff([], 5000, 'avalanche')
    expect(res.months).toBe(0)
    expect(res.totalInterest).toBe(0)
  })

  it('clears a 0% loan exactly on schedule with no interest', () => {
    const d = loan({ apr: 0, minPayment: { mode: 'fixed', value: 1000 } })
    const res = simulatePayoff([mk(d, 12000)], 1000, 'avalanche')
    expect(res.months).toBe(12)
    expect(res.totalInterest).toBe(0)
    expect(res.balances).toHaveLength(13) // today plus one per month
    expect(res.balances[0]).toBe(12000)
    expect(res.balances[12]).toBe(0)
  })

  it('amortises an installment loan over its term', () => {
    const payment = installmentPayment(300000, 6, 60)
    const d = loan({ apr: 6, minPayment: { mode: 'fixed', value: payment } })
    const res = simulatePayoff([mk(d, 300000)], payment, 'avalanche')
    expect(res.months).toBe(60)
    // 60 × 5,799.85 − 300,000 ≈ 47,990 of interest.
    expect(res.totalInterest).toBeCloseTo(47990, -2)
  })

  it('avalanche never costs more interest than snowball on the same debts', () => {
    const rows = [
      mk(card({ id: 'a', apr: 22, minPayment: { mode: 'fixed', value: 1000 } }), 30000),
      mk(card({ id: 'b', apr: 6, minPayment: { mode: 'fixed', value: 1000 } }), 8000),
    ]
    const av = simulatePayoff(rows, 6000, 'avalanche')
    const sn = simulatePayoff(rows, 6000, 'snowball')
    expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest)
    // …and snowball clears the small one first, which is the whole point of it.
    expect(sn.perDebt.b).toBeLessThan(sn.perDebt.a as number)
    // Avalanche puts the expensive one first; the cheap one can still finish in
    // the same month, since the surplus rolls onto it as soon as the first clears.
    expect(av.perDebt.a).toBeLessThanOrEqual(av.perDebt.b as number)
  })

  it('does not mutate the standings it is given', () => {
    const rows = [mk(card(), 50000)]
    simulatePayoff(rows, 10000, 'avalanche')
    expect(rows[0].balance).toBe(50000)
  })

  it('rolls a cleared debt into the next one', () => {
    const rows = [
      mk(card({ id: 'a', apr: 0, minPayment: { mode: 'fixed', value: 1000 } }), 5000),
      mk(card({ id: 'b', apr: 0, minPayment: { mode: 'fixed', value: 1000 } }), 5000),
    ]
    // 2,000/month against 10,000 total finishes in 5 months only if the freed-up
    // payment moves across; paying 1,000 each in isolation would take 5 as well,
    // so use an uneven pair to make the rollover visible.
    const uneven = [
      mk(card({ id: 'a', apr: 0, minPayment: { mode: 'fixed', value: 1000 } }), 2000),
      mk(card({ id: 'b', apr: 0, minPayment: { mode: 'fixed', value: 1000 } }), 8000),
    ]
    expect(simulatePayoff(rows, 2000, 'snowball').months).toBe(5)
    expect(simulatePayoff(uneven, 2000, 'snowball').months).toBe(5)
  })

  it('flags a plan that cannot even cover the minimums', () => {
    const rows = [mk(loan({ minPayment: { mode: 'fixed', value: 8000 } }), 300000)]
    expect(simulatePayoff(rows, 2000, 'avalanche').underfunded).toBe(true)
    expect(simulatePayoff(rows, 20000, 'avalanche').underfunded).toBe(false)
  })

  it('does not flag a plan that exactly covers the minimums', () => {
    // A percentage minimum is recomputed after each month's interest, so it asks
    // for slightly more than it did at month zero. Budgeting exactly what the page
    // says the minimums are must not read as underfunded.
    const rows = [mk(card(), 50000)]
    expect(rows[0].minimum).toBe(4000)
    expect(simulatePayoff(rows, 4000, 'avalanche').underfunded).toBe(false)
    expect(simulatePayoff(rows, 3999, 'avalanche').underfunded).toBe(true)
  })

  it('is never underfunded when paying the minimums as they fall due', () => {
    expect(simulatePayoff([mk(card(), 50000)], null, 'avalanche').underfunded).toBe(false)
  })

  describe('minimum payments only (monthly = null)', () => {
    it('takes years on a card at the 8% minimum, and says so', () => {
      const res = simulatePayoff([mk(card(), 50000)], null, 'avalanche')
      expect(res.months).not.toBeNull()
      expect(res.months).toBeGreaterThan(24)
      expect(res.underfunded).toBe(false)
      // The point of the whole exercise: minimum-only costs far more than a plan.
      const planned = simulatePayoff([mk(card(), 50000)], 10000, 'avalanche')
      expect(res.totalInterest).toBeGreaterThan(planned.totalInterest)
      expect(res.months).toBeGreaterThan(planned.months as number)
    })

    it('reports "never" — within the loop cap — when the rate outruns the minimum', () => {
      // 36% APR against a 2% minimum: interest is 3%/month, the payment is 2%.
      const hopeless = card({ apr: 36, minPayment: { mode: 'percent', value: 2, floor: 0 } })
      const res = simulatePayoff([mk(hopeless, 200000)], null, 'avalanche')
      expect(res.months).toBeNull()
      expect(res.perDebt.card).toBeNull()
      expect(res.balances).toHaveLength(MAX_MONTHS + 1)
      // It grew rather than shrank — the balance the user would be staring at.
      expect(res.balances[MAX_MONTHS]).toBeGreaterThan(200000)
    })
  })
})

describe('paymentSplit', () => {
  it('takes the month\'s interest first and puts the rest on the principal', () => {
    // 50,000 at 12% → 500 of interest this month.
    expect(paymentSplit(50000, 12, 4000)).toEqual({ interest: 500, principal: 3500 })
  })

  it('is all interest when the payment cannot cover it', () => {
    expect(paymentSplit(50000, 12, 300)).toEqual({ interest: 300, principal: 0 })
  })

  it('charges nothing on a settled or interest-free debt', () => {
    expect(paymentSplit(0, 12, 1000)).toEqual({ interest: 0, principal: 1000 })
    expect(paymentSplit(50000, 0, 1000)).toEqual({ interest: 0, principal: 1000 })
  })
})

describe('newLoanStanding', () => {
  it('turns a prospective loan into a standing the simulator can take', () => {
    const s = newLoanStanding({ name: 'New car', amount: 300000, apr: 6, months: 60 })
    expect(s.balance).toBe(300000)
    expect(s.minimum).toBe(5799.85)
    // And run through the simulator it clears over exactly its term.
    expect(simulatePayoff([s], s.minimum, 'avalanche').months).toBe(60)
  })
})

describe('addMonths', () => {
  it('advances by whole months', () => {
    expect(addMonths(new Date(2026, 0, 15), 3).toDateString())
      .toBe(new Date(2026, 3, 15).toDateString())
  })

  it('clamps to the end of a shorter month instead of skidding past it', () => {
    expect(addMonths(new Date(2026, 0, 31), 1).toDateString())
      .toBe(new Date(2026, 1, 28).toDateString())
  })

  it('crosses a year boundary', () => {
    expect(addMonths(new Date(2026, 10, 10), 5).toDateString())
      .toBe(new Date(2027, 3, 10).toDateString())
  })
})
