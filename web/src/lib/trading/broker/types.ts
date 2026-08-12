// The broker's data model — the ledger the whole sandbox is written against.
//
// This is the TypeScript half of src/analytics/paper.py's account dict. Where a
// field exists because paper.py had one, the Python name is given so the two can
// be diffed by hand; where it exists because the web app grew perps, options and
// margin that paper.py never had, that is called out too.
//
// Nothing here imports anything but the frozen contract root, deliberately: the
// broker is a pure function of (account, market view) and must stay unit-testable
// with a twenty-line fake world.
import type {
  InstrumentKind,
  Instrument,
  OrderStatus,
  OrderType,
  Px,
  Qty,
  Quote,
  Right,
  Side,
  SimTime,
} from '../types'
import { OPTION_MULT } from '../types'

// ── Positions, orders, blotter ───────────────────────────────────────────────

export interface Position {
  symbol: string
  kind: InstrumentKind
  /** Signed: >0 long, <0 short. paper.py `pos["qty"]`. */
  qty: Qty
  /**
   * ALWAYS positive, even for a short.
   *
   * paper.py averages over `abs(old_qty)`, so a short carries a positive basis and
   * the realized formula flips sign by `sign(old_qty)` instead. Storing a negative
   * basis for shorts would double the sign flip and silently invert every short's
   * P/L — the exact bug this comment exists to prevent.
   */
  avgCost: Px
  mark: Px
  openedAt: SimTime

  /** Perp: the leverage the position was opened at. */
  leverage?: number
  /** Perp: collateral RESERVED against this position. Not removed from `cash` —
   *  see marginSummary() for why that is the only self-consistent choice. */
  margin?: number
  /** Perp: cumulative funding paid out (+) or received (−). Already out of cash. */
  fundingPaid?: number

  /** Option contract terms, carried so a position can be valued and settled
   *  without a second lookup. */
  expiry?: SimTime
  right?: Right
  strike?: Px
  multiplier?: number
  underlying?: string
  /** Short options: the CBOE-rule margin reserved at open, released on close. */
  optionMargin?: number
}

export interface Order {
  id: string
  /** The account's running sequence — what the user sees and sorts by. */
  seq: number
  accountId: string
  symbol: string
  kind: InstrumentKind
  side: Side
  type: OrderType
  qty: Qty
  status: OrderStatus
  createdAt: SimTime

  limit?: Px
  stop?: Px
  /** PERCENT, exactly as paper.py stores it (`o["trail"] / 100.0` at use). */
  trail?: number
  /** The trailing high-water (sell) or low-water (buy) mark. MUTATED by
   *  triggered() on every observed price — see fills.ts. */
  peak?: Px

  reduceOnly?: boolean
  leverage?: number
  tif: 'gtc' | 'ioc' | 'day'

  fillPrice?: Px
  filledAt?: SimTime
  /** Machine code, never prose: the UI translates it. paper.py stored English. */
  note?: string

  /** Option terms, mirrored from the instrument so a queued order survives a
   *  reload without needing the chain rebuilt. */
  expiry?: SimTime
  right?: Right
  strike?: Px
  underlying?: string
}

export interface Trade {
  id: string
  t: SimTime
  accountId: string
  symbol: string
  label: string
  kind: InstrumentKind
  /** Cash movements and system events share the blotter with real fills so the
   *  ledger explains every change to `cash` on its own. */
  side: Side | 'deposit' | 'withdraw' | 'funding' | 'liquidation' | 'settlement'
  qty: Qty | null
  price: Px | null
  /** Notional for a fill; the amount moved for a cash row. */
  value: number
  fee: number
  realized: number
  /** Machine code or free text set by the engine; never user-facing prose. */
  note: string
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface BrokerSettings {
  takerFeeBps: number
  makerFeeBps: number
  slippageBps: number
  maxLeverage: number
  marginMode: 'cross' | 'isolated'
  liquidationFeeBps: number
  fundingIntervalMs: number
  /** Per interval, absolute. Clamps the funding rate in both directions. */
  fundingCap: number
  /** paper.py `market_hours_only`. Off by default, exactly as paper.py defaults —
   *  `test_setting_off_fills_instantly_when_closed` pins that. */
  marketHoursOnly: boolean
}

export const DEFAULT_SETTINGS: Readonly<BrokerSettings> = {
  takerFeeBps: 5,
  makerFeeBps: 2,
  slippageBps: 2,
  maxLeverage: 20,
  marginMode: 'cross',
  liquidationFeeBps: 50,
  fundingIntervalMs: 28_800_000,
  fundingCap: 0.0075,
  marketHoursOnly: false,
}

// ── The account ──────────────────────────────────────────────────────────────

export interface BrokerAccount {
  id: string
  name: string
  createdAt: SimTime
  currency: string

  cash: number
  /** Immutable opening capital. paper.py `start_cash`. */
  startCash: number
  /**
   * Net capital put in over time (start + deposits − withdrawals).
   *
   * The P/L basis, and the reason a deposit is never a gain: deposit() raises
   * `cash` and `contributed` together, so total change stays flat across it.
   */
  contributed: number
  realized: number

  positions: Record<string, Position>
  orders: Order[]
  orderSeq: number

  /** Ordered, and validated rather than merged on load — a merge would silently
   *  resurrect symbols the user removed on another device. */
  watchlist: string[]

