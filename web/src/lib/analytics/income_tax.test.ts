// Parity tests ported from tests/test_income_tax.py — brackets, allowance caps,
// and the ledger helpers (now over Txn[] instead of a pandas DataFrame).
import { describe, it, expect } from 'vitest'
import {
  TH_SPEC, expenseDeduction, applyAllowances, progressiveTax, incomeTaxStatus,
  grossIncomeForYear, taxPaidForYear, taxPaymentsForYear, ledgerYears,
  toggleTaxSelection, remapTaxSelections,
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

describe('toggleTaxSelection', () => {
  const subs = ['Withholding', 'Prepaid', 'Social']
  it('picks and unpicks single subs', () => {
    const a = toggleTaxSelection([], 'Tax', 'Prepaid', subs)
    expect(a).toEqual(['Tax / Prepaid'])
    expect(toggleTaxSelection(a, 'Tax', 'Prepaid', subs)).toEqual([])
  })
  it('whole category supersedes its subs, leaves other categories alone', () => {
    const next = toggleTaxSelection(['Food', 'Tax / Prepaid'], 'Tax', null, subs)
    expect(next).toEqual(['Food', 'Tax'])
    expect(toggleTaxSelection(next, 'Tax', null, subs)).toEqual(['Food'])
  })
  it('tapping a sub while whole is on means "all except it"', () => {
    expect(toggleTaxSelection(['Tax'], 'Tax', 'Prepaid', subs))
      .toEqual(['Tax / Withholding', 'Tax / Social'])
  })
  it('does not double count whole + sub', () => {
    const txns = [
      txn({ period: '2026-03-01', type: 'Expense', amount: 100, category: 'Tax', subcategory: 'Prepaid' }),
      txn({ period: '2026-03-02', type: 'Expense', amount: 50, category: 'Tax', subcategory: 'Social' }),
    ]
    expect(taxPaidForYear(txns, ['Tax', 'Tax / Prepaid'], 2026)).toBe(150)
    expect(taxPaidForYear(txns, ['Tax / Prepaid'], 2026)).toBe(100)
  })
})

describe('toggleTaxSelection edge cases', () => {
  it('picking every sub collapses to the whole category', () => {
    const subs = ['A', 'B']
    const one = toggleTaxSelection([], 'Tax', 'A', subs)
    expect(toggleTaxSelection(one, 'Tax', 'B', subs)).toEqual(['Tax'])
  })
  it('a category name containing " / " can be ticked, unticked and counts whole', () => {
    const on = toggleTaxSelection([], 'Rent / Util', null, [])
    expect(on).toEqual(['Rent / Util'])
    expect(toggleTaxSelection(on, 'Rent / Util', null, [])).toEqual([])
    const t = [txn({ period: '2026-01-01', type: 'Expense', amount: 70, category: 'Rent / Util' })]
    expect(taxPaidForYear(t, on, 2026)).toBe(70)
  })
})

describe('remapTaxSelections', () => {
  const sels = ['Tax', 'Tax / Prepaid', 'Food / Out']
  it('renames a category, keeping subs', () => {
    expect(remapTaxSelections(sels, { kind: 'category', from: 'Tax', to: 'Taxes' }))
      .toEqual(['Taxes', 'Taxes / Prepaid', 'Food / Out'])
  })
  it('drops a deleted category', () => {
    expect(remapTaxSelections(sels, { kind: 'category-delete', name: 'Tax', into: 'Other' }))
      .toEqual(['Food / Out'])
  })
  it('renames and deletes a sub', () => {
    expect(remapTaxSelections(sels, { kind: 'sub', category: 'Tax', from: 'Prepaid', to: 'Pre' }))
      .toEqual(['Tax', 'Tax / Pre', 'Food / Out'])
    expect(remapTaxSelections(sels, { kind: 'sub-delete', category: 'Tax', name: 'Prepaid' }))
      .toEqual(['Tax', 'Food / Out'])
  })
})

describe('categories whose names contain " / "', () => {
  const t = [
    txn({ period: '2026-01-01', type: 'Expense', amount: 100, category: 'Food / Drink', subcategory: 'Eat' }),
    txn({ period: '2026-01-02', type: 'Expense', amount: 30, category: 'Food / Drink' }),
  ]
  it('counts a sub under such a category, and the whole category', () => {
    expect(taxPaidForYear(t, ['Food / Drink / Eat'], 2026)).toBe(100)
    expect(taxPaidForYear(t, ['Food / Drink'], 2026)).toBe(130)
  })
  it('remap follows a rename / delete of the category and its subs', () => {
    expect(remapTaxSelections(['Food / Drink', 'Food / Drink / Eat'], { kind: 'category', from: 'Food / Drink', to: 'Z' }))
      .toEqual(['Z', 'Z / Eat'])
    expect(remapTaxSelections(['Food / Drink', 'Food / Drink / Eat', 'Rent'], { kind: 'category-delete', name: 'Food / Drink', into: 'Other' }))
      .toEqual(['Rent'])
    expect(remapTaxSelections(['Food / Drink / Eat'], { kind: 'sub', category: 'Food / Drink', from: 'Eat', to: 'Dine' }))
      .toEqual(['Food / Drink / Dine'])
  })
})

describe('legacy subcategory-only selections', () => {
  it('" / Sub" still matches by subcategory alone', () => {
    const t = [
      txn({ period: '2025-03-01', type: 'Expense', amount: 100, category: 'Food', subcategory: 'Tax' }),
      txn({ period: '2025-03-02', type: 'Expense', amount: 40, category: 'Food', subcategory: 'Eat' }),
    ]
    expect(taxPaidForYear(t, [' / Tax'], 2025)).toBe(100)
  })
})
