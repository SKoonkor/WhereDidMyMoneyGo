// Fill arithmetic — the exact port of src/analytics/paper.py's order primitives.
//
// This file is deliberately the dullest in the tree. Every rule in it was arrived
// at by watching the Python app get something wrong: dust positions that could not
// be closed, micro-shorts created by a $-mode sell, a short whose P/L came out
// inverted. The thirteen tests in fills.test.ts are the same thirteen that guard
// paper.py, and they are the specification — not the comments.
//
// The paper.py function each export mirrors is named on the export, so the two
// implementations can be diffed by hand when either changes.
import {
  DUST_QTY,
  FUNDS_EPS,
  SNAP_ABS,
  SNAP_REL,
  type Instrument,
  type InstrumentKind,
  type Px,
  type Qty,
  type Side,
  type SimTime,
} from '../types'
import {
  instMult,
  tradeError,
  type BrokerAccount,
  type Order,
  type Position,
  type TradeError,
} from './types'

export interface FillResult {
  realized: number
  /** null = the fill closed the position to dust and it was removed. */
  position: Position | null
  /**
   * The cash the TRADE moves, fee excluded.
   *
   * The caller applies `cash += cashDelta - fee`. Splitting them is what keeps
   * `realized` honest: a fee is a cost of trading, not a trading result, and
   * folding it into realized would quietly corrupt the win-rate statistics.
   */
  cashDelta: number
  fee: number
}

/**
 * Port of paper.py `_apply_fill` (lines 549–589).
 *
 * Reproduces, precisely:
 *   cash -= signed * price * mult        buy pays, sell receives
 *   same-sign / flat -> weighted average over ABSOLUTE quantities
 *   opposite sign    -> realized = closed * (price - avgCost) * sign(oldQty) * mult
 *   flip             -> the remainder's basis RESETS to `price`, never a blend
 *   |newQty| < DUST_QTY -> the position is removed entirely
 *
 * Pure: it neither reads nor writes the account. The engine applies the result,
 * because a perp's cash moves by realized rather than by notional and only the
 * engine knows which of those two worlds it is in.
 */
export function applyFill(
  pos: Position | null,
  meta: Instrument,
  side: Side,
  qty: Qty,
  price: Px,
  fee: number,
  now?: SimTime,
): FillResult {
  const mult = instMult(meta)
  const signed = side === 'buy' ? qty : -qty
  const cashDelta = -(signed * price * mult)

  const oldQty = pos ? pos.qty : 0
  const oldAvg = pos ? pos.avgCost : 0
  const newQty = oldQty + signed
  let realized = 0
  let newAvg: number

  if (!pos || oldQty === 0 || oldQty > 0 === signed > 0) {
    // Opening or increasing on the same side -> weighted-average cost.
    //
    // Over ABSOLUTE quantities, so a short's basis stays positive. The 1e-12
    // guard is paper.py's: an exactly-cancelling pair would divide by zero, and
    // the position is about to be dropped as dust anyway.
    newAvg =
      Math.abs(newQty) > 1e-12
        ? (Math.abs(oldQty) * oldAvg + Math.abs(signed) * price) / Math.abs(newQty)
        : price
  } else {
    // Reducing / closing / flipping -> book realized on the quantity closed.
    const closed = Math.min(Math.abs(signed), Math.abs(oldQty))
    realized = closed * (price - oldAvg) * (oldQty > 0 ? 1 : -1) * mult
    // A flip (sell 150 while long 100) books P/L on the 100 closed and the
    // remaining -50 starts fresh at `price`. Blending the old long's basis into
    // the new short would carry the closed trade's cost into the open one.
    newAvg = Math.abs(signed) <= Math.abs(oldQty) ? oldAvg : price
  }

  if (Math.abs(newQty) < DUST_QTY) {
    // A residual this small is float noise from a full close, not a position.
    return { realized, position: null, cashDelta, fee }
  }

  const next: Position = {
    symbol: meta.symbol,
    kind: meta.kind,
    qty: newQty,
    avgCost: newAvg,
    mark: price,
    openedAt: pos ? pos.openedAt : (now ?? 0),
  }
  if (meta.kind === 'option') {
    next.underlying = meta.underlying
    next.expiry = meta.expiry
    next.right = meta.right
    next.strike = meta.strike
    next.multiplier = meta.multiplier
  } else if (meta.kind === 'perp') {
    next.underlying = meta.underlying
  }
  // Broker-managed bookkeeping survives a fill; paper.py had none of it, and
  // dropping it here would reset a perp's funding history on every add.
  if (pos) {
    if (pos.leverage !== undefined) next.leverage = pos.leverage
    if (pos.margin !== undefined) next.margin = pos.margin
    if (pos.fundingPaid !== undefined) next.fundingPaid = pos.fundingPaid
    if (pos.optionMargin !== undefined) next.optionMargin = pos.optionMargin
  }
  return { realized, position: next, cashDelta, fee }
}

