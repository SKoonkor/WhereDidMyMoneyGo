// What the hold-to-inspect readout shows for a given x position.
//
// Snaps to the nearest DAY: the bars are day-wide, so the day is the natural
// magnet (the data-space counterpart of the trading crosshair's 12px snap to the
// close). Returns raw numbers only — formatting, translation and censor masking
// are the caller's, which is what keeps this unit-testable without a DOM.
import type { FlowData } from '../../lib/analytics/moneyflow'
import type { Forecast } from '../../lib/analytics/forecast'
import type { TxnType } from '../../db'

const MS_PER_DAY = 86_400_000
const dayMs = (iso: string): number => new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime()
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export interface FlowTxnRef {
  type: TxnType
  account: string
  category: string
  amount: number
}

export interface FlowPoint {
  dateIso: string
  /** Balance at the end of that day, or the forecast median on a forecast day. */
  balance: number | null
  isForecast: boolean
  /** The inner (50%) forecast band on a forecast day; null on real days. */
  band: { lo: number; hi: number } | null
  txns: FlowTxnRef[]
}

export function pickFlowPoint(flow: FlowData, fc: Forecast | null, xMs: number): FlowPoint | null {
  if (flow.bars.length === 0) return null

  const day = Math.round(xMs / MS_PER_DAY) * MS_PER_DAY
  const fcEnd = fc ? dayMs(fc.dates[fc.dates.length - 1]) : flow.lastDay
  if (day < flow.firstDay || day > Math.max(flow.lastDay, fcEnd)) return null

  // Past the ledger and inside the projection: this is a forecast day.
  if (fc && day > flow.lastDay) {
    const i = Math.round((day - dayMs(fc.anchorDate)) / MS_PER_DAY)
    if (i >= 0 && i < fc.dates.length) {
      return {
        dateIso: fc.dates[i],
        balance: fc.median[i],
        isForecast: true,
        band: { lo: fc.lo50[i], hi: fc.hi50[i] },
        txns: [],
      }
    }
  }

  const txns: FlowTxnRef[] = []
  // `flow.bars` is ordered by day (buildFlow sorts it), so the last bar at or
  // before `day` carries the balance and the scan can stop at the first bar past it.
  let balance: number | null = null
  for (const b of flow.bars) {
    const d = dayMs(b.date)
    if (d > day) break
    balance = b.cumAfter
    if (d === day) txns.push({ type: b.type, account: b.account, category: b.category, amount: b.amount })
  }

  return { dateIso: isoOf(day), balance, isForecast: false, band: null, txns }
}

/** UTC midnight of an ISO day, in ms — the x position of that day's bars. */
export const flowDayMs = dayMs
