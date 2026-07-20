// Read an uploaded .csv / .xlsx into { headers, records } of string cells, using
// SheetJS (replaces openpyxl/pandas.read_* from importer.py::read_table). All
// parsing happens in the browser — the file never leaves the device.
import * as XLSX from 'xlsx'
import type { Record_ } from './parse'

export interface Table {
  headers: string[]
  records: Record_[]
}

function isCsv(file: File): boolean {
  return /\.csv$/i.test(file.name) || file.type === 'text/csv'
}

export async function readTable(file: File): Promise<Table> {
  const buf = await file.arrayBuffer()
  // CSV: decode the bytes as UTF-8 ourselves (TextDecoder strips a BOM and is
  // the encoding modern money-app exports use, incl. Thai). We avoid SheetJS's
  // `codepage` path, which needs codepage tables we don't bundle and mis-reads
  // non-ASCII CSVs without them. XLSX/XLS: read the binary workbook directly.
  const wb = isCsv(file)
    ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', raw: false })
    : XLSX.read(buf, { type: 'array', raw: false, cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { headers: [], records: [] }
  const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })
  if (!grid.length) return { headers: [], records: [] }

  const headers = (grid[0] as unknown[]).map((h) => String(h ?? '').trim())
  const records: Record_[] = []
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i] as unknown[]
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue
    const rec: Record_ = {}
    headers.forEach((h, j) => { if (h) rec[h] = String(row[j] ?? '') })
    records.push(rec)
  }
  return { headers, records }
}