/**
 * Port of paper.py `_check_funds` (lines 531–546). Returns an error rather than
 * throwing one, so the caller decides whether it cancels an order or rejects a tap.
 *
 * Cash-account rules: a buy needs the full notional; a sell BEYOND an existing
 * long opens or extends a short, and only that part needs collateral.
 *
 * Perps are exempt on purpose — they are collateralised by reserved margin, not
 * by notional cash, and that check lives in margin.ts where the tier ladder is.
 * Running the cash rule over them would reject every leveraged order.
 */
export function checkFunds(
  acct: BrokerAccount,
  meta: Instrument,
  side: Side,
  qty: Qty,
  price: Px,
): TradeError | null {
  if (meta.kind === 'perp') return null
  const mult = instMult(meta)
  const pos = acct.positions[meta.symbol]
  const held = pos ? pos.qty : 0 // signed (+long / −short)

  if (side === 'buy') {
    const cost = qty * price * mult
    // The epsilon is paper.py's: spending exactly your cash must succeed, and
    // float error on a $-mode quantity must not turn that into a rejection.
    if (cost > acct.cash + FUNDS_EPS) {
      return tradeError('insufficient-funds', { need: cost, have: acct.cash })
    }
    return null
  }
  const shortOpen = Math.max(0, qty - Math.max(held, 0))
  const need = shortOpen * price * mult
  if (need > acct.cash + FUNDS_EPS) {
    return tradeError('insufficient-collateral', { need, have: acct.cash })
  }
  return null
}

/**
 * Port of the dust snap in paper.py `_resolve_trade` (lines 647–654).
 *
 * A REDUCING order within `max(|held| * SNAP_REL, SNAP_ABS)` of the whole position
 * becomes an exact close. A $-mode buy leaves holdings like 12280.282631694204; the
 * user then types the number the screen showed them, and without this the sell
 * leaves an unclosable crumb — or worse, tips into an accidental micro-short.
 *
 * Never applied when opening or increasing: a fresh 5-share short is exactly that,
 * and snapping it to `|held|` = 0 would silently drop the order.
 */
export function snapQty(held: Qty, side: Side, qty: Qty): Qty {
  const reducing = (side === 'sell' && held > 0) || (side === 'buy' && held < 0)
  if (!reducing) return qty
  const tol = Math.max(Math.abs(held) * SNAP_REL, SNAP_ABS)
  return Math.abs(qty - Math.abs(held)) <= tol ? Math.abs(held) : qty
}

/**
 * Port of paper.py `_qty_from_spec` (lines 612–630).
 *
 * Whole contracts for options (a multiplier other than 1 marks a contract), fully
 * fractional for tickers; $-mode divides by `price * mult` and then applies the
 * same rule. Truncation, never rounding — rounding a $-mode option order UP buys
 * more than the user said they wanted to spend.
 */
export function qtyFromSpec(
  spec: { mode: 'shares' | 'dollars'; qty: number },
  price: Px,
  mult: number,
): { qty: Qty } | { error: TradeError } {
  const raw = Number(spec.qty)
  if (!Number.isFinite(raw)) {
    return { error: tradeError(spec.mode === 'dollars' ? 'bad-amount' : 'bad-qty') }
  }
  if (raw <= 0) {
    return { error: tradeError(spec.mode === 'dollars' ? 'bad-amount' : 'bad-qty') }
  }
  if (spec.mode === 'dollars') {
    if (!(price > 0)) return { error: tradeError('no-quote') }
    const n = raw / (price * mult)
    return { qty: mult !== 1 ? Math.trunc(n) : n }
  }
  return { qty: mult !== 1 ? Math.trunc(raw) : raw }
}

/**
 * Port of paper.py `_triggered` (lines 786–802).
 *
 * MUTATES `o.peak`. That is pinned behaviour, not an oversight: the trailing stop
 * ratchets on every price the order observes, including the ones that do not
 * trigger it, and paper.py's `process()` even records "changed" for exactly that
 * reason. Making this pure would break the trail — the peak has to persist between
 * evaluations for the stop to trail anything.
 */
export function triggered(o: Order, price: Px): boolean {
  if (o.type === 'market') return true // queued while closed — fills on the bell
  if (o.type === 'limit') {
    if (o.limit === undefined) return false
    return o.side === 'buy' ? price <= o.limit : price >= o.limit
  }
  if (o.type === 'stop') {
    if (o.stop === undefined) return false
    return o.side === 'buy' ? price >= o.stop : price <= o.stop
  }
  if (o.type === 'trailing') {
    if (!o.trail) return false
    const trail = o.trail / 100
    if (o.side === 'sell') {
      // Ratchet the peak UP, trigger on the drop away from it.
      o.peak = Math.max(o.peak || price, price)
      return price <= o.peak * (1 - trail)
    }
    // Buy side: ratchet the trough DOWN, trigger on the bounce.
    o.peak = Math.min(o.peak || price, price)
    return price >= o.peak * (1 + trail)
  }
  return false
}

