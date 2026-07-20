// Row parsing — port of importer.py parse_rows / _parse_amount / _parse_dates /
// _clean / _link_transfer_pairs / unknown_names. Pure over plain records so it's
// unit-testable. A "record" is one file row as { header: cellText }.

import { TYPE_SYNONYMS, TRANSFER_TYPES, type ColumnMap, type Profile, type TargetField } from './presets'

export type Record_ = Record<string, string>

export interface ParsedRow {
  period: string // YYYY-MM-DD
  type: string
  amount: number
  account: string
  category: string
  subcategory: string
  note: string
  description: string
  currency: string
  id: string
  transferGroup: string
  sourceRow: number
}

export interface ParseResult {
  rows: ParsedRow[]
  issues: Record<string, number>
  skipped: number
}

// ── amounts ──────────────────────────────────────────────────────────────────
const AMOUNT_JUNK = /[^0-9,.\-()]/g

export function parseAmount(raw: unknown, decimalComma: boolean): number | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  const neg = s.startsWith('(') && s.endsWith(')')
  s = s.replace(AMOUNT_JUNK, '').replace(/[()]/g, '')
  if (decimalComma) s = s.replace(/\./g, '').replace(/,/g, '.')
  else s = s.replace(/,/g, '')
  const v = parseFloat(s)
  if (Number.isNaN(v)) return null
  return neg ? -v : v
}

// "-" is the empty-cell placeholder in Thai app exports (MeowJot et al.).
export function clean(v: unknown): string {
  if (v == null) return ''
  const s = String(v).trim()
  return s.toLowerCase() === 'nan' || s === '-' ? '' : s
}

// ── dates ──────────────────────────────────────────────────────────────────
// Buddhist Era years (Thai apps: 2568 = CE 2025) — any 4-digit token ≥ 2400
// maps to CE by subtracting 543 (4-digit years ≥ 2400 → CE 1857–2100).
function convertBEYears(s: string): string {
  return s.replace(/(?<!\d)(\d{4})(?!\d)/g, (_m, y: string) =>
    Number(y) >= 2400 ? String(Number(y) - 543) : y,
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

// Parse a date cell under the chosen ordering. Separator-agnostic (/, -, .),
// tolerates a trailing time, converts Buddhist Era first. Returns YYYY-MM-DD or
// null. `auto` infers the layout per value (year by a 4-digit/>31 token, day by
// a >12 token), defaulting to month-first for the ambiguous all-≤12 case — the
// same bias as pandas to_datetime(dayfirst=False).
export function parseDate(raw: unknown, order: string): string | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  s = convertBEYears(s)
  const datePart = s.split(/[ T]/)[0]
  const toks = datePart.split(/[^\d]+/).filter(Boolean)
  if (toks.length < 3) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : iso(d.getFullYear(), d.getMonth() + 1, d.getDate())
  }
  const n = toks.map(Number)
  let y: number, mo: number, da: number
  switch (order) {
    case 'dmy': [da, mo, y] = n; break
    case 'mdy': [mo, da, y] = n; break
    case 'ymd': [y, mo, da] = n; break
    case 'ydm': [y, da, mo] = n; break
    default: {
      // auto: locate the year, then day (>12), else month-first.
      const yIdx = toks[0].length === 4 || n[0] > 31 ? 0 : 2
      y = n[yIdx]
      const [i, j] = yIdx === 0 ? [1, 2] : [0, 1]
      if (n[i] > 12) { da = n[i]; mo = n[j] }
      else if (n[j] > 12) { mo = n[i]; da = n[j] }
      else { mo = n[i]; da = n[j] } // ambiguous → month-first
    }
  }
  if (y < 100) y += y < 70 ? 2000 : 1900 // 2-digit year
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
  return iso(y, mo, da)
}

