// Parity port of tests/test_importer.py — amount/date parsing, header guessing,
// preset detection, and row assembly (including Thai/MeowJot support).
import { describe, it, expect } from 'vitest'
import { detectPreset, guessMapping, TYPE_SYNONYMS, type Profile } from './presets'
import { parseAmount, parseDate, parseRows, unknownNames, type Record_ } from './parse'

describe('parseAmount', () => {
  it('dot decimal, strips currency/thousands junk', () => {
    expect(parseAmount('1,234.56', false)).toBe(1234.56)
    expect(parseAmount('$1,000', false)).toBe(1000)
  })
  it('comma decimal', () => {
    expect(parseAmount('1.234,56', true)).toBe(1234.56)
  })
  it('parentheses are negative', () => {
    expect(parseAmount('(50.00)', false)).toBe(-50)
  })
  it('blank and junk → null', () => {
    expect(parseAmount('', false)).toBeNull()
    expect(parseAmount(null, false)).toBeNull()
    expect(parseAmount('n/a', false)).toBeNull()
  })
})

describe('parseDate', () => {
  it('honours explicit dmy / mdy orderings', () => {
    expect(parseDate('05/03/2026', 'dmy')).toBe('2026-03-05')
    expect(parseDate('05/03/2026', 'mdy')).toBe('2026-05-03')
  })
  it('converts Buddhist Era years', () => {
    expect(parseDate('1/12/2568', 'dmy')).toBe('2025-12-01')
    expect(parseDate('05/03/2026', 'dmy')).toBe('2026-03-05') // CE untouched
    expect(parseDate('2568-12-01', 'auto')).toBe('2025-12-01')
  })
  it('auto-infers ISO and US layouts', () => {
    expect(parseDate('2026-07-01 00:00:00', 'auto')).toBe('2026-07-01')
    expect(parseDate('07/01/2026', 'auto')).toBe('2026-07-01') // ambiguous → month-first
    expect(parseDate('13/07/2026', 'auto')).toBe('2026-07-13') // 13 > 12 → day-first
  })
  it('returns null for unparseable text', () => {
    expect(parseDate('not-a-date', 'auto')).toBeNull()
  })
})

describe('guessMapping', () => {
  it('matches known English headers', () => {
    const cols = guessMapping(['Date', 'Amount', 'Account', 'Memo']).columns
    expect(cols.Date).toBe('Date')
    expect(cols.Amount).toBe('Amount')
    expect(cols.Account).toBe('Account')
    expect(cols.Description).toBe('Memo')
  })
  it('matches Thai headers', () => {
    const cols = guessMapping(['วันที่', 'ประเภท', 'จำนวน', 'หมวดหมู่', 'บันทึก']).columns
    expect(cols.Date).toBe('วันที่')
    expect(cols.Type).toBe('ประเภท')
    expect(cols.Amount).toBe('จำนวน')
    expect(cols.Category).toBe('หมวดหมู่')
    expect(cols.Note).toBe('บันทึก')
  })
})

describe('Thai type synonyms', () => {
  it('maps รายรับ/รายจ่าย/โอน', () => {
    expect(TYPE_SYNONYMS['รายรับ']).toBe('Income')
    expect(TYPE_SYNONYMS['รายจ่าย']).toBe('Expense')
    expect(TYPE_SYNONYMS['โอนเข้า']).toBe('Transfer-In')
    expect(TYPE_SYNONYMS['โอนออก']).toBe('Transfer-Out')
  })
})

const P = (columns: Partial<Profile['columns']>, opts?: Partial<Profile['options']>): Profile => ({
  name: '',
  columns: { Date: null, Type: null, Amount: null, Inflow: null, Outflow: null, Account: null,
    Category: null, Subcategory: null, Note: null, Description: null, Currency: null, Id: null, TransferId: null,
    ...columns },
  options: { date_order: 'auto', decimal: 'dot', ...opts },
})

