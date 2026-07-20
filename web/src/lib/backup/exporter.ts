// Export the ledger in the neutral "Money Tracker export" shape (exporter.py
// EXPORT_COLUMNS) — a faithful, re-importable copy. CSV is generated directly
// (no SheetJS needed); the Excel path lazy-imports xlsx only when used, so the
// heavy dependency never sits in a page's static graph.
import { type Txn } from '../../db'
import { EXPORT_COLUMNS } from '../import/presets'

// exporter.py DATE_FMT is "YYYY-MM-DD HH:MM:SS"; our periods are date-only.
const dateCell = (period: string) => `${period.slice(0, 10)} 00:00:00`

export function toExportRecords(txns: Txn[]): Record<string, string>[] {
  const oldestFirst = [...txns].sort((a, b) => a.period.localeCompare(b.period))
  return oldestFirst.map((t) => ({
    Id: t.id != null ? String(t.id) : '',
    Date: dateCell(t.period),
    Type: t.type,
    Account: t.account,
    Category: t.category,
    Subcategory: t.subcategory ?? '',
    Amount: String(t.amount),
    Currency: t.currency,
    Note: t.note ?? '',
    Description: '', // no Description field in the web model yet
    TransferId: t.transferId ?? '',
  }))
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toCsv(records: Record<string, string>[]): string {
  const head = EXPORT_COLUMNS.join(',')
  const body = records.map((r) => EXPORT_COLUMNS.map((c) => csvCell(r[c] ?? '')).join(',')).join('\r\n')
  // Leading BOM so Excel opens UTF-8 (incl. Thai) correctly.
  return `﻿${head}\r\n${body}\r\n`
}

export async function toXlsxBlob(records: Record<string, string>[]): Promise<Blob> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(records, { header: EXPORT_COLUMNS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// Trigger a client-side download of a Blob (or string) — no server involved.
export function download(filename: string, data: Blob | string, mime = 'text/plain'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: `${mime};charset=utf-8` }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