// ── Naming ───────────────────────────────────────────────────────────────────

/** Port of paper.py `option_symbol`: a stable key for one contract, e.g.
 *  `BTC|2026-08-14|call|65000`. The date is UTC so the key never depends on where
 *  the device is. */
export function optionSymbol(underlying: string, expiry: SimTime, right: string, strike: Px): string {
  return `${underlying.toUpperCase()}|${isoDate(expiry)}|${right}|${trimNum(strike)}`
}

/** Port of paper.py `instrument_label`, e.g. `AAPL 2026-07-06 C302.5`. */
export function instrumentLabel(m: Instrument | Position): string {
  if (m.kind === 'option' && m.expiry !== undefined && m.right && m.strike !== undefined) {
    const r = m.right === 'call' ? 'C' : 'P'
    const under = ('underlying' in m && m.underlying) || m.symbol
    return `${under} ${isoDate(m.expiry)} ${r}${trimNum(m.strike)}`
  }
  return m.symbol
}

/** `%g`-ish: no trailing zeros, which is what paper.py's `:g` produced. */
function trimNum(n: number): string {
  return String(Number(n))
}

function isoDate(t: SimTime): string {
  // `new Date(t)` with an explicit argument is arithmetic on a number we were
  // handed, not a read of the wall clock — purity.test.ts bans `new Date()` and
  // `Date.now()`, and this is neither.
  const d = new Date(t)
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${m}-${day}`
}

// ── Market hours ─────────────────────────────────────────────────────────────

/**
 * Port of paper.py `market_open_now` (lines 78–107), rebuilt on a SimTime.
 *
 * paper.py asked `datetime.now(ZoneInfo("America/New_York"))`; we cannot — the sim
 * clock is the only clock, and reading the wall one would make a market that is
 * open at 60x speed but closed at 1x. The caller passes the instant.
 *
 * The US Eastern offset is computed from the DST rule rather than from Intl: the
 * result has to be identical in a browser, in jsdom and in a headless CI box with
 * no ICU data, because a fill that only happens on some machines is not a fill.
 */
export function marketOpenNow(kind: InstrumentKind | undefined, symbol: string, now: SimTime): boolean {
  if (isAlwaysOpen(kind, symbol)) return true

  const et = new Date(now + etOffsetMinutes(now) * 60_000)
  const dow = et.getUTCDay()
  if (dow === 0 || dow === 6) return false

  const mm = String(et.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(et.getUTCDate()).padStart(2, '0')
  if (NYSE_HOLIDAYS.has(`${et.getUTCFullYear()}-${mm}-${dd}`)) return false

  const minutes = et.getUTCHours() * 60 + et.getUTCMinutes()
  return minutes >= 570 && minutes < 960 // 09:30 inclusive – 16:00 exclusive
}

/**
 * The trading day an instant belongs to, as an Eastern calendar date.
 *
 * What a `day` order's lifetime is measured in. Deliberately NOT the UTC date: a
 * day order placed at 15:00 ET on Monday is 20:00 UTC, and a UTC key would expire
 * it four hours later at the Monday-evening rollover instead of at Tuesday's
 * close — cancelling a live order in the middle of the session.
 */
export function sessionDay(t: SimTime): string {
  const et = new Date(t + etOffsetMinutes(t) * 60_000)
  const m = String(et.getUTCMonth() + 1).padStart(2, '0')
  const d = String(et.getUTCDate()).padStart(2, '0')
  return `${et.getUTCFullYear()}-${m}-${d}`
}

/** paper.py's `kind == "crypto" or symbol.endswith("-USD")`, widened to the kinds
 *  this app actually has. A perp is a crypto instrument by construction. */
function isAlwaysOpen(kind: InstrumentKind | undefined, symbol: string): boolean {
  if (kind === 'perp') return true
  const s = (symbol || '').toUpperCase()
  return s.endsWith('-USD') || s.endsWith('USDT') || s.endsWith('USDC')
}

/** NYSE full-day holidays. Static list — refresh once a year, as paper.py's is. */
const NYSE_HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
])

/** −240 during EDT, −300 during EST. US DST: 02:00 local on the second Sunday of
 *  March through 02:00 local on the first Sunday of November. */
function etOffsetMinutes(t: SimTime): number {
  const year = new Date(t).getUTCFullYear()
  const start = Date.UTC(year, 2, nthWeekday(year, 2, 0, 2), 7) // 07:00Z = 02:00 EST
  const end = Date.UTC(year, 10, nthWeekday(year, 10, 0, 1), 6) // 06:00Z = 02:00 EDT
  return t >= start && t < end ? -240 : -300
}

/** Day-of-month of the `n`-th `weekday` (0 = Sunday) in a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
}