// ── the pipeline ───────────────────────────────────────────────────────────
export function parseRows(records: Record_[], profile: Profile): ParseResult {
  const cols = profile.columns
  const order = profile.options.date_order || 'auto'
  const decimalComma = (profile.options.decimal || 'dot') === 'comma'

  const val = (r: Record_, field: TargetField): string | undefined => {
    const c = cols[field]
    return c != null ? r[c] : undefined
  }
  const mapped = (field: TargetField) => cols[field] != null

  if (!mapped('Date')) throw new Error('No Date column is mapped.')
  if (!mapped('Amount') && !mapped('Inflow') && !mapped('Outflow'))
    throw new Error('No Amount (or Inflow/Outflow) column is mapped.')

  const rows: ParsedRow[] = []
  const issues: Record<string, number> = {}
  const issue = (reason: string) => { issues[reason] = (issues[reason] ?? 0) + 1 }

  records.forEach((r, i) => {
    const period = parseDate(val(r, 'Date'), order)
    if (!period) { issue('unparseable date'); return }

    let amount: number
    let type: string
    if (mapped('Inflow') || mapped('Outflow')) {
      const inflow = (mapped('Inflow') ? parseAmount(val(r, 'Inflow'), decimalComma) : 0) || 0
      const outflow = (mapped('Outflow') ? parseAmount(val(r, 'Outflow'), decimalComma) : 0) || 0
      if (inflow === 0 && outflow === 0) { issue('no amount'); return }
      if (inflow >= outflow) { amount = inflow - outflow; type = 'Income' }
      else { amount = outflow - inflow; type = 'Expense' }
    } else {
      const a = parseAmount(val(r, 'Amount'), decimalComma)
      if (a == null) { issue('unparseable amount'); return }
      if (mapped('Type')) {
        const label = clean(val(r, 'Type')).toLowerCase()
        const t = TYPE_SYNONYMS[label]
        if (!t) { issue(`unknown type '${label}'`); return }
        type = t
        amount = Math.abs(a)
      } else {
        type = a >= 0 ? 'Income' : 'Expense'
        amount = Math.abs(a)
      }
    }

    const account = mapped('Account') ? clean(val(r, 'Account')) : ''
    if (!account) { issue('missing account'); return }

    const currency = mapped('Currency') ? clean(val(r, 'Currency')) : ''
    rows.push({
      period,
      type,
      amount: Math.round(amount * 100) / 100,
      account,
      category: mapped('Category') ? clean(val(r, 'Category')) : '',
      subcategory: mapped('Subcategory') ? clean(val(r, 'Subcategory')) : '',
      note: mapped('Note') ? clean(val(r, 'Note')) : '',
      description: mapped('Description') ? clean(val(r, 'Description')) : '',
      currency,
      id: mapped('Id') ? clean(val(r, 'Id')) : '',
      transferGroup: mapped('TransferId') ? clean(val(r, 'TransferId')) : '',
      sourceRow: i,
    })
  })

  linkTransferPairs(rows)
  return { rows, issues, skipped: Object.values(issues).reduce((a, b) => a + b, 0) }
}

// Give transfer halves a shared group when the file didn't provide one — greedy
// 1:1 match on equal date+amount with swapped account/category.
function linkTransferPairs(rows: ParsedRow[]): void {
  if (rows.some((r) => r.transferGroup)) return
  const outs = new Map<string, ParsedRow[]>()
  for (const r of rows) {
    if (r.type === 'Transfer-Out') {
      const key = `${r.period}|${r.amount}|${r.account}|${r.category}`
      ;(outs.get(key) ?? outs.set(key, []).get(key)!).push(r)
    }
  }
  for (const r of rows) {
    if (r.type === 'Transfer-In') {
      const key = `${r.period}|${r.amount}|${r.category}|${r.account}`
      const mate = outs.get(key)?.shift()
      if (mate) {
        const link = crypto.randomUUID()
        r.transferGroup = mate.transferGroup = link
      }
    }
  }
}

// Accounts / categories present in the import but not yet configured. Transfer
// rows are excluded from the category check (their Category holds the counter-
// account, which is checked against accounts instead).
export function unknownNames(
  rows: ParsedRow[],
  knownAccounts: string[],
  knownCategories: Set<string>,
): { accounts: string[]; categories: string[] } {
  const accSet = new Set(knownAccounts)
  const accounts = new Set<string>()
  const categories = new Set<string>()
  for (const r of rows) {
    if (r.account && !accSet.has(r.account)) accounts.add(r.account)
    if (TRANSFER_TYPES.includes(r.type)) {
      if (r.category && !accSet.has(r.category)) accounts.add(r.category)
    } else if (r.category && !knownCategories.has(r.category)) {
      categories.add(r.category)
    }
  }
  return { accounts: [...accounts].sort(), categories: [...categories].sort() }
}

export function isMappable(profile: Profile): boolean {
  return Object.values(profile.columns as ColumnMap).some((c) => c != null)
}
