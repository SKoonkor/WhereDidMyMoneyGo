// Personal income-tax estimator — a browser port of src/analytics/income_tax.py.
//
// Country-keyed (COUNTRIES) so more countries can be added; only Thailand
// (TH_SPEC) ships today. A spec carries its progressive brackets, the automatic
// employment-expense deduction, and an ordered list of allowance definitions the
// page renders generically. Caps apply per item, then the shared retirement cap,
// then the donation cap (a percentage of income after every other deduction).
// Pure and testable; persistence + config wiring live in db.ts.
import type { Txn } from '../../db'

// ── Thailand spec ────────────────────────────────────────────────────────────
export type Bracket = [lower: number, upper: number | null, rate: number]

export const TH_BRACKETS: Bracket[] = [
  [0, 150_000, 0.0],
  [150_000, 300_000, 0.05],
  [300_000, 500_000, 0.1],
  [500_000, 750_000, 0.15],
  [750_000, 1_000_000, 0.2],
  [1_000_000, 2_000_000, 0.25],
  [2_000_000, 5_000_000, 0.3],
  [5_000_000, null, 0.35],
]

export type AllowanceType = 'fixed' | 'flag' | 'count' | 'amount'
export interface AllowanceDef {
  key: string
  label: string
  type: AllowanceType
  amount?: number
  per?: number
  max_units?: number
  unit?: string
  cap?: number
  cap_pct?: number
  cap_pct_of_net?: number
  hint: string
}

export const TH_ALLOWANCES: AllowanceDef[] = [
  { key: 'personal', label: 'Personal allowance', type: 'fixed', amount: 60_000, hint: 'Automatic 60,000 for every taxpayer.' },
  { key: 'spouse', label: 'Spouse (no income)', type: 'flag', amount: 60_000, hint: '60,000 if your spouse has no assessable income.' },
  { key: 'children', label: 'Children', type: 'count', per: 30_000, unit: 'children', hint: '30,000 per child.' },
  { key: 'parents', label: 'Parental care', type: 'count', per: 30_000, max_units: 4, unit: 'people', hint: '30,000 per dependent parent aged 60+, up to 4.' },
  { key: 'insurance', label: 'Life & health insurance', type: 'amount', cap: 100_000, hint: 'Premiums, capped at 100,000.' },
  { key: 'social_security', label: 'Social security', type: 'amount', cap: 9_000, hint: 'Contributions, capped at 9,000.' },
  { key: 'provident', label: 'Provident fund / GPF', type: 'amount', cap_pct: 0.15, cap: 500_000, hint: 'Up to 15% of income and 500,000 (shared retirement cap).' },
  { key: 'ssf', label: 'SSF', type: 'amount', cap_pct: 0.3, cap: 200_000, hint: 'Up to 30% of income and 200,000 (shared retirement cap).' },
  { key: 'rmf', label: 'RMF', type: 'amount', cap_pct: 0.3, cap: 500_000, hint: 'Up to 30% of income and 500,000 (shared retirement cap).' },
  { key: 'mortgage', label: 'Mortgage interest', type: 'amount', cap: 100_000, hint: 'Home-loan interest, capped at 100,000.' },
  { key: 'donations', label: 'Donations', type: 'amount', cap_pct_of_net: 0.1, hint: 'Capped at 10% of income after other deductions.' },
]

export interface TaxSpec {
  country: string
  currency: string
  brackets: Bracket[]
  expense_deduction: { rate: number; cap: number }
  allowances: AllowanceDef[]
  retirement_group: { keys: string[]; cap: number }
}

export const TH_SPEC: TaxSpec = {
  country: 'Thailand',
  currency: 'THB',
  brackets: TH_BRACKETS,
  expense_deduction: { rate: 0.5, cap: 100_000 },
  allowances: TH_ALLOWANCES,
  retirement_group: { keys: ['provident', 'ssf', 'rmf'], cap: 500_000 },
}

export const COUNTRIES: Record<string, TaxSpec> = { Thailand: TH_SPEC }

export function specFor(country?: string | null): TaxSpec {
  return COUNTRIES[country || 'Thailand'] ?? TH_SPEC
}
export function allowanceDefs(spec: TaxSpec = TH_SPEC): AllowanceDef[] {
  return spec.allowances
}

export type AllowanceValues = Record<string, number | boolean | undefined>

// ── Calculation (pure) ───────────────────────────────────────────────────────
// Automatic employment-expense deduction (50% of income, capped).
export function expenseDeduction(gross: number, spec: TaxSpec): number {
  const ed = spec.expense_deduction
  return Math.min(ed.rate * (gross || 0), ed.cap)
}

