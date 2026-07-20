// Parity tests ported from tests/test_income_tax.py — brackets, allowance caps,
// and the ledger helpers (now over Txn[] instead of a pandas DataFrame).
import { describe, it, expect } from 'vitest'
import {
  TH_SPEC, expenseDeduction, applyAllowances, progressiveTax, incomeTaxStatus,
  grossIncomeForYear, taxPaidForYear, taxPaymentsForYear, ledgerYears,
} from './income_tax'
import type { Txn } from '../../db'

// Minimal Txn factory (mirrors tests/conftest.make_df rows).
function txn(o: Partial<Txn> & { period: string; type: Txn['type']; amount: number }): Txn {
  return { account: 'Bank', category: '', currency: 'THB', ...o } as Txn
}
const amt = (breakdown: { key: string; amount: number }[], key: string) => breakdown.find((b) => b.key === key)!.amount

describe('progressiveTax', () => {
  it('known point: 340,000 → 11,500', () => {
    const { tax, rows, marginal } = progressiveTax(340_000, TH_SPEC.brackets)
    expect(tax).toBe(11_500)
    expect(marginal).toBe(0.1)
    expect(rows.map((r) => r.rate)).toEqual([0.0, 0.05, 0.1])
  })
  it('zero income', () => {
    const { tax, rows, marginal } = progressiveTax(0, TH_SPEC.brackets)
    expect(tax).toBe(0)
    expect(rows).toEqual([])
    expect(marginal).toBe(0)
  })
})

describe('deductions & allowances', () => {
  it('expense deduction capped at 100k', () => {
    expect(expenseDeduction(100_000, TH_SPEC)).toBe(50_000)
    expect(expenseDeduction(1_000_000, TH_SPEC)).toBe(100_000)
  })

  it('status 500k no allowances', () => {
    const s = incomeTaxStatus(500_000, {}, TH_SPEC)
    expect(s.expense_deduction).toBe(100_000)
    expect(s.allowance_total).toBe(60_000)
    expect(s.net_taxable).toBe(340_000)
    expect(s.tax_due).toBe(11_500)
    expect(Number(s.effective_rate.toFixed(5))).toBe(Number((11_500 / 500_000).toFixed(5)))
  })

  it('SSF capped by percentage then absolute', () => {
    const { breakdown } = applyAllowances(500_000, { ssf: 300_000 }, TH_SPEC)
    expect(amt(breakdown, 'ssf')).toBe(150_000) // 30% of 500k
    const { breakdown: b2 } = applyAllowances(1_000_000, { ssf: 300_000 }, TH_SPEC)
    expect(amt(b2, 'ssf')).toBe(200_000) // absolute cap wins
  })

  it('retirement group aggregate cap 500k', () => {
    const { breakdown } = applyAllowances(5_000_000, { provident: 400_000, ssf: 200_000, rmf: 500_000 }, TH_SPEC)
    const retire = breakdown.filter((b) => ['provident', 'ssf', 'rmf'].includes(b.key)).reduce((s, b) => s + b.amount, 0)
    expect(retire).toBe(500_000)
  })

  it('donation capped at 10% of net', () => {
    const { breakdown } = applyAllowances(500_000, { donations: 100_000 }, TH_SPEC)
    expect(amt(breakdown, 'donations')).toBe(34_000) // 10% of 340k
  })

  it('remaining and refund sign', () => {
    expect(incomeTaxStatus(500_000, {}, TH_SPEC, 5_000).remaining).toBe(6_500)
    expect(incomeTaxStatus(500_000, {}, TH_SPEC, 15_000).remaining).toBe(-3_500)
  })

  it('flag and count allowances', () => {
    const { breakdown } = applyAllowances(800_000, { spouse: true, children: 3 }, TH_SPEC)
    expect(amt(breakdown, 'personal')).toBe(60_000)
    expect(amt(breakdown, 'spouse')).toBe(60_000)
    expect(amt(breakdown, 'children')).toBe(90_000)
  })

  it('parents count capped at max units', () => {
    const { breakdown } = applyAllowances(800_000, { parents: 9 }, TH_SPEC)
    expect(amt(breakdown, 'parents')).toBe(120_000) // 4 × 30,000
  })
})

const yearDf = (): Txn[] => [
  txn({ period: '2026-01-10', type: 'Income', amount: 40_000, category: 'Salary' }),
  txn({ period: '2026-07-10', type: 'Income', amount: 60_000, category: 'Salary' }),
  txn({ period: '2025-05-10', type: 'Income', amount: 99_000, category: 'Salary' }),
  txn({ period: '2026-03-10', type: 'Expense', amount: 2_000, category: 'Bills', subcategory: 'Tax' }),
  txn({ period: '2026-09-10', type: 'Expense', amount: 3_000, category: 'Bills', subcategory: 'Tax' }),
]

