// Read-only views of the ledger — the numbers the UI puts on screen.
//
// Port of src/analytics/paper.py's `positions_rows`, `summary`, `_snapshot` and
// `principal_series`, plus the drawdown and win-rate statistics paper.py computed
// inline in the page callbacks.
//
// Nothing here mutates an account. That is not tidiness: the position table
// re-renders on every tick, and a valuation function with a side effect would
// make the account depend on how often the screen happened to repaint.
import { MAX_CURVE, SNAPSHOT_MIN_GAP_MS, type InstrumentKind, type Px, type Qty, type SimTime } from '../types'
import { instrumentLabel } from './fills'
import { liquidationPrice, marginSummary, markOf, DEFAULT_TIERS, type MarginSummary, type MarginTier } from './margin'
import { instMult, type BrokerAccount, type MarketView, type Position, type PositionGreeks, type Trade } from './types'

// ── Positions ────────────────────────────────────────────────────────────────

export interface PositionRow {
  symbol: string
  label: string
  kind: InstrumentKind
  qty: Qty
  avgCost: Px
  price: Px
  value: number
  cost: number
  unreal: number
  unrealPct: number
  leverage?: number
  liqPrice?: Px | null
  margin?: number
  fundingPaid?: number
  greeks?: PositionGreeks
}

/**
 * Port of paper.py `positions_rows`, sorted by −|value| then label: the biggest
 * exposure first, and a stable tie-break so a repaint never reorders the table
 * under the user's thumb.
 *
 * Greeks arrive through `greeks`, injected by the caller. broker/ must not import
 * options/ — the two are built in parallel, and an import would make one
 * workstream's compile failure the other's — so the pricer is passed in and this
 * file never names it.
 */
export function positionRows(
  a: BrokerAccount,
  m: MarketView,
  greeks?: (pos: Position, m: MarketView) => PositionGreeks | undefined,
  tiers: readonly MarginTier[] = DEFAULT_TIERS,
): PositionRow[] {
  const rows: PositionRow[] = []
  for (const pos of Object.values(a.positions)) {
    const mult = instMult(pos)
    const price = markOf(m, pos)
    const value = pos.qty * price * mult
    const cost = pos.qty * pos.avgCost * mult
    const unreal = value - cost
    const row: PositionRow = {
      symbol: pos.symbol,
      label: instrumentLabel(pos),
      kind: pos.kind,
      qty: pos.qty,
      avgCost: pos.avgCost,
      price,
      value,
      cost,
      unreal,
      // Against |cost|, so a short that gains reads as a gain. Dividing by the
      // signed cost would invert the percentage on every short position.
      unrealPct: Math.abs(cost) > 1e-9 ? (unreal / Math.abs(cost)) * 100 : 0,
    }
    if (pos.kind === 'perp') {
      row.leverage = pos.leverage
      row.margin = pos.margin
      row.fundingPaid = pos.fundingPaid
      row.liqPrice = liquidationPrice(pos, a.settings, tiers)
    }
    if (greeks) {
      const g = greeks(pos, m)
      if (g) row.greeks = g
    }
    rows.push(row)
  }
  rows.sort((x, y) => Math.abs(y.value) - Math.abs(x.value) || x.label.localeCompare(y.label))
  return rows
}

// ── Account summary ──────────────────────────────────────────────────────────

export interface AccountSummary {
  equity: number
  cash: number
  invested: number
  dayChange: number
  dayPct: number
  totalChange: number
  totalPct: number
  realized: number
  unrealized: number
  margin: MarginSummary
}

/**
 * Port of paper.py `summary` (958+).
 *
 * Total P/L is measured against `contributed`, never against `startCash`: a
 * deposit raises both cash and contributed, so moving money in is flat here
 * instead of reading as a windfall gain. That single choice is why the headline
 * number on the account page can be trusted.
 *
 * Day change is `Σ qty · (mark − open24h)`, which is the Quote's own 24h open —
 * paper.py used a stock's previous close, and the sandbox trades round the clock,
 * so there is no "previous close" to use.
 */
export function summarize(
  a: BrokerAccount,
  m: MarketView,
  tiers: readonly MarginTier[] = DEFAULT_TIERS,
): AccountSummary {
  const margin = marginSummary(a, m, tiers)
  let invested = 0
  let dayChange = 0
  for (const pos of Object.values(a.positions)) {
    const price = markOf(m, pos)
    invested += pos.qty * price * instMult(pos)
    const q = m.quote(pos.symbol)
    // Options are excluded, as in paper.py: a contract's 24h open is the option's
    // own price, and mixing that into an equity day-change reads as noise.
    if (q && q.open24h && pos.kind !== 'option') {
      dayChange += pos.qty * (price - q.open24h) * instMult(pos)
    }
  }

  const equity = margin.equity
  const basis = a.contributed
  const totalChange = equity - basis
  const prior = equity - dayChange
  return {
    equity,
    cash: a.cash,
    invested,
    dayChange,
    dayPct: prior !== 0 ? (dayChange / prior) * 100 : 0,
    totalChange,
    totalPct: basis > 0 ? (totalChange / basis) * 100 : 0,
    realized: a.realized,
    // By construction, not by a second sum: whatever total change is not booked
    // is still open. Computing it independently lets the two disagree, and a
    // blotter that does not add up to the headline is worse than no blotter.
    unrealized: totalChange - a.realized,
    margin,
  }
}