// The requested allowance amount from a raw input, before caps.
function rawValue(a: AllowanceDef, val: number | boolean | undefined): number {
  if (a.type === 'fixed') return a.amount ?? 0
  if (a.type === 'flag') return val ? a.amount ?? 0 : 0
  if (a.type === 'count') {
    let units = Math.trunc(Number(val) || 0)
    units = Math.max(0, a.max_units != null ? Math.min(units, a.max_units) : units)
    return units * (a.per ?? 0)
  }
  return Math.max(0, Number(val) || 0) // amount
}

// Apply an `amount` allowance's per-item caps (percentage-of-gross and/or
// absolute). `cap_pct_of_net` is handled separately (needs the net figure).
function capAmount(a: AllowanceDef, raw: number, gross: number): number {
  let capped = raw
  if (a.cap_pct != null) capped = Math.min(capped, a.cap_pct * (gross || 0))
  if (a.cap != null) capped = Math.min(capped, a.cap)
  return Math.max(0, capped)
}

export interface AllowanceItem { key: string; label: string; amount: number }

// Total allowed deductions and a per-item breakdown. Non-donation allowances are
// capped individually, with the shared retirement cap applied across
// provident/SSF/RMF in list order. Donations cap last, against income after the
// expense deduction and every other allowance (Thai 10%-of-net rule).
export function applyAllowances(gross: number, values: AllowanceValues, spec: TaxSpec): { total: number; breakdown: AllowanceItem[] } {
  gross = gross || 0
  values = values || {}
  const retire = spec.retirement_group
  const retireKeys = new Set(retire?.keys ?? [])
  const retireCap = retire?.cap
  let retireUsed = 0

  let total = 0
  const breakdown: AllowanceItem[] = []
  const donationDefs: AllowanceDef[] = []
  for (const a of spec.allowances) {
    if (a.cap_pct_of_net != null) {
      donationDefs.push(a) // deferred to the net-based pass
      continue
    }
    let capped = capAmount(a, rawValue(a, values[a.key]), gross)
    if (retireKeys.has(a.key) && retireCap != null) {
      capped = Math.min(capped, Math.max(0, retireCap - retireUsed))
      retireUsed += capped
    }
    total += capped
    breakdown.push({ key: a.key, label: a.label, amount: capped })
  }

  const netBeforeDonation = Math.max(0, gross - expenseDeduction(gross, spec) - total)
  for (const a of donationDefs) {
    const raw = rawValue(a, values[a.key])
    const capped = Math.max(0, Math.min(raw, (a.cap_pct_of_net ?? 0) * netBeforeDonation))
    total += capped
    breakdown.push({ key: a.key, label: a.label, amount: capped })
  }

  return { total, breakdown }
}

export interface BracketRow { lower: number; upper: number | null; rate: number; income_in_band: number; tax: number }

// Tax on `taxable` income. Returns the tax due, the bands that have income in
// them, and the marginal rate.
export function progressiveTax(taxable: number, brackets: Bracket[]): { tax: number; rows: BracketRow[]; marginal: number } {
  taxable = Math.max(0, taxable || 0)
  let tax = 0
  let marginal = 0
  const rows: BracketRow[] = []
  for (const [lo, hi, rate] of brackets) {
    if (taxable <= lo) break
    const upper = hi == null ? taxable : Math.min(taxable, hi)
    const bandIncome = upper - lo
    if (bandIncome <= 0) continue
    const bandTax = bandIncome * rate
    tax += bandTax
    marginal = rate
    rows.push({ lower: lo, upper: hi, rate, income_in_band: bandIncome, tax: bandTax })
  }
  return { tax, rows, marginal }
}

export interface TaxStatus {
  gross: number
  expense_deduction: number
  allowance_total: number
  allowance_breakdown: AllowanceItem[]
  net_taxable: number
  tax_due: number
  bracket_rows: BracketRow[]
  effective_rate: number
  marginal_rate: number
  tax_paid: number
  remaining: number
}