describe('ledger helpers', () => {
  it('gross income filters by year and type', () => {
    const df = yearDf()
    expect(grossIncomeForYear(df, 2026)).toBe(100_000)
    expect(grossIncomeForYear(df, 2025)).toBe(99_000)
  })

  it('tax paid sums a subcategory / whole category', () => {
    const df = yearDf()
    expect(taxPaidForYear(df, 'Bills / Tax', 2026)).toBe(5_000)
    expect(taxPaidForYear(df, 'Bills / Tax', 2025)).toBe(0)
    expect(taxPaidForYear(df, null, 2026)).toBe(0)
    expect(taxPaidForYear(df, 'Bills', 2026)).toBe(5_000)
  })

  it('tax payments list rows oldest first', () => {
    const df = yearDf()
    const payments = taxPaymentsForYear(df, 'Bills / Tax', 2026)
    expect(payments).toEqual([
      { date: '10-Mar-2026', amount: 2_000, category: 'Bills', subcategory: 'Tax' },
      { date: '10-Sep-2026', amount: 3_000, category: 'Bills', subcategory: 'Tax' },
    ])
    expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(taxPaidForYear(df, 'Bills / Tax', 2026))
    expect(taxPaymentsForYear(df, 'Bills / Tax', 2025)).toEqual([])
    expect(taxPaymentsForYear(df, null, 2026)).toEqual([])
  })

  it('ledger years include current, newest first', () => {
    const years = ledgerYears(yearDf(), 2027)
    expect(years).toEqual([...years].sort((a, b) => b - a))
    expect(years).toContain(2027)
    expect(years).toContain(2026)
    expect(years).toContain(2025)
  })
})

const multiCatDf = (): Txn[] => [
  txn({ period: '2026-01-10', type: 'Income', amount: 40_000, category: 'Salary' }),
  txn({ period: '2026-02-10', type: 'Income', amount: 10_000, category: 'Bonus' }),
  txn({ period: '2026-03-10', type: 'Income', amount: 5_000, category: 'Interest' }),
  txn({ period: '2026-04-10', type: 'Expense', amount: 2_000, category: 'Bills', subcategory: 'Tax' }),
  txn({ period: '2026-05-10', type: 'Expense', amount: 1_500, category: 'Bills', subcategory: 'WHT' }),
]

describe('selection filtering', () => {
  it('gross income filters by selections', () => {
    const df = multiCatDf()
    expect(grossIncomeForYear(df, 2026)).toBe(55_000)
    expect(grossIncomeForYear(df, 2026, null)).toBe(55_000)
    expect(grossIncomeForYear(df, 2026, [])).toBe(55_000)
    expect(grossIncomeForYear(df, 2026, ['Salary'])).toBe(40_000)
    expect(grossIncomeForYear(df, 2026, ['Salary', 'Bonus'])).toBe(50_000)
  })

  it('subcategory selection is precise', () => {
    const df: Txn[] = [
      txn({ period: '2026-01-10', type: 'Income', amount: 40_000, category: 'Salary', subcategory: 'Base' }),
      txn({ period: '2026-02-10', type: 'Income', amount: 10_000, category: 'Salary', subcategory: 'Overtime' }),
    ]
    expect(grossIncomeForYear(df, 2026, ['Salary'])).toBe(50_000)
    expect(grossIncomeForYear(df, 2026, ['Salary / Base'])).toBe(40_000)
    expect(grossIncomeForYear(df, 2026, ['Salary / Overtime'])).toBe(10_000)
  })

  it('tax paid accepts a selection list and whole category', () => {
    const df = multiCatDf()
    expect(taxPaidForYear(df, ['Bills / Tax'], 2026)).toBe(2_000)
    expect(taxPaidForYear(df, ['Bills / Tax', 'Bills / WHT'], 2026)).toBe(3_500)
    expect(taxPaidForYear(df, 'Bills', 2026)).toBe(3_500)
    expect(taxPaidForYear(df, 'Bills / WHT', 2026)).toBe(1_500)
    expect(taxPaidForYear(df, [], 2026)).toBe(0)
  })

  it('tax payments list rows for multiple selections', () => {
    const payments = taxPaymentsForYear(multiCatDf(), ['Bills / Tax', 'Bills / WHT'], 2026)
    expect(payments).toEqual([
      { date: '10-Apr-2026', amount: 2_000, category: 'Bills', subcategory: 'Tax' },
      { date: '10-May-2026', amount: 1_500, category: 'Bills', subcategory: 'WHT' },
    ])
  })
})
