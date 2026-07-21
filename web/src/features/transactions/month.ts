import type { Txn } from '../../db'
import { getLang } from '../../i18n'

// Month key helpers ("YYYY-MM") and per-month/-day grouping for the list.

export function monthKeyOf(periodIso: string): string {
  return periodIso.slice(0, 7)
}

export function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

// Shift a "YYYY-MM" key by whole months.
export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// "July 2026" / "กรกฎาคม 2569" — localized via the active app language.
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  const locale = getLang() === 'th' ? 'th-TH' : 'en-US'
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

export function filterByMonth(txns: Txn[], key: string): Txn[] {
  return txns.filter((t) => monthKeyOf(t.period) === key)
}

// Rows whose day falls in [startIso, endIso] inclusive (YYYY-MM-DD compare).
export function filterByRange(txns: Txn[], startIso: string, endIso: string): Txn[] {
  return txns.filter((t) => {
    const d = t.period.slice(0, 10)
    return d >= startIso && d <= endIso
  })
}

// Latest transaction day (the "today" anchor for relative windows); falls back
// to the actual today on an empty ledger. Mirrors data.reference_date().
export function latestPeriod(txns: Txn[]): string {
  let max = ''
  for (const t of txns) {
    const d = t.period.slice(0, 10)
    if (d > max) max = d
  }
  return max || new Date().toISOString().slice(0, 10)
}

// Shift a "YYYY-MM-DD" day by whole days (calendar-correct across months/years).
export function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// Hide the Transfer-In leg of any pair whose Transfer-Out (same transferId) is
// also present, so a transfer shows once. Unpaired legs stay visible.
export function collapseTransfers(txns: Txn[]): Txn[] {
  const outLinks = new Set(
    txns.filter((t) => t.type === 'Transfer-Out' && t.transferId).map((t) => t.transferId),
  )
  return txns.filter((t) => !(t.type === 'Transfer-In' && t.transferId && outLinks.has(t.transferId)))
}

// Group rows by day (date desc), each group already sorted newest-first.
export function groupByDay(txns: Txn[]): [string, Txn[]][] {
  const byDay = new Map<string, Txn[]>()
  for (const t of txns) {
    const day = t.period.slice(0, 10)
    ;(byDay.get(day) ?? byDay.set(day, []).get(day)!).push(t)
  }
  return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

// A day's Income and Expense totals (transfers excluded), for the day header.
export function daySummary(rows: Txn[]): { income: number; expense: number } {
  let income = 0
  let expense = 0
  for (const t of rows) {
    if (t.type === 'Income') income += t.amount
    else if (t.type === 'Expense') expense += t.amount
  }
  return { income, expense }
}

// Split a "YYYY-MM-DD" key into a day-of-month number, short localized weekday
// (e.g. { dayNum: "29", weekday: "Fri" / "ศ." }), and the weekday index (0=Sun)
// for the daily group header.
export function dayHeaderParts(dayIso: string): { dayNum: string; weekday: string; dow: number } {
  const [y, m, d] = dayIso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const locale = getLang() === 'th' ? 'th-TH' : 'en-US'
  return {
    dayNum: String(d),
    weekday: date.toLocaleDateString(locale, { weekday: 'short' }),
    dow: date.getDay(),
  }
}

export interface MonthSummary {
  income: number
  expense: number
  net: number
}

// Income = Σ Income; Expense = Σ Expense (transfers/savings/adjustments excluded),
// mirroring the Dash transactions summary strip.
export function monthSummary(txns: Txn[]): MonthSummary {
  let income = 0
  let expense = 0
  for (const t of txns) {
    if (t.type === 'Income') income += t.amount
    else if (t.type === 'Expense') expense += t.amount
  }
  return { income, expense, net: income - expense }
}