// Full estimate for a tax year: deductions, net taxable income, tax due,
// effective/marginal rate, and the outstanding balance vs. tax already paid.
export function incomeTaxStatus(gross: number, values: AllowanceValues, spec: TaxSpec, taxPaid = 0): TaxStatus {
  gross = gross || 0
  const expDed = expenseDeduction(gross, spec)
  const { total: allowTotal, breakdown } = applyAllowances(gross, values, spec)
  const netTaxable = Math.max(0, gross - expDed - allowTotal)
  const { tax, rows, marginal } = progressiveTax(netTaxable, spec.brackets)
  taxPaid = taxPaid || 0
  return {
    gross,
    expense_deduction: expDed,
    allowance_total: allowTotal,
    allowance_breakdown: breakdown,
    net_taxable: netTaxable,
    tax_due: tax,
    bracket_rows: rows,
    effective_rate: gross ? tax / gross : 0,
    marginal_rate: marginal,
    tax_paid: taxPaid,
    remaining: tax - taxPaid,
  }
}

// ── Ledger helpers ───────────────────────────────────────────────────────────
// A "selection" targets a whole category ("Category") or one subcategory
// ("Category / Subcategory"); an empty category (" / Sub") is a legacy
// subcategory-only match.
function parseSelection(s: string): [string, string] {
  if (s.includes(' / ')) {
    const idx = s.indexOf(' / ')
    return [s.slice(0, idx).trim(), s.slice(idx + 3).trim()]
  }
  return [s.trim(), '']
}

function selList(selections: string | string[] | null | undefined): string[] {
  if (selections == null) return []
  const arr = typeof selections === 'string' ? [selections] : selections
  return arr.filter((s) => s && String(s).trim())
}

// Does a transaction match any of the parsed selections?
function matchesSelection(txn: Txn, selections: string[]): boolean {
  for (const sel of selections) {
    const [cat, sub] = parseSelection(sel)
    if (!cat && !sub) continue
    if (!cat) {
      if (txn.subcategory === sub) return true // legacy subcategory-only
      continue
    }
    if (txn.category === cat && (!sub || txn.subcategory === sub)) return true
  }
  return false
}

const yearOf = (period: string): number => Number(period.slice(0, 4))

// Sum of tracked Income transactions in the calendar year. With a non-empty
// selection list, only the targeted rows are counted; otherwise all income.
export function grossIncomeForYear(txns: Txn[], year: number, selections?: string | string[] | null): number {
  const sels = selList(selections)
  let total = 0
  for (const t of txns) {
    if (t.type !== 'Income' || yearOf(t.period) !== year) continue
    if (sels.length && !matchesSelection(t, sels)) continue
    total += t.amount
  }
  return total
}

// Sum of Expense transactions matched by `selections` in the year — the tax
// already paid (withholding / prepayments).
export function taxPaidForYear(txns: Txn[], selections: string | string[] | null | undefined, year: number): number {
  const sels = selList(selections)
  if (!sels.length) return 0
  let total = 0
  for (const t of txns) {
    if (t.type === 'Expense' && yearOf(t.period) === year && matchesSelection(t, sels)) total += t.amount
  }
  return total
}

export interface TaxPayment { date: string; amount: number; category: string; subcategory: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// ISO "YYYY-MM-DD" → "DD-MMM-YYYY" (matches the Python page's payment rows).
function fmtDate(period: string): string {
  const [y, m, d] = period.slice(0, 10).split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

// The individual tax-payment transactions for the year (the rows summed by
// taxPaidForYear), oldest first.
export function taxPaymentsForYear(txns: Txn[], selections: string | string[] | null | undefined, year: number): TaxPayment[] {
  const sels = selList(selections)
  if (!sels.length) return []
  return txns
    .filter((t) => t.type === 'Expense' && yearOf(t.period) === year && matchesSelection(t, sels))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
    .map((t) => ({ date: fmtDate(t.period), amount: t.amount, category: t.category || '', subcategory: t.subcategory || '' }))
}

// Years present in the ledger plus the current year, newest first.
export function ledgerYears(txns: Txn[], current?: number): number[] {
  const cur = current || new Date().getFullYear()
  const years = new Set<number>([cur])
  for (const t of txns) {
    const y = yearOf(t.period)
    if (Number.isFinite(y)) years.add(y)
  }
  return [...years].sort((a, b) => b - a)
}

// ── Config defaults ──────────────────────────────────────────────────────────
export interface TaxCfg { country: string; allowances: AllowanceValues; incomeSelections?: string[]; taxSelections?: string[] }

// Zero/false defaults for every user-entered allowance (fixed ones excluded).
export function defaultAllowances(): AllowanceValues {
  const out: AllowanceValues = {}
  for (const a of TH_ALLOWANCES) if (a.type !== 'fixed') out[a.key] = a.type === 'flag' ? false : 0
  return out
}

export const DEFAULT_TAX: TaxCfg = { country: 'Thailand', allowances: defaultAllowances(), incomeSelections: [], taxSelections: [] }
