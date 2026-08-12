// The paper-trading sandbox's contract root.
//
// FROZEN. Every module under lib/trading/ imports this and nothing imports back,
// so it is the one file that cannot change once the workstreams are running —
// a field added here after the fan-out invalidates work already in flight.
//
// Zero imports, deliberately: it must never be the thing that creates a cycle.
//
// The behavioural reference for the constants below is the Python app's
// src/analytics/paper.py. Where a number is quoted from there, the line is named
// so the two implementations can be diffed by hand.

/**
 * Milliseconds since the epoch on the SIMULATION clock — never the wall clock.
 *
 * The distinction matters everywhere: the sim can run at 60x, be paused for an
 * hour, or catch up a day in 200ms, so `Date.now()` and a SimTime have no fixed
 * relationship. Nothing under lib/trading/ is allowed to read the wall clock.
 */
export type SimTime = number
/** A price, in the instrument's quote currency. Never rounded for storage. */
export type Px = number
/** A quantity. Signed only on a Position, where <0 means short. */
export type Qty = number

export type Side = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'stop' | 'trailing'
export type OrderStatus = 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired'
export type InstrumentKind = 'spot' | 'perp' | 'option'
export type Right = 'call' | 'put'

export type Timeframe = '1s' | '5s' | '15s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export const TF_MS: Readonly<Record<Timeframe, number>> = {
  '1s': 1_000,
  '5s': 5_000,
  '15s': 15_000,
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
}

/** How many bars of each timeframe a series keeps. Sized so every timeframe holds
 *  a useful span without the memory getting silly: 1m x 4320 is three days. */
export const TF_CAPACITY: Readonly<Record<Timeframe, number>> = {
  '1s': 3600,
  '5s': 2880,
  '15s': 2880,
  '1m': 4320,
  '5m': 2880,
  '15m': 2880,
  '1h': 2160,
  '4h': 1080,
  '1d': 1000,
}

// ── Instruments ──────────────────────────────────────────────────────────────

export interface SpotInstrument {
  kind: 'spot'
  symbol: string
  base: string
  quote: string
  tickSize: Px
  lotSize: Qty
  pricePrecision: number
  qtyPrecision: number
}

export interface PerpInstrument {
  kind: 'perp'
  symbol: string
  underlying: string
  tickSize: Px
  lotSize: Qty
  pricePrecision: number
  qtyPrecision: number
  maxLeverage: number
  fundingIntervalMs: number
}

export interface OptionInstrument {
  kind: 'option'
  symbol: string
  underlying: string
  expiry: SimTime
  right: Right
  strike: Px
  multiplier: number
  tickSize: Px
  pricePrecision: number
}

export type Instrument = SpotInstrument | PerpInstrument | OptionInstrument

// ── Market data ──────────────────────────────────────────────────────────────

/** `n` is the trade count in the bar — the thing that makes a synthetic candle
 *  look real when volume is bucketed by it rather than spread evenly. */
export interface Candle {
  t: SimTime
  o: Px
  h: Px
  l: Px
  c: Px
  v: number
  n: number
}

export interface BookLevel {
  p: Px
  q: Qty
}

/**
 * bids descending, asks ascending.
 *
 * The level arrays are REUSED between reads — the book is rebuilt in place at
 * most every BOOK_REBUILD_MS. Copy anything you intend to keep.
 */
export interface OrderBook {
  t: SimTime
  bids: BookLevel[]
  asks: BookLevel[]
}

export interface Quote {
  t: SimTime
  symbol: string
  last: Px
  bid: Px
  ask: Px
  /**
   * What margin and liquidation are computed against. NEVER `last`.
   *
   * Real exchanges mark against an index precisely so a thin book can't be
   * pushed through someone's liquidation price; copying that is what makes the
   * margin model defensible rather than arbitrary.
   */
  markPrice: Px
  indexPrice: Px
  open24h: Px
  high24h: Px
  low24h: Px
  volume24h: number
}

/**
 * The tick sink takes PRIMITIVES, never a Tick object.
 *
 * At 1000x catch-up the engine emits tens of thousands of ticks per second to
 * several subscribers each; one object per tick per subscriber is tens of
 * thousands of allocations a second, which is the difference between catch-up
 * being invisible and catch-up stuttering.
 *
 * `s` is the aggressor side: 1 = a buy lifted the ask, -1 = a sell hit the bid.
 */
export interface TickSink {
  onTick(t: SimTime, p: Px, q: Qty, s: 1 | -1): void
}

// ── Pinned constants, ported verbatim from src/analytics/paper.py ─────────────

/** paper.py `_apply_fill`: `if abs(new_qty) < 1e-6: positions.pop(sym)`. A residual
 *  this small is float noise from a full close, not a position. */
export const DUST_QTY = 1e-6
/** paper.py `_resolve_trade`: `abs(held) * 1e-5` — the relative half of the snap. */
export const SNAP_REL = 1e-5
/** paper.py `_resolve_trade`: the absolute floor, `1e-3`. */
export const SNAP_ABS = 1e-3
/** paper.py `_check_funds`: `cost > pf["cash"] + 1e-6`. Buying with exactly your
 *  cash must succeed; float error must not turn it into a rejection. */
export const FUNDS_EPS = 1e-6
/** paper.py OPTION_MULT. One contract is 100 of the underlying. */
export const OPTION_MULT = 100
/** paper.py SNAPSHOT_MIN_GAP = 8.0 seconds between equity samples. */
export const SNAPSHOT_MIN_GAP_MS = 8_000
/** paper.py MAX_CURVE. Unlike paper.py we downsample on overflow rather than
 *  truncating the head, so the curve keeps its full time range. */
export const MAX_CURVE = 4000

// ── Simulation timing ────────────────────────────────────────────────────────

/**
 * The simulation quantum. The market clock advances ONLY in whole multiples of
 * this, and the sub-quantum remainder is banked in ClockState.residual.
 *
 * This is the single mechanism that makes replay exact: the number of RNG draws
 * depends solely on how many quanta have elapsed, never on how the elapsed time
 * happened to be sliced into frames. One advanceTo(T) and a thousand ragged
 * calls summing to T draw the same numbers in the same order.
 */
export const TICK_QUANTUM_MS = 250

/**
 * The broker evaluates triggers, funding, expiry and liquidation once per closed
 * sim-second — in live ticking AND in fast-forward catch-up, through the same
 * code path. There is no per-tick order path and no bar-OHLC approximation, so a
 * day caught up in 200ms produces exactly the fills that a day watched live
 * would have.
 */
export const BROKER_STEP_MS = 1_000

/** The book is rebuilt at most this often; reads in between get the same object. */
export const BOOK_REBUILD_MS = 100

/** Catch-up is capped. Past this the sim simply ran slower than the wall clock —
 *  sim time is DEFINED as how far the engine has been advanced, so there is no
 *  gap to record and determinism is untouched. */
export const MAX_CATCHUP_SIM_MS = 24 * 3_600_000
