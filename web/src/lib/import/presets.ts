// Import presets & mapping — port of src/io/importer.py (the preset table,
// detect_preset, guess_mapping, and the type-synonym vocabulary). Pure data +
// pure functions so they're unit-testable without a file or the DB.

export type TargetField =
  | 'Date' | 'Type' | 'Amount' | 'Inflow' | 'Outflow' | 'Account'
  | 'Category' | 'Subcategory' | 'Note' | 'Description' | 'Currency'
  | 'Id' | 'TransferId'

export const TARGET_FIELDS: TargetField[] = [
  'Date', 'Type', 'Amount', 'Inflow', 'Outflow', 'Account',
  'Category', 'Subcategory', 'Note', 'Description', 'Currency', 'Id', 'TransferId',
]

export type ColumnMap = Record<TargetField, string | null>
export type DateOrder = 'auto' | 'dmy' | 'mdy' | 'ymd' | 'ydm'
export type Decimal = 'dot' | 'comma'
export interface Profile {
  name: string
  columns: ColumnMap
  options: { date_order: DateOrder; decimal: Decimal }
}

// The neutral export layout (exporter.py EXPORT_COLUMNS) — a Money Tracker
// export re-imports one-to-one.
export const EXPORT_COLUMNS = [
  'Id', 'Date', 'Type', 'Account', 'Category', 'Subcategory',
  'Amount', 'Currency', 'Note', 'Description', 'TransferId',
]

// Canonical type labels (English + Thai). Lower-cased lookup.
export const TYPE_SYNONYMS: Record<string, string> = {
  income: 'Income', in: 'Income', credit: 'Income', deposit: 'Income',
  expense: 'Expense', 'exp.': 'Expense', exp: 'Expense', debit: 'Expense',
  withdrawal: 'Expense', spending: 'Expense',
  'transfer-out': 'Transfer-Out', 'transfer out': 'Transfer-Out', transfer: 'Transfer-Out',
  'transfer-in': 'Transfer-In', 'transfer in': 'Transfer-In',
  'adjustment-in': 'Adjustment-In', 'income balance': 'Adjustment-In',
  'adjustment-out': 'Adjustment-Out', 'expense balance': 'Adjustment-Out',
  saving: 'Saving',
  // Thai (MeowJot and other Thai apps)
  'รายรับ': 'Income', 'รายจ่าย': 'Expense',
  'โอนเข้า': 'Transfer-In', 'โอนออก': 'Transfer-Out',
}

export const TRANSFER_TYPES = ['Transfer-In', 'Transfer-Out']

function cols(partial: Partial<ColumnMap>): ColumnMap {
  const base = Object.fromEntries(TARGET_FIELDS.map((f) => [f, null])) as ColumnMap
  return { ...base, ...partial }
}

interface Preset {
  name: string
  fingerprint: string[]
  columns: ColumnMap
  options: { date_order: DateOrder; decimal: Decimal }
}

export const PRESETS: Preset[] = [
  {
    name: 'Money Tracker export',
    fingerprint: EXPORT_COLUMNS,
    columns: cols({
      Date: 'Date', Type: 'Type', Amount: 'Amount', Account: 'Account',
      Category: 'Category', Subcategory: 'Subcategory', Note: 'Note',
      Description: 'Description', Currency: 'Currency', Id: 'Id', TransferId: 'TransferId',
    }),
    options: { date_order: 'auto', decimal: 'dot' },
  },
  {
    name: 'Realbyte Money Manager',
    fingerprint: ['Period', 'Accounts', 'Income/Expense', 'Amount'],
    columns: cols({
      Date: 'Period', Type: 'Income/Expense', Amount: 'Amount', Account: 'Accounts',
      Category: 'Category', Subcategory: 'Subcategory', Note: 'Note', Description: 'Description',
    }),
    options: { date_order: 'auto', decimal: 'dot' },
  },
  {
    name: 'YNAB register',
    fingerprint: ['Payee', 'Outflow', 'Inflow'],
    columns: cols({
      Date: 'Date', Inflow: 'Inflow', Outflow: 'Outflow', Account: 'Account',
      Category: 'Category', Note: 'Payee', Description: 'Memo',
    }),
    options: { date_order: 'auto', decimal: 'dot' },
  },
  {
    // Verified against meowjot.com/example/Export_sample.csv: D/M/YYYY Buddhist
    // Era dates, signed amounts, รายรับ/รายจ่าย types, "-" empty placeholder.
    name: 'เหมียวจด (MeowJot)',
    fingerprint: ['วันที่', 'ประเภท', 'หมวดหมู่', 'จำนวน'],
    columns: cols({
      Date: 'วันที่', Type: 'ประเภท', Amount: 'จำนวน', Account: 'จ่ายจาก',
      Category: 'หมวดหมู่', Note: 'โน๊ต', Description: 'ผู้รับ',
    }),
    options: { date_order: 'dmy', decimal: 'dot' },
  },
]

// header-name → target-field guesses for unknown files (English + Thai)
const HEADER_GUESSES: Record<TargetField, string[]> = {
  Date: ['date', 'period', 'transaction date', 'posted', 'time', 'datetime', 'วันที่'],
  Type: ['type', 'income/expense', 'transaction type', 'direction', 'ประเภท'],
  Amount: ['amount', 'value', 'sum', 'จำนวน', 'จำนวนเงิน'],
  Inflow: ['inflow', 'credit amount', 'money in', 'paid in'],
  Outflow: ['outflow', 'debit amount', 'money out', 'paid out'],
  Account: ['account', 'accounts', 'wallet', 'source', 'บัญชี', 'กระเป๋า', 'จ่ายจาก'],
  Category: ['category', 'หมวดหมู่'],
  Subcategory: ['subcategory', 'sub category', 'sub-category', 'หมวดหมู่ย่อย'],
  Note: ['note', 'payee', 'merchant', 'โน๊ต', 'โน้ต', 'บันทึก', 'หมายเหตุ'],
  Description: ['description', 'memo', 'details', 'reference', 'รายละเอียด'],
  Currency: ['currency', 'ccy', 'สกุลเงิน'],
  Id: ['id', 'transaction id'],
  TransferId: ['transferid', 'transfer id'],
}

const emptyMap = (): ColumnMap =>
  Object.fromEntries(TARGET_FIELDS.map((f) => [f, null])) as ColumnMap

// Match a built-in preset by header fingerprint (subset test). User profiles
// are matched by the caller (they live in the DB, not here).
export function detectPreset(headers: string[]): Profile | null {
  const hs = new Set(headers)
  for (const p of PRESETS) {
    if (p.fingerprint.every((f) => hs.has(f))) {
      return { name: p.name, columns: { ...p.columns }, options: { ...p.options } }
    }
  }
  return null
}

// Best-effort header→field guess for files no preset matches.
export function guessMapping(headers: string[]): Profile {
  const columns = emptyMap()
  const used = new Set<string>()
  for (const field of TARGET_FIELDS) {
    const names = HEADER_GUESSES[field]
    for (const h of headers) {
      if (used.has(h)) continue
      if (names.includes(h.trim().toLowerCase())) {
        columns[field] = h
        used.add(h)
        break
      }
    }
  }
  return { name: '', columns, options: { date_order: 'auto', decimal: 'dot' } }
}