  settings: BrokerSettings
  lastFundingAt: SimTime
  /** The last BROKER_STEP_MS grid point actually processed — NOT `now`. Keeping
   *  the residual here is what makes 1000 one-second steps identical to one
   *  thousand-second step. */
  lastStepAt: SimTime
  /** >0 after a short option is assigned into negative cash. Blocks opening
   *  orders until cured. */
  marginDeficit: number
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Machine codes only.
 *
 * paper.py raises English straight into the UI (`"Not enough buying power: need
 * …"`). We cannot: the app ships EN and TH, so every message has to reach the
 * React layer as a key plus variables and be translated there.
 */
export type TradeErrorCode =
  | 'no-symbol'
  | 'unknown-instrument'
  | 'no-quote'
  | 'bad-qty'
  | 'bad-amount'
  | 'insufficient-funds'
  | 'insufficient-collateral'
  | 'exceeds-leverage'
  | 'reduce-only-would-open'
  | 'missing-limit'
  | 'missing-stop'
  | 'missing-trail'
  | 'option-expired'
  | 'margin-deficit'
  | 'market-closed'

export interface TradeError {
  code: TradeErrorCode
  /** Numbers the translated sentence interpolates — `need`, `have`, and so on. */
  vars?: Record<string, number | string>
}

/**
 * Why a resting order stopped resting. Still a machine code — the React layer maps
 * every member to a t() key — but deliberately a WIDER type than TradeErrorCode.
 *
 * A TradeErrorCode means the order was refused: it is what `placeOrder` returns
 * and what cancels an order that can no longer be funded at fill time (paper.py's
 * `"insufficient funds at fill"`). The two extra members are not refusals at all,
 * they are an order reaching the end of the lifetime the user asked for, and
 * folding them into TradeErrorCode would let `previewOrder` claim an order failed
 * because of `'ioc'`, which is meaningless.
 */
export type CancelReason =
  | TradeErrorCode
  /** The user cancelled it. */
  | 'user'
  /** `tif: 'ioc'` — it did not fill the moment it became eligible. */
  | 'ioc'
  /** `tif: 'day'` — the session it was placed in ended. */
  | 'day-expired'

export function tradeError(code: TradeErrorCode, vars?: Record<string, number | string>): TradeError {
  return vars ? { code, vars } : { code }
}

// ── Seams to modules this workstream does not own ────────────────────────────

/**
 * The Black-Scholes greeks, structurally identical to `options/bs.ts`'s `Greeks`.
 *
 * Declared here rather than imported because broker/ must not depend on options/:
 * the two are built in parallel, and an import would make one workstream's
 * compile failure the other's. TypeScript is structural, so the pricer's Greeks
 * satisfies this without either side naming the other.
 */
export interface PositionGreeks {
  price: Px
  delta: number
  gamma: number
  /** Per 1 vol point (0.01). */
  vega: number
  /** Per calendar DAY. */
  theta: number
  /** Per 1 rate point (0.01). */
  rho: number
}

/**
 * The result of settling one expired option, structurally identical to
 * `options/expiry.ts`'s `ExpiryOutcome`. Same reason as PositionGreeks: the
 * settlement MATH belongs to the options workstream, the settlement TIMING
 * belongs to step(). This type is the seam between them.
 */
export interface ExpiryOutcome {
  symbol: string
  qty: Qty
  settlementPrice: Px
  intrinsic: Px
  /** Signed: + credited to cash, − debited. */
  cash: number
  realized: number
  exercised: boolean
  assigned: boolean
}

// ── The injected world ───────────────────────────────────────────────────────

/**
 * The world at one instant, injected rather than fetched.
 *
 * This is the single decision that keeps the broker testable: every price, every
 * instrument and — critically — the current time arrives through this interface,
 * so a twenty-line fake replaces the entire market engine in a unit test, and
 * `step()` behaves identically whether the caller is a live feed or a catch-up
 * loop replaying a day in 200ms.
 *
 * Documented in the architecture as living in engine.ts and re-exported from
 * there; it is declared here so margin.ts can name it without importing the
 * engine that imports margin.ts.
 */
export interface MarketView {
  now(): SimTime
  quote(symbol: string): Quote | undefined
  fillPrice(symbol: string, side: Side, qty: Qty): Px | undefined
  instrument(symbol: string): Instrument | undefined
  /** Last N closed 1m closes, newest last — the option settlement TWAP's input. */
  recentCloses(symbol: string, count: number): Float64Array | undefined
}

/**
 * Everything `step()` and the order calls can tell the outside world about.
 *
 * An out-parameter array rather than a callback: the engine must not run user
 * code in the middle of mutating the ledger, or a listener that places an order
 * re-enters a half-updated account.
 */
export type BrokerEvent =
  | { type: 'fill'; trade: Trade; order?: Order }
  | { type: 'order-placed'; order: Order }
  | { type: 'order-cancelled'; order: Order; reason: CancelReason }
  | { type: 'liquidation'; symbol: string; qty: Qty; price: Px; loss: number; socialised: number }
  | { type: 'funding'; symbol: string; amount: number; rate: number }
  | { type: 'expiry'; outcome: ExpiryOutcome }
  | { type: 'margin-call'; marginLevel: number }
  | { type: 'equity'; t: SimTime; v: number }

// ── Small shared helpers ─────────────────────────────────────────────────────

/** paper.py `_mult`: one option contract is OPTION_MULT of the underlying;
 *  everything else trades one-for-one. */
export function instMult(m: Instrument | Position): number {
  if (m.kind !== 'option') return 1
  // A restored Position may predate `multiplier`; the constant is the contract.
  return ('multiplier' in m && m.multiplier ? m.multiplier : OPTION_MULT)
}

/** The mark to value a held position at. paper.py `_pos_mark`: last cached mark,
 *  falling back to cost so an unpriced position reads as flat rather than free. */
export function posMark(p: Position): Px {
  return p.mark || p.avgCost || 0
}