describe('parseRows', () => {
  it('signed-amount mode: sign decides Income vs Expense', () => {
    const raw: Record_[] = [
      { Date: '2026-01-05', Amount: '1000', Account: 'Bank' },
      { Date: '2026-01-06', Amount: '-250', Account: 'Bank' },
    ]
    const out = parseRows(raw, P({ Date: 'Date', Amount: 'Amount', Account: 'Account' }, { date_order: 'ymd' }))
    expect(out.skipped).toBe(0)
    const types = out.rows.map((r) => [r.type, r.amount])
    expect(types).toContainEqual(['Income', 1000])
    expect(types).toContainEqual(['Expense', 250])
  })

  it('reports an unparseable date', () => {
    const out = parseRows([{ Date: 'not-a-date', Amount: '10', Account: 'Bank' }],
      P({ Date: 'Date', Amount: 'Amount', Account: 'Account' }))
    expect(out.rows).toHaveLength(0)
    expect(out.skipped).toBe(1)
    expect(out.issues['unparseable date']).toBe(1)
  })

  it('requires an account', () => {
    const out = parseRows([{ Date: '2026-01-05', Amount: '10', Account: '' }],
      P({ Date: 'Date', Amount: 'Amount', Account: 'Account' }, { date_order: 'ymd' }))
    expect(out.skipped).toBe(1)
    expect(out.issues['missing account']).toBe(1)
  })

  it('inflow/outflow two-column mode', () => {
    const raw: Record_[] = [
      { Date: '2026-01-05', Inflow: '1000', Outflow: '', Account: 'Bank' },
      { Date: '2026-01-06', Inflow: '', Outflow: '250', Account: 'Bank' },
    ]
    const out = parseRows(raw, P({ Date: 'Date', Inflow: 'Inflow', Outflow: 'Outflow', Account: 'Account' }, { date_order: 'ymd' }))
    expect(out.rows.map((r) => [r.type, r.amount])).toEqual([['Income', 1000], ['Expense', 250]])
  })

  it('rejects an unknown type label', () => {
    const out = parseRows([{ Date: '2026-01-05', Type: 'wat', Amount: '10', Account: 'Bank' }],
      P({ Date: 'Date', Type: 'Type', Amount: 'Amount', Account: 'Account' }, { date_order: 'ymd' }))
    expect(out.skipped).toBe(1)
    expect(Object.keys(out.issues)[0]).toContain('unknown type')
  })
})

// ── MeowJot end-to-end (mirrors test_meowjot_*) ──────────────────────────────
const MEOWJOT_HEADERS = ['วันที่', 'เวลา', 'ประเภท', 'หมวดหมู่', 'แท็ก', 'จำนวน',
  'โน๊ต', 'ช่องทางจ่าย', 'จ่ายจาก', 'ธนาคารผู้รับ', 'ผู้รับ']

const rec = (vals: string[]): Record_ =>
  Object.fromEntries(MEOWJOT_HEADERS.map((h, i) => [h, vals[i]]))

describe('MeowJot preset', () => {
  it('is detected by header fingerprint', () => {
    const p = detectPreset(MEOWJOT_HEADERS)
    expect(p?.name).toContain('MeowJot')
    expect(p?.columns.Date).toBe('วันที่')
    expect(p?.columns.Account).toBe('จ่ายจาก')
    expect(p?.options.date_order).toBe('dmy')
  })

  it('parses its rows (BE dates, signed amounts, "-" placeholder)', () => {
    const raw = [
      rec(['1/12/2568', '12:35', 'รายจ่าย', 'อาหาร', '#ข้าวกลางวัน', '-290', 'ข้าวมันไก่', 'บัญชี', 'กสิกรไทย', '-', 'บริษัท สบาย สบาย จำกัด']),
      rec(['3/12/2568', '17:55', 'รายจ่าย', 'สุขภาพ, ดูแลตัวเอง', '-', '-20', '-', 'บัญชี', 'กรุงไทย', 'กสิกรไทย', 'การกีฬาสุขภาพดี']),
      rec(['4/12/2568', '09:00', 'รายรับ', 'เงินเดือน', '-', '50000', '-', 'บัญชี', 'กสิกรไทย', '-', '-']),
    ]
    const out = parseRows(raw, detectPreset(MEOWJOT_HEADERS)!)
    expect(out.skipped).toBe(0)
    expect(out.rows).toHaveLength(3)
    const [lunch, health, salary] = out.rows
    expect(lunch.period).toBe('2025-12-01')
    expect([lunch.type, lunch.amount]).toEqual(['Expense', 290])
    expect(lunch.category).toBe('อาหาร')
    expect(lunch.account).toBe('กสิกรไทย')
    expect(lunch.note).toBe('ข้าวมันไก่')
    expect(health.category).toBe('สุขภาพ, ดูแลตัวเอง')
    expect(health.note).toBe('') // "-" placeholder cleaned
    expect([salary.type, salary.amount]).toEqual(['Income', 50000])
  })
})

describe('unknownNames', () => {
  it('flags unconfigured accounts and categories, ignoring transfer legs', () => {
    const raw: Record_[] = [
      { Date: '2026-01-05', Type: 'Expense', Amount: '10', Account: 'NewBank', Category: 'Snacks' },
      { Date: '2026-01-06', Type: 'Transfer-Out', Amount: '10', Account: 'NewBank', Category: 'NewSavings' },
    ]
    const out = parseRows(raw, P({ Date: 'Date', Type: 'Type', Amount: 'Amount', Account: 'Account', Category: 'Category' }, { date_order: 'ymd' }))
    const u = unknownNames(out.rows, ['Cash'], new Set(['Food']))
    expect(u.accounts).toContain('NewBank')
    expect(u.accounts).toContain('NewSavings') // transfer counter-account is an account
    expect(u.categories).toEqual(['Snacks']) // transfer Category not treated as a category
  })
})
