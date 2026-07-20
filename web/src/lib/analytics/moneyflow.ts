// Money-flow waterfall data prep — a browser port of the data half of
// src/app/figures/money_flow.py. Turns the ledger into a cumulative
// running-balance series where every transaction is one bar: income (and
// Transfer-/Adjustment-In) bars rise from the previous level, expenses drop.
// Within a day the bars are packed left→right, each one's width proportional to
// its share of that day's total amount, so a busy day reads as a cluster.
//
// Pure and testable; the Plotly spec lives in features/flow/figure.ts.
import type { Txn, TxnType } from '../../db'

// Signed contribution to the running balance (matches money_flow.py `_SIGN` —
// note "Saving" is intentionally absent; saving is modelled as a Transfer).
const SIGN: Partial<Record<TxnType, number>> = {
  Income: 1,
  'Transfer-In': 1,
  'Adjustment-In': 1,
  Expense: -1,
  'Transfer-Out': -1,
  'Adjustment-Out': -1,
}
const INCOME_LIKE = new Set<TxnType>(['Income', 'Transfer-In', 'Adjustment-In'])
const ADJUSTMENT = new Set<TxnType>(['Adjustment-In', 'Adjustment-Out'])

const MS_PER_DAY = 86_400_000
const DAY_USABLE = 0.9 // fraction of a day the bars occupy (leaves gaps between days)
const DAY_PAD = (1 - DAY_USABLE) / 2

// UTC midnight for a YYYY-MM-DD, so day keys round-trip through toISOString
// regardless of the viewer's timezone (Plotly reads numeric x as ms since the
// UTC epoch on a date axis, so this is also the right position unit).
const dayMs = (iso: string): number => new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime()

export interface FlowBar {
  account: string
  x: number // bar centre, ms epoch
  widthMs: number
  base: number // lower edge of the bar
  height: number // |signed amount|
  incomeLike: boolean
  cumAfter: number
  type: TxnType
  amount: number
  category: string
  date: string // ISO day, for the hover
}

export interface FlowData {
  bars: FlowBar[]
  accounts: string[] // sorted unique account names
  connectors: { x: Array<number | null>; y: Array<number | null> } // dashed bridges over empty days
  latestBalances: Record<string, number>
  netWorth: number
  hidden: number // net of Adjustment legs (recorded hidden cost)
  firstDay: number // ms epoch of the first transaction day
  lastDay: number // ms epoch of the last transaction day
  months: Array<{ start: number; shaded: boolean }> // month bands, alternating
}

export const EMPTY_FLOW: FlowData = {
  bars: [], accounts: [], connectors: { x: [], y: [] }, latestBalances: {},
  netWorth: 0, hidden: 0, firstDay: 0, lastDay: 0, months: [],
}

// Build the whole waterfall over the full ledger (the cumulative never restarts,
// so a zoomed window still shows the true balance). `forecastEnd` (ms epoch)
// extends the month bands to cover a drawn forecast.
export function buildFlow(txns: Txn[], forecastEnd?: number): FlowData {
  const rows = txns.filter((t) => t.type in SIGN)
  if (rows.length === 0) return EMPTY_FLOW

  // Stable order: by day, then by id (insertion order) as the intra-day tiebreak
  // — the web ledger stores a date only, not a time-of-day.
  const sorted = [...rows].sort((a, b) => dayMs(a.period) - dayMs(b.period) || a.id - b.id)

  // Cumulative pass.
  const enriched = sorted.map((t) => {
    const signed = (SIGN[t.type] as number) * t.amount
    return { t, signed }
  })
  let cum = 0
  const withCum = enriched.map(({ t, signed }) => {
    const cumBefore = cum
    cum += signed
    return { t, signed, cumBefore, cumAfter: cum }
  })

  // Group by day for bar packing.
  const byDay = new Map<string, typeof withCum>()
  for (const r of withCum) {
    const d = r.t.period.slice(0, 10)
    const g = byDay.get(d)
    if (g) g.push(r)
    else byDay.set(d, [r])
  }

  const bars: FlowBar[] = []
  for (const [d, grp] of byDay) {
    const base = dayMs(d)
    const total = grp.reduce((s, r) => s + r.t.amount, 0)
    let offset = DAY_PAD // day units
    for (const r of grp) {
      const frac = total > 0 ? r.t.amount / total : 1 / grp.length
      const w = DAY_USABLE * frac
      const centre = offset + w / 2
      offset += w
      bars.push({
        account: r.t.account,
        x: base + centre * MS_PER_DAY,
        widthMs: w * MS_PER_DAY,
        base: Math.min(r.cumBefore, r.cumAfter),
        height: Math.abs(r.signed),
        incomeLike: INCOME_LIKE.has(r.t.type),
        cumAfter: r.cumAfter,
        type: r.t.type,
        amount: r.t.amount,
        category: r.t.category,
        date: d,
      })
    }
  }

  // Dashed connectors across days with no activity, at the carried balance.
  const dayKeys = [...byDay.keys()].sort()
  const firstDay = dayMs(dayKeys[0])
  const lastDay = dayMs(dayKeys[dayKeys.length - 1])
  const endLevel = new Map<string, number>()
  for (const [d, grp] of byDay) endLevel.set(d, grp[grp.length - 1].cumAfter)

  const cx: Array<number | null> = []
  const cy: Array<number | null> = []
  let carried = 0
  for (let ms = firstDay; ms <= lastDay; ms += MS_PER_DAY) {
    const key = new Date(ms).toISOString().slice(0, 10)
    if (byDay.has(key)) {
      carried = endLevel.get(key) as number
    } else {
      cx.push(ms, ms + MS_PER_DAY, null)
      cy.push(carried, carried, null)
    }
  }

  // Latest balance per account + net worth + recorded hidden cost.
  const latestBalances: Record<string, number> = {}
  for (const r of withCum) {
    latestBalances[r.t.account] = (latestBalances[r.t.account] ?? 0) + r.signed
  }
  const netWorth = withCum[withCum.length - 1].cumAfter
  const hidden = withCum.reduce((s, r) => (ADJUSTMENT.has(r.t.type) ? s + r.signed : s), 0)

  // Alternating month bands across the data (and any forecast tail).
  const bandEnd = Math.max(lastDay, forecastEnd ?? lastDay)
  const months = monthStarts(firstDay, bandEnd).map((start, i) => ({ start, shaded: i % 2 === 1 }))

  return {
    bars,
    accounts: [...new Set(rows.map((t) => t.account))].sort(),
    connectors: { x: cx, y: cy },
    latestBalances,
    netWorth,
    hidden,
    firstDay,
    lastDay,
    months,
  }
}

// Month-start epochs (UTC) from the month containing `fromMs` through the one
// containing `toMs`, inclusive.
function monthStarts(fromMs: number, toMs: number): number[] {
  const out: number[] = []
  const d = new Date(fromMs)
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  while (d.getTime() <= toMs) {
    out.push(d.getTime())
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return out
}
