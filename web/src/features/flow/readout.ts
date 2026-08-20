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

/** One row of the readout: every transaction of this type and category on the
 *  day, combined. A busy day is otherwise ten identical `Expense · Food` lines. */
export interface FlowTxnRef {
  type: TxnType
  category: string
  /** Summed over every transaction of this type+category on the day. */
  amount: number
  /** How many were combined; 1 means a single transaction. */
  count: number
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

  // floor, not round: a day's bars are drawn INSIDE that day (moneyflow.ts packs
  // them across it), so the day an x belongs to is the one it falls in. Rounding
  // put the boundary at the day's midpoint, which meant pointing at a bar in the
  // right-hand half of a day picked the day AFTER it.
  const day = Math.floor(xMs / MS_PER_DAY) * MS_PER_DAY
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

  // NUL-separated so a category containing the separator can't collide with a
  // different type (`Expense` + `A\u0000B` vs `Expense\u0000A` + `B`).
  const byKey = new Map<string, FlowTxnRef>()
  // `flow.bars` is ordered by day (buildFlow sorts it), so the last bar at or
  // before `day` carries the balance and the scan can stop at the first bar past it.
  let balance: number | null = null
  for (const b of flow.bars) {
    const d = dayMs(b.date)
    if (d > day) break
    balance = b.cumAfter
    if (d !== day) continue
    const key = `${b.type}\u0000${b.category}`
    const hit = byKey.get(key)
    if (hit) {
      hit.amount += b.amount
      hit.count += 1
    } else {
      byKey.set(key, { type: b.type, category: b.category, amount: b.amount, count: 1 })
    }
  }

  // Largest first: a combined row no longer corresponds to a single bar, so the
  // left-to-right bar order has stopped meaning anything and the big number is
  // what the reader wants at the top. Map iteration is insertion-ordered and
  // sort is stable, so equal amounts keep first-appearance order.
  const txns = [...byKey.values()].sort((a, b) => b.amount - a.amount)

  return { dateIso: isoOf(day), balance, isForecast: false, band: null, txns }
}

/** UTC midnight of an ISO day, in ms — where that day STARTS on the axis. */
export const flowDayMs = dayMs

/** Centre of a day on the axis. moneyflow.ts packs a day's bars ACROSS the day
 *  (DAY_USABLE, centres landing in [0.05, 0.95] of it), so the midpoint — not
 *  the midnight edge — is where a crosshair for that day belongs. */
export const flowDayCentreMs = (iso: string): number => dayMs(iso) + MS_PER_DAY / 2