// ── Equity curve ─────────────────────────────────────────────────────────────

export interface EquityPoint {
  t: SimTime
  v: number
}

/**
 * Throttled append with a MAX_CURVE cap. Returns whether the point was kept.
 *
 * Unlike paper.py's `del curve[:n]`, overflow DOWNSAMPLES 2:1 rather than
 * dropping the head. paper.py's version silently discards the beginning of the
 * account's history, so a long-running account's chart starts at an arbitrary
 * Tuesday; halving the resolution keeps the full time range, which is the axis
 * the user actually reads.
 */
export function pushEquity(curve: EquityPoint[], p: EquityPoint, force: boolean): boolean {
  const last = curve[curve.length - 1]
  if (!force && last && p.t - last.t < SNAPSHOT_MIN_GAP_MS) return false
  curve.push(p)
  if (curve.length > MAX_CURVE) {
    // Keep every other point, and always the newest — the right-hand edge is
    // where the eye is, and losing it would make the curve lag the headline.
    const kept: EquityPoint[] = []
    for (let i = curve.length - 1; i >= 0; i -= 2) kept.push(curve[i])
    kept.reverse()
    curve.length = 0
    for (const q of kept) curve.push(q)
  }
  return true
}

/**
 * Port of paper.py `principal_series` (983+): net contributed capital as a step
 * line on the equity curve's own timestamps, so the chart can draw "money put in"
 * beneath the equity line and the gap between them IS the P/L.
 *
 * One merge pass over two sorted lists rather than paper.py's
 * `sum(... for ts, a in events if ts <= t)` inside a comprehension over every
 * point — that is O(points × cashflows), and at MAX_CURVE = 4000 points it is
 * enough work to be visible on a phone.
 */
export function principalSeries(curve: EquityPoint[], trades: Trade[], startCash: number): number[] {
  const flows = trades
    .filter((t) => t.side === 'deposit' || t.side === 'withdraw')
    .map((t) => ({ t: t.t, amount: t.side === 'deposit' ? Math.abs(t.value) : -Math.abs(t.value) }))
    .sort((x, y) => x.t - y.t)

  const out: number[] = []
  let running = startCash
  let i = 0
  for (const p of curve) {
    while (i < flows.length && flows[i].t <= p.t) {
      running += flows[i].amount
      i++
    }
    out.push(running)
  }
  return out
}

/** Peak-to-trough of the equity curve. `maxDd` is positive money lost from the
 *  high-water mark; `peak` is the high-water mark it was measured from. */
export function drawdown(curve: EquityPoint[]): { maxDd: number; maxDdPct: number; peak: number } {
  let peak = -Infinity
  let maxDd = 0
  let maxDdPct = 0
  let peakAtWorst = 0
  for (const p of curve) {
    if (p.v > peak) peak = p.v
    const dd = peak - p.v
    if (dd > maxDd) {
      maxDd = dd
      peakAtWorst = peak
      maxDdPct = peak > 0 ? (dd / peak) * 100 : 0
    }
  }
  return { maxDd, maxDdPct, peak: Number.isFinite(peak) ? (maxDd > 0 ? peakAtWorst : peak) : 0 }
}

/**
 * Win/loss statistics over CLOSING trades.
 *
 * Only rows that booked realized P/L count. An opening buy has realized 0 and is
 * neither a win nor a loss; counting it as a loss — which a naive `realized <= 0`
 * filter does — halves the win rate of anyone who holds anything.
 */
export function stats(trades: Trade[]): {
  wins: number
  losses: number
  winRate: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  expectancy: number
} {
  let wins = 0
  let losses = 0
  let grossWin = 0
  let grossLoss = 0
  for (const t of trades) {
    if (t.realized > 0) {
      wins++
      grossWin += t.realized
    } else if (t.realized < 0) {
      losses++
      grossLoss += -t.realized
    }
  }
  const n = wins + losses
  return {
    wins,
    losses,
    winRate: n > 0 ? (wins / n) * 100 : 0,
    avgWin: wins > 0 ? grossWin / wins : 0,
    avgLoss: losses > 0 ? grossLoss / losses : 0,
    // Infinity for a run with no losses at all is the honest answer and reads
    // correctly in the UI; 0 would say the opposite of what happened.
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins > 0 ? Infinity : 0,
    expectancy: n > 0 ? (grossWin - grossLoss) / n : 0,
  }
}
