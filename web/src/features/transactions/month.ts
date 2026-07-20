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
