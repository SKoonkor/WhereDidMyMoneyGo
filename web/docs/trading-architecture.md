I've read the codebase and the Python reference. Here is the design.

---

# Paper Trading Simulator — Architecture & Build Plan

## 0. Placement decision (needs your sign-off before W0 starts)

The stated convention is "pure logic in `src/lib/analytics/<name>.ts`". `src/lib/ai/`, `src/lib/import/`, and `src/lib/backup/` establish that a *namespaced subdirectory of `src/lib/`* is the accepted form once a feature outgrows one file. This feature is ~5,000 lines of pure logic, so:

- `src/lib/trading/**` — market engine, broker, options, indicators. No React, no Dexie, no `Date.now()`, no `Math.random()`.
- `src/lib/chart/**` — generic Canvas2D engine. No trading imports at all (structural seam, see §A.4).
- `src/features/trading/**` — React, Dexie access, runtime singleton.
- `src/features/trading/trading.css` — **deviation**: `App.css` is 3,301 lines and would be a permanent merge hazard across every workstream. A feature-local stylesheet imported by the page. Flag for approval.

Import rule to enforce with a test: **nothing under `src/lib/trading/` or `src/lib/chart/` may import from `node_modules`, from `src/db.ts`, or from `react`.** The only permitted outside import is `src/lib/format.ts`.

---

# A. Module map — FROZEN interfaces

## A.0 `src/lib/trading/types.ts` — the contract root

Zero imports. Every workstream imports this and nothing circular. **This file must be written first and then frozen.**

```ts
/** Milliseconds since epoch on the SIMULATION clock — never wall clock. */
export type SimTime = number
export type Px = number
export type Qty = number

export type Side = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'stop' | 'trailing'
export type OrderStatus = 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired'
export type InstrumentKind = 'spot' | 'perp' | 'option'
export type Right = 'call' | 'put'
export type Timeframe = '1s' | '5s' | '15s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export const TF_MS: Readonly<Record<Timeframe, number>>

export interface SpotInstrument {
  kind: 'spot'; symbol: string; base: string; quote: string
  tickSize: Px; lotSize: Qty; pricePrecision: number; qtyPrecision: number
}
export interface PerpInstrument {
  kind: 'perp'; symbol: string; underlying: string
  tickSize: Px; lotSize: Qty; pricePrecision: number; qtyPrecision: number
  maxLeverage: number; fundingIntervalMs: number
}
export interface OptionInstrument {
  kind: 'option'; symbol: string; underlying: string
  expiry: SimTime; right: Right; strike: Px; multiplier: number
  tickSize: Px; pricePrecision: number
}
export type Instrument = SpotInstrument | PerpInstrument | OptionInstrument

export interface Candle { t: SimTime; o: Px; h: Px; l: Px; c: Px; v: number; n: number }

export interface BookLevel { p: Px; q: Qty }
/** bids descending, asks ascending. Arrays are REUSED between reads — copy if retained. */
export interface OrderBook { t: SimTime; bids: BookLevel[]; asks: BookLevel[] }

export interface Quote {
  t: SimTime; symbol: string
  last: Px; bid: Px; ask: Px
  /** What margin/liquidation uses. Never `last`. */
  markPrice: Px
  indexPrice: Px
  open24h: Px; high24h: Px; low24h: Px; volume24h: number
}

/** Primitive-only sink. NOTHING in the hot path allocates a Tick object. */
export interface TickSink { onTick(t: SimTime, p: Px, q: Qty, s: 1 | -1): void }

/** ── Pinned constants, ported verbatim from src/analytics/paper.py ── */
export const DUST_QTY = 1e-6          // paper.py `abs(new_qty) < 1e-6`
export const SNAP_REL = 1e-5          // paper.py `abs(held) * 1e-5`
export const SNAP_ABS = 1e-3          // paper.py `1e-3`
export const FUNDS_EPS = 1e-6         // paper.py `+ 1e-6` in _check_funds
export const OPTION_MULT = 100        // paper.py OPTION_MULT
export const SNAPSHOT_MIN_GAP_MS = 8_000   // paper.py SNAPSHOT_MIN_GAP = 8.0
export const MAX_CURVE = 4000              // paper.py MAX_CURVE

/** Simulation quantum. The market clock advances ONLY in whole multiples of this;
 *  the residual is carried in ClockState. This is what makes replay exact. */
export const TICK_QUANTUM_MS = 250
/** The broker evaluates triggers/funding/expiry once per closed 1s sim-bar, in
 *  BOTH live ticking and fast-forward catch-up — one code path, identical results. */
export const BROKER_STEP_MS = 1_000
```

## A.1 Market engine — `src/lib/trading/market/`

### `rng.ts`
```ts
export interface RngState { a: number; b: number; c: number; d: number; spare: number | null }
export interface Rng {
  /** Uniform [0,1). sfc32. */
  u(): number
  /** Standard normal, Box–Muller with a cached spare. */
  normal(): number
  /** Exponential(1). */
  exp(): number
  /** Poisson(lambda), Knuth for lambda<30 else PTRS. */
  poisson(lambda: number): number
  /** Independent stream from the same root — used per-symbol. */
  fork(salt: string): Rng
  state(): RngState
  restore(s: RngState): void
}
export function hashSeed(s: string): number         // FNV-1a 32
export function createRng(seed: string, state?: RngState): Rng
```
**Rule:** `Math.random()` is forbidden anywhere under `src/lib/trading/market/`, `broker/`, `options/`. Enforce with `src/lib/trading/purity.test.ts` that greps the source tree.

### `model.ts`
```ts
export interface MarketParams {
  symbol: string
  seed: string
  p0: Px
  /** Annualised drift. */
  mu: number
  /** GARCH(1,1) on per-quantum log-returns: s2 = omega + alpha*e2_prev + beta*s2_prev */
  garch: { omega: number; alpha: number; beta: number }
  /** Merton jumps. */
  jump: { lambdaPerHour: number; meanLogSize: number; sdLogSize: number }
  /** OU pull of log-price toward a slow random trend. 0 disables. */
  reversion: { kappa: number; trendVol: number }
  /** 48 half-hour multipliers for intraday vol/volume seasonality, or null. */
  seasonality: Float64Array | null
  /** Expected trades per simulated second. */
  tradesPerSecond: number
  /** Lognormal trade size. */
  size: { medianQty: Qty; sigma: number }
  tickSize: Px
  book: BookParams
}
export interface BookParams {
  baseSpreadTicks: number; depth: number
  baseSize: Qty; sizeDecay: number
  imbalanceGain: number; imbalanceHalfLifeMs: number
}
export const PRESETS: Readonly<Record<
  'btc' | 'eth' | 'bluechip' | 'meme' | 'forex' | 'index', MarketParams>>

/** Fully serialisable; structured-cloneable; contains NO functions. */
export interface MarketState {
  version: 1
  quanta: number          // whole quanta advanced since t0
  t0: SimTime
  logP: number
  trend: number
  sigma2: number
  ePrev: number
  imbalance: number
  o24: Px; h24: Px; l24: Px; v24: number; rolled24At: SimTime
  rng: RngState
}

export interface MarketEngine {
  readonly symbol: string
  readonly params: MarketParams
  now(): SimTime
  /** Advance to `to`, emitting every generated tick to `sink`. Advances only in
   *  whole TICK_QUANTUM_MS steps; `to` past a partial quantum is not consumed.
   *  No-op (returns 0) when `to <= now()`. Returns ticks emitted. */
  advanceTo(to: SimTime, sink: TickSink): number
  /** Zero-alloc: returns the same Quote object each call, mutated. */
  quote(): Quote
  /** Zero-alloc: returns the same OrderBook, level arrays reused. Rebuilt at most
   *  once per BOOK_REBUILD_MS (100). */
  book(): OrderBook
  /** Depth-walked average fill price for a market order, incl. impact. */
  fillPrice(side: Side, qty: Qty): Px
  snapshot(): MarketState
  reset(state: MarketState): void
}
export function createMarket(p: MarketParams, restore?: MarketState): MarketEngine
```

### `candles.ts`
```ts
/** Struct-of-arrays ring buffer. The chart reads these Float64Arrays directly. */
export interface CandleSeries {
  readonly tf: Timeframe
  readonly capacity: number
  readonly length: number
  readonly t: Float64Array
  readonly o: Float64Array
  readonly h: Float64Array
  readonly l: Float64Array
  readonly c: Float64Array
  readonly v: Float64Array
  /** Bumped on every mutation — the chart's dirty check. */
  readonly rev: number
  /** Physical ring index for logical index i (0 = oldest held). */
  at(i: number): number
}
export interface CandleAggregator extends TickSink {
  readonly series: CandleSeries
  /** Emit flat (o=h=l=c=prevClose, v=0) candles up to `t`. A real chart never
   *  skips a bucket, and skipping breaks x-index↔time linearity. */
  fillTo(t: SimTime): void
  /** Fires with closed=true exactly once per bucket that rolls. */
  onClose(cb: (t: SimTime, o: Px, h: Px, l: Px, c: Px, v: number) => void): () => void
  toArray(fromIdx?: number, toIdx?: number): Candle[]
  loadArray(bars: Candle[]): void
}
export function createAggregator(tf: Timeframe, capacity: number): CandleAggregator
/** Derive a coarser series without replaying ticks. */
export function rollup(src: CandleSeries, tf: Timeframe, capacity: number): CandleSeries
```
`capacity` defaults: `1s`→3600, `1m`→4320 (3 days), `1h`→2160, `1d`→1000.

### `clock.ts`
```ts
export interface ClockState { simNow: SimTime; speed: number; residual: number; paused: boolean }
export interface SimClock {
  now(): SimTime
  speed: number            // 1 = real time; capped at 1000
  paused: boolean
  /** Consume `wallDeltaMs`; returns the new sim time (whole quanta only, remainder
   *  banked in `residual`). */
  advance(wallDeltaMs: number): SimTime
  /** Jump forward for catch-up without wall-clock coupling. */
  advanceSim(simDeltaMs: number): SimTime
  snapshot(): ClockState
  restore(s: ClockState): void
}
export function createClock(s?: ClockState): SimClock
```

### `feed.ts` — the seam both engines satisfy
```ts
export type FeedStatus = 'idle' | 'connecting' | 'live' | 'stalled' | 'error' | 'catching-up'
export interface FeedListener {
  onTick?(symbol: string, t: SimTime, p: Px, q: Qty, s: 1 | -1): void
  onBarClose?(symbol: string, tf: Timeframe, t: SimTime): void
  onBook?(symbol: string): void
  onStatus?(s: FeedStatus, detail?: string): void
}
export interface MarketFeed {
  readonly mode: 'sim' | 'live'
  readonly clock: SimClock
  readonly status: FeedStatus
  symbols(): readonly string[]
  instrument(symbol: string): Instrument | undefined
  add(symbol: string): void
  remove(symbol: string): void
  subscribe(l: FeedListener): () => void
  quote(symbol: string): Quote | undefined
  book(symbol: string): OrderBook | undefined
  series(symbol: string, tf: Timeframe): CandleSeries | undefined
  fillPrice(symbol: string, side: Side, qty: Qty): Px | undefined
  /** Chart bootstrap. Sim: generated backwards from state. Live: REST klines. */
  history(symbol: string, tf: Timeframe, count: number): Promise<Candle[]>
  /** Drive the world. Sim: advances the clock by `wallDeltaMs * speed` and
   *  generates. Live: a no-op (websocket-driven). Returns ticks emitted. */
  pump(wallDeltaMs: number): number
  /** Chunked fast-forward. Calls `onProgress(done, total)` between slices and
   *  yields to the event loop; each slice is sized to ≤ `budgetMs`. */
  catchUp(simDeltaMs: number, budgetMs: number,
          onProgress: (doneMs: number, totalMs: number) => void): Promise<void>
  snapshot(): WorldSnapshot
  dispose(): void
}
export interface WorldSnapshot {
  version: 1
  seed: string
  clock: ClockState
  savedAtWall: number
  markets: Record<string, MarketState>
}
export function createSimFeed(o: {
  seed: string; symbols: MarketParams[]; restore?: WorldSnapshot
}): MarketFeed
```

### `live.ts` — the crypto adapter, same interface
```ts
export interface LiveFeedOptions {
  symbols: string[]                    // e.g. ['BTCUSDT','ETHUSDT']
  venue?: 'binance' | 'coinbase'       // default binance, coinbase on failure
  restBase?: string; wsBase?: string
  onError?(e: Error): void
}
export function createLiveFeed(o: LiveFeedOptions): MarketFeed
```
- Binance: `wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade/btcusdt@depth20@100ms`, REST `https://api.binance.com/api/v3/klines?symbol=&interval=&limit=`. CORS-open, no key.
- Coinbase fallback: `wss://ws-feed.exchange.coinbase.com` (`matches` + `level2_batch`), REST `https://api.exchange.coinbase.com/products/{id}/candles`.
- `clock.speed` is forced to 1 and `paused` ignored in live mode.
- Reconnect: backoff 1s → 2 → 4 → 8 → 16 → 30s, ±20% jitter, reset on 30s of clean stream. `stalled` after 12s with no message.
- **The live feed still writes into the same `CandleAggregator`s**, so every downstream module is unaware which feed it has.

## A.2 Broker — `src/lib/trading/broker/`

### `types.ts`
```ts
export interface Position {
  symbol: string; kind: InstrumentKind
  qty: Qty                 // signed: >0 long, <0 short
  avgCost: Px              // always positive
  mark: Px
  openedAt: SimTime
  leverage?: number        // perp
  margin?: number          // perp, isolated
  fundingPaid?: number     // perp, cumulative (+ = paid out)
  expiry?: SimTime; right?: Right; strike?: Px; multiplier?: number  // option
  optionMargin?: number    // short options
}
export interface Order {
  id: string; seq: number; accountId: string
  symbol: string; kind: InstrumentKind
  side: Side; type: OrderType
  qty: Qty; status: OrderStatus
  createdAt: SimTime
  limit?: Px; stop?: Px
  trail?: number           // PERCENT, as paper.py stores it
  peak?: Px
  reduceOnly?: boolean; leverage?: number
  tif: 'gtc' | 'ioc' | 'day'
  fillPrice?: Px; filledAt?: SimTime; note?: string
}
export interface Trade {
  id: string; t: SimTime; accountId: string
  symbol: string; label: string; kind: InstrumentKind
  side: Side | 'deposit' | 'withdraw' | 'funding' | 'liquidation' | 'settlement'
  qty: Qty | null; price: Px | null
  value: number; fee: number; realized: number
  note: string
}
export interface BrokerSettings {
  takerFeeBps: number      // 5
  makerFeeBps: number      // 2
  slippageBps: number      // 2 base, scaled by depth walk
  maxLeverage: number      // 20
  marginMode: 'cross' | 'isolated'
  liquidationFeeBps: number     // 50
  fundingIntervalMs: number     // 28_800_000
  fundingCap: number            // 0.0075 per interval
  marketHoursOnly: boolean      // paper.py `market_hours_only`
}
export interface BrokerAccount {
  id: string; name: string; createdAt: SimTime
  currency: string
  cash: number; startCash: number; contributed: number; realized: number
  positions: Record<string, Position>
  orders: Order[]; orderSeq: number
  watchlist: string[]                   // ordered → validated on load, never merged
  settings: BrokerSettings
  lastFundingAt: SimTime
  lastStepAt: SimTime
  marginDeficit: number                 // >0 blocks opening orders
}
/** Machine codes only — the React layer maps each to a t() key. */
export type TradeErrorCode =
  | 'no-symbol' | 'unknown-instrument' | 'no-quote' | 'bad-qty' | 'bad-amount'
  | 'insufficient-funds' | 'insufficient-collateral' | 'exceeds-leverage'
  | 'reduce-only-would-open' | 'missing-limit' | 'missing-stop' | 'missing-trail'
  | 'option-expired' | 'margin-deficit' | 'market-closed'
export interface TradeError { code: TradeErrorCode; vars?: Record<string, number | string> }
```

### `fills.ts` — the exact port. **This is the file the 13 pinned tests guard.**
```ts
export interface FillResult {
  realized: number
  position: Position | null   // null = closed to dust and removed
  cashDelta: number
  fee: number
}
/** Port of paper.py `_apply_fill` (lines 549–589). MUST reproduce, exactly:
 *   cash -= signed * price * mult
 *   same-sign / flat → weighted-average over |qty|
 *   opposite sign    → realized = closed * (price - avgCost) * sign(oldQty) * mult
 *   flip             → avgCost resets to `price`
 *   |newQty| < DUST_QTY → position deleted
 *  `fee` is deducted from cash IN ADDITION and is NOT part of realized. */
export function applyFill(
  pos: Position | null, meta: Instrument, side: Side, qty: Qty, price: Px, fee: number,
): FillResult

/** Port of `_check_funds` (531–546). Throws nothing; returns an error or null.
 *  Sell beyond a long opens/extends a short and needs collateral. */
export function checkFunds(
  acct: BrokerAccount, meta: Instrument, side: Side, qty: Qty, price: Px,
): TradeError | null

/** Port of the dust snap in `_resolve_trade` (650–654). A REDUCING order within
 *  max(|held| * SNAP_REL, SNAP_ABS) of the full position becomes an exact close. */
export function snapQty(held: Qty, side: Side, qty: Qty): Qty

/** Port of `_qty_from_spec` (612–630): whole contracts for options, fractional
 *  for tickers; dollar-mode divides by price*mult. */
export function qtyFromSpec(
  spec: { mode: 'shares' | 'dollars'; qty: number }, price: Px, mult: number,
): { qty: Qty } | { error: TradeError }

/** Port of `_triggered` (786–802). MUTATES `o.peak` — pinned behaviour: the peak
 *  ratchets on every observed price, including ones that do not trigger. */
export function triggered(o: Order, price: Px): boolean

export function instrumentLabel(m: Instrument): string   // port of instrument_label
export function optionSymbol(u: string, expiry: SimTime, r: Right, k: Px): string
```

### `engine.ts`
```ts
/** The world at one instant. Injected, never fetched — this is what keeps the
 *  engine pure and unit-testable with a 20-line fake. */
export interface MarketView {
  now(): SimTime
  quote(symbol: string): Quote | undefined
  fillPrice(symbol: string, side: Side, qty: Qty): Px | undefined
  instrument(symbol: string): Instrument | undefined
  /** Last N closed 1m closes, newest last — for option settlement TWAP. */
  recentCloses(symbol: string, count: number): Float64Array | undefined
}
export interface OrderRequest {
  symbol: string
  side: Side
  type: OrderType
  mode: 'shares' | 'dollars'
  qty: number
  limit?: number; stop?: number; trail?: number
  leverage?: number; reduceOnly?: boolean
  tif?: 'gtc' | 'ioc' | 'day'
}
export interface OrderPreview {
  label: string; symbol: string
  side: Side; type: OrderType
  qty: Qty; mult: number
  price: Px | null; approx: boolean
  est: number | null; fee: number
  isOption: boolean
  isShort: boolean; held: Qty; shortQty: Qty     // port of preview_order's fields
  /** Perp only. */
  leverage?: number; initialMargin?: number; liqPrice?: Px | null
  /** Post-trade account health. */
  afterMarginLevel?: number
  warnings: TradeErrorCode[]                      // non-blocking advisories
}
export type PlaceResult =
  | { ok: true; outcome: 'filled'; order: Order; trade: Trade }
  | { ok: true; outcome: 'queued'; order: Order }
  | { ok: false; error: TradeError }

export type BrokerEvent =
  | { type: 'fill'; trade: Trade; order?: Order }
  | { type: 'order-placed'; order: Order }
  | { type: 'order-cancelled'; order: Order; reason: TradeErrorCode | 'user' }
  | { type: 'liquidation'; symbol: string; qty: Qty; price: Px; loss: number; socialised: number }
  | { type: 'funding'; symbol: string; amount: number; rate: number }
  | { type: 'expiry'; outcome: ExpiryOutcome }
  | { type: 'margin-call'; marginLevel: number }
  | { type: 'equity'; t: SimTime; v: number }

export function previewOrder(a: BrokerAccount, m: MarketView, r: OrderRequest): OrderPreview | { error: TradeError }
export function placeOrder(a: BrokerAccount, m: MarketView, r: OrderRequest): PlaceResult
export function cancelOrder(a: BrokerAccount, id: string): boolean
export function deposit(a: BrokerAccount, m: MarketView, amount: number): PlaceResult
export function withdraw(a: BrokerAccount, m: MarketView, amount: number): PlaceResult

/** Advance the account to `m.now()`. Runs the trigger/funding/expiry/liquidation
 *  cycle once per elapsed BROKER_STEP_MS, catching up any missed steps in order.
 *  Mutates `a` in place. Pure otherwise: no Date, no Dexie, no i18n. */
export function step(a: BrokerAccount, m: MarketView, out: BrokerEvent[]): void

export function createAccount(o: {
  id: string; name: string; currency: string; startCash: number; now: SimTime
}): BrokerAccount
```

### `margin.ts`
```ts
export interface MarginTier { maxNotional: number; rate: number; deduction: number }
export const DEFAULT_TIERS: readonly MarginTier[]
export function maintenanceRate(notional: number, tiers?: readonly MarginTier[]): { rate: number; deduction: number }

/** Closed form. Long : (q*E - M - D) / (q*(1 - r'))
 *                Short: (q*E + M + D) / (q*(1 + r'))
 *  where r' = maintenanceRate + liquidationFeeBps/10000 (the fee is folded in as a
 *  RATE, not a lump — this is what makes the closed form exact). Returns null for
 *  spot/option positions and for a long whose r' >= 1. */
export function liquidationPrice(
  pos: Position, s: BrokerSettings, tiers?: readonly MarginTier[],
): Px | null

export interface MarginSummary {
  equity: number          // cash + Σ unrealised
  used: number            // Σ initial margin
  free: number
  maintenance: number     // Σ maintenance requirement
  /** equity / maintenance. < 1 → liquidate. Infinity when maintenance is 0. */
  marginRatio: number
  /** equity / used, as a percentage — the number the UI shows. */
  marginLevel: number
  liquidatable: string[]  // symbols, largest maintenance first
}
export function marginSummary(a: BrokerAccount, m: MarketView): MarginSummary

/** Partial liquidation: closes the largest-maintenance positions until
 *  equity >= LIQ_TARGET_RATIO (1.3) * maintenance, or nothing is left. Cash is
 *  floored at 0; any shortfall is reported as `socialised` on the event. */
export function liquidate(a: BrokerAccount, m: MarketView, out: BrokerEvent[]): void
export const LIQ_TARGET_RATIO = 1.3

/** Deterministic from the mark/index spread; clamped to ±settings.fundingCap. */
export function fundingRate(mark: Px, index: Px, s: BrokerSettings): number
```

### `analytics.ts`
```ts
export interface PositionRow {
  symbol: string; label: string; kind: InstrumentKind
  qty: Qty; avgCost: Px; price: Px
  value: number; cost: number
  unreal: number; unrealPct: number
  leverage?: number; liqPrice?: Px | null; margin?: number; fundingPaid?: number
  greeks?: Greeks
}
export function positionRows(a: BrokerAccount, m: MarketView): PositionRow[]  // sorted -|value|, then label
export interface AccountSummary {
  equity: number; cash: number; invested: number
  dayChange: number; dayPct: number
  totalChange: number; totalPct: number
  realized: number; unrealized: number
  margin: MarginSummary
}
export function summarize(a: BrokerAccount, m: MarketView): AccountSummary   // port of summary()

export interface EquityPoint { t: SimTime; v: number }
/** Throttled append + MAX_CURVE cap. Unlike paper.py's `del curve[:n]` truncation,
 *  overflow DOWNSAMPLES 2:1 so the curve keeps its full time range. */
export function pushEquity(curve: EquityPoint[], p: EquityPoint, force: boolean): boolean
/** Step line of net contributed capital, aligned to the equity curve. Port of
 *  principal_series(). */
export function principalSeries(curve: EquityPoint[], trades: Trade[], startCash: number): number[]
export function drawdown(curve: EquityPoint[]): { maxDd: number; maxDdPct: number; peak: number }
export function stats(trades: Trade[]): {
  wins: number; losses: number; winRate: number
  avgWin: number; avgLoss: number; profitFactor: number; expectancy: number
}
```

## A.3 Options — `src/lib/trading/options/`

```ts
// bs.ts
export interface BsInput { s: Px; k: Px; tYears: number; r: number; q: number; sigma: number; right: Right }
export interface Greeks {
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
/** BSM with continuous yield q. Never NaN: tYears<=0 → discounted intrinsic,
 *  sigma<=0 → discounted intrinsic, s<=0 or k<=0 → clamped. */
export function bs(i: BsInput): Greeks
export function d1d2(i: BsInput): { d1: number; d2: number }
export function normCdf(x: number): number   // Abramowitz–Stegun 7.1.26, |ε| < 7.5e-8
export function normPdf(x: number): number
/** Newton (≤20 iters, tol 1e-7) with bisection fallback on [1e-4, 5]. null if no root. */
export function impliedVol(price: Px, i: Omit<BsInput, 'sigma'>): number | null

// chain.ts
export interface VolSurface { atmVol: number; termSlope: number; skew: number; smile: number }
/** sigma(K,T) = (atmVol + termSlope*sqrt(T)) * (1 + skew*m + smile*m^2),
 *  m = ln(K/F) / (atmVol * sqrt(T)); clamped to [0.02, 4]. Deterministic. */
export function surfaceVol(sf: VolSurface, spot: Px, strike: Px, tYears: number, r: number): number

export interface ChainParams {
  underlying: string
  /** Strikes: `steps` each side of ATM at `stepPct` of spot, snapped to a round ladder. */
  strikeSteps: number; strikeStepPct: number
  r: number; q: number
  surface: VolSurface
  spreadBps: number          // half-spread around the model mark
  multiplier: number         // OPTION_MULT
}
export interface ChainRow {
  strike: Px
  call: { inst: OptionInstrument; iv: number; g: Greeks; bid: Px; ask: Px; mark: Px; oi: number; volume: number }
  put:  { inst: OptionInstrument; iv: number; g: Greeks; bid: Px; ask: Px; mark: Px; oi: number; volume: number }
}
export interface OptionChain { underlying: string; spot: Px; expiry: SimTime; now: SimTime; rows: ChainRow[] }

/** Deterministic given (spot, now, expiry, params) — no RNG. `oi`/`volume` are a
 *  deterministic hash-based cosmetic function of (strike, expiry). */
export function buildChain(p: ChainParams, spot: Px, now: SimTime, expiry: SimTime): OptionChain
/** Next N Fridays 08:00Z plus the last Friday of the next 3 months, from `now`. */
export function standardExpiries(now: SimTime, weeklies: number, monthlies: number): SimTime[]
export function optionSymbol(u: string, expiry: SimTime, r: Right, k: Px): string   // "BTC|2026-08-14|call|65000"
export function parseOptionSymbol(sym: string): OptionInstrument | null
/** Initial margin for a SHORT option: CBOE 20% rule.
 *  max(0.20*S - OTM, 0.10*K) * mult + premium. */
export function shortOptionMargin(s: Px, k: Px, right: Right, premium: Px, mult: number): number

// expiry.ts
export const SETTLEMENT_TWAP_MS = 30 * 60_000
export interface ExpiryOutcome {
  symbol: string; qty: Qty
  settlementPrice: Px; intrinsic: Px
  cash: number          // signed: + credited, − debited
  realized: number
  exercised: boolean; assigned: boolean
}
/** CASH-SETTLED at the 30-minute TWAP of the underlying's 1m closes ending at
 *  expiry. ITM by > `threshold` (0.01) exercises (long) / assigns (short); OTM
 *  expires worthless. Pure — caller applies the cash and removes the positions.
 *  Physical delivery is deliberately NOT modelled; the UI must say "cash settled". */
export function settleExpiries(
  positions: readonly Position[], twap: (underlying: string) => Px | undefined,
  now: SimTime, threshold?: number,
): ExpiryOutcome[]
```

## A.4 Chart engine — `src/lib/chart/`

**Structural seam, no imports either way:**
```ts
// src/lib/chart/types.ts
export interface OhlcvColumns {
  readonly length: number
  readonly t: Float64Array; readonly o: Float64Array; readonly h: Float64Array
  readonly l: Float64Array; readonly c: Float64Array; readonly v: Float64Array
  at(i: number): number
  readonly rev: number
}
```
`CandleSeries` structurally satisfies `OhlcvColumns`. Neither module imports the other.

### `scale.ts`
```ts
export interface Viewport { i0: number; span: number; p0: Px; p1: Px }
export interface Rect { x: number; y: number; w: number; h: number }   // CSS px
export interface Scales {
  xOf(i: number): number
  iOf(x: number): number
  yOf(p: number): number
  pOf(y: number): number
  readonly barW: number
  readonly bodyW: number      // already device-pixel snapped and odd when narrow
  readonly wickW: number
}
export function makeScales(v: Viewport, plot: Rect, dpr: number): Scales
/** 1/2/2.5/5 ladder, snapped to `tickSize`, at most `max`, min `minGapPx` apart. */
export function priceTicks(p0: Px, p1: Px, h: number, minGapPx: number, tickSize: Px, max: number): Float64Array
export type TimeUnit = 'sec' | 'min' | 'hour' | 'day' | 'month' | 'year'
export interface TimeTick { t: SimTime; unit: TimeUnit; major: boolean }
/** No strings — formatting (and therefore i18n) is the React layer's job. */
export function timeTicks(t0: SimTime, t1: SimTime, w: number, minGapPx: number): TimeTick[]
/** Visible [min,max] with padding and a floor of 20*tickSize. */
export function autoRange(d: OhlcvColumns, i0: number, i1: number, padPct: number, tickSize: Px): { p0: Px; p1: Px }
export function clampViewport(v: Viewport, dataLen: number, minSpan: number, maxSpan: number, rightGapBars: number): Viewport
```

### `physics.ts`
```ts
export interface KineticConfig {
  /** v *= friction^(dt/1000). 0.135 = iOS UIScrollView "normal". */
  friction: number
  minVelocity: number      // px/s
  /** Apple rubber-band constant. */
  rubber: number           // 0.55
  springK: number          // 220
  springZeta: number       // 1 (critically damped)
}
export const DEFAULT_KINETIC: Readonly<KineticConfig>
export interface Kinetic {
  value: number; velocity: number
  beginDrag(): void
  drag(delta: number, min: number, max: number): void
  endDrag(velocity: number, min: number, max: number): void
  /** true while still animating. Substeps internally at 1/240s, max 8 substeps. */
  update(dtMs: number, min: number, max: number): boolean
  stop(): void
}
export function createKinetic(cfg?: Partial<KineticConfig>): Kinetic
/** Apple's: (1 - 1/(|d|*c/dim + 1)) * dim/c * sign(d), c = 0.55 */
export function rubberBand(d: number, dim: number, c?: number): number

export interface Spring {
  value: number; velocity: number; target: number
  update(dtMs: number): boolean
  snap(v: number): void
}
export function createSpring(k: number, zeta?: number, epsilon?: number): Spring
export const easeOutCubic: (t: number) => number
export const easeOutQuad: (t: number) => number
```

### `gestures.ts`
```ts
export interface GestureHandlers {
  onPanStart?(): void
  onPan(dx: number, dy: number): void
  onPanEnd(vx: number, vy: number): void
  onPinch(scale: number, cx: number, cy: number): void
  onPinchEnd?(): void
  onTap?(x: number, y: number): void
  onLongPress?(x: number, y: number): void
  onHoverMove?(x: number, y: number): void
  onHoverEnd?(): void
  onWheel?(dy: number, x: number, ctrl: boolean): void
}
export interface GestureOptions {
  slop: number            // 6 px before a press becomes a pan
  longPressMs: number     // 260
  flingWindowMs: number   // 100
}
/**
 * Attaches NATIVE, non-passive listeners. React's onTouchStart CANNOT be used:
 * React registers touchstart PASSIVELY at the root, so preventDefault() is a
 * no-op there — see src/components/Keypad.tsx:176-186 and Modal.tsx:118-120.
 * Also swallows iOS `gesturestart`/`gesturechange`, and treats `pointercancel`
 * as a zero-velocity release. The returned disposer is IDEMPOTENT (StrictMode).
 */
export function attachGestures(el: HTMLElement, h: GestureHandlers, o?: Partial<GestureOptions>): () => void
```

### `renderer.ts`
```ts
export interface ChartTheme {
  bg: string; grid: string; gridMajor: string
  up: string; down: string; upFill: string; downFill: string
  neutral: string; ink: string; muted: string
  axisBg: string; axisBorder: string
  crosshair: string; pillBg: string; pillInk: string
  volumeUp: string; volumeDown: string
  accent: string
  /** Must carry the app's body stack incl. 'Noto Sans Thai' — see theme.css:49. */
  font: string
  /** Tabular-digit stack for EVERY number. Canvas ignores font-variant-numeric. */
  fontMono: string
  axisFontPx: number; labelFontPx: number; legendFontPx: number
  /** Privacy mode. Canvas text is NOT covered by :root[data-censor] .money. */
  censor: boolean
  reducedMotion: boolean
}
/** Reads the CSS custom properties ONCE. The renderer must never call
 *  getComputedStyle per frame. */
export function themeFromCss(el: Element, censor: boolean, reducedMotion: boolean): ChartTheme

export interface InteractionState {
  crosshair: { x: number; y: number; i: number; p: Px } | null
  pressed: boolean
  overscrollX: number      // -1..1
}
export interface RenderCtx {
  readonly ctx: CanvasRenderingContext2D
  readonly plot: Rect
  readonly priceAxis: Rect
  readonly timeAxis: Rect
  readonly scales: Scales
  readonly data: OhlcvColumns
  readonly i0: number      // first visible logical index (clipped)
  readonly i1: number      // last visible logical index, inclusive
  readonly dpr: number
  readonly theme: ChartTheme
  /** ms since the previous frame. Layers animate off THIS, never Date.now(). */
  readonly dt: number
  readonly now: SimTime
  readonly interaction: InteractionState
  /** Snap a CSS-px coordinate to a device-pixel boundary. */
  snap(v: number): number
}
export interface ChartLayer {
  readonly id: string
  /** grid 10, volume 50, indicators 80, candles 100, positionLines 200,
   *  lastPrice 300, axes 800, crosshair 900, overlay 1000 */
  readonly z: number
  /** true = must redraw every frame even when data+viewport are unchanged. */
  readonly volatile: boolean
  /** true = renders into the cached static bitmap instead of the live canvas. */
  readonly cacheable: boolean
  draw(c: RenderCtx): void
  dispose?(): void
}
export interface ChartOptions {
  theme: ChartTheme
  tickSize: Px; pricePrecision: number
  minSpan: number          // 12
  maxSpan: number          // 2000
  rightGapFrac: number     // 0.12
  volumeFrac: number       // 0.16
  priceAxisMinW: number    // 56
  timeAxisH: number        // 26
}
export interface ChartEngine {
  readonly viewport: Readonly<Viewport>
  readonly following: boolean
  setData(d: OhlcvColumns): void
  setTheme(t: ChartTheme): void
  addLayer(l: ChartLayer): void
  removeLayer(id: string): void
  setFollow(on: boolean): void
  setSpan(span: number, anchorI?: number): void
  invalidate(): void
  resize(cssW: number, cssH: number, dpr: number): void
  /** Synchronous single frame — how tests drive rendering (jsdom rAF is useless). */
  renderNow(nowMs?: number): void
  /** Idempotent. */
  destroy(): void
  readonly interaction: InteractionState
}
export function createChart(canvas: HTMLCanvasElement, o: ChartOptions): ChartEngine
```

### Layers (one file each, `src/lib/chart/layers/`)
```ts
export function createGridLayer(): ChartLayer            // cacheable
export function createCandleLayer(o: {
  mode: 'candles' | 'hollow' | 'heikin' | 'bars' | 'line' | 'area'
}): ChartLayer & { setMode(m: string): void }            // cacheable
export function createVolumeLayer(): ChartLayer          // cacheable
export function createPriceAxisLayer(o: { format(p: number): string }): ChartLayer
export function createTimeAxisLayer(o: { format(t: SimTime, unit: TimeUnit, major: boolean): string }): ChartLayer
export function createCrosshairLayer(o: {
  formatPrice(p: number): string; formatTime(t: SimTime): string
  /** Vertical offset so a finger doesn't cover the readout. 44 on touch, 0 on mouse. */
  touchOffsetY: number
}): ChartLayer                                            // volatile
export function createLastPriceLayer(o: { format(p: number): string; countdown: boolean }): ChartLayer  // volatile
export function createLegendLayer(o: { format(p: number): string; labels: Record<'o'|'h'|'l'|'c', string> }): ChartLayer
export function createPositionLinesLayer(o: {
  lines(): readonly PriceLine[]
}): ChartLayer
export interface PriceLine {
  price: Px; label: string; tone: 'entry' | 'liq' | 'tp' | 'sl' | 'order'; dashed: boolean
}
export function createDepthLayer(o: { book(): OrderBook | undefined; widthPx: number }): ChartLayer  // volatile
export function createIndicatorLayer(o: { specs(): readonly IndicatorSpec[] }): ChartLayer
```

### `format.ts` — the ONE money formatter for canvas
```ts
/** Every number the canvas draws goes through here. `:root[data-censor='on'] .money`
 *  only masks DOM; canvas text must mask itself. Returns a string whose WIDTH
 *  matches the uncensored one so the axis doesn't reflow on toggle. */
export function formatPriceForCanvas(v: number, precision: number, censor: boolean): string
export function formatSignedForCanvas(v: number, precision: number, censor: boolean): string
export function formatCompactVolume(v: number, censor: boolean): string
```

### `testing/fakeCtx.ts` — the jsdom answer
```ts
export type Op =
  | { op: 'fillRect' | 'rect' | 'clearRect'; a: number[] }
  | { op: 'fillText' | 'strokeText'; text: string; x: number; y: number }
  | { op: 'set'; prop: string; value: unknown }
  | { op: 'beginPath' | 'fill' | 'stroke' | 'save' | 'restore' | 'closePath' }
  | { op: 'setTransform'; a: number[] }
  | { op: 'moveTo' | 'lineTo'; x: number; y: number }
  | { op: 'setLineDash'; dash: number[] }
/** A recording stub implementing the ~28 CanvasRenderingContext2D members the
 *  engine uses. measureText returns width = text.length * 6.2. */
export function createFakeCtx(): { ctx: CanvasRenderingContext2D; ops: Op[]; reset(): void }
/** Attach it to a jsdom canvas so createChart() works with no node-canvas. */
export function stubCanvas(el: HTMLCanvasElement): { ops: Op[] }
```

### `src/lib/trading/indicators.ts`
```ts
export interface Indicator {
  readonly out: Float64Array      // ring, aligned to the series
  readonly period: number
  push(v: number): number
  /** Replace the newest value (the forming bar re-ticks constantly). */
  amend(v: number): number
  reset(): void
}
export function sma(period: number, cap: number): Indicator
export function ema(period: number, cap: number): Indicator
export function rsi(period: number, cap: number): Indicator
export function macd(fast: number, slow: number, signal: number, cap: number): { push(v: number): void; amend(v: number): void; macd: Float64Array; signal: Float64Array; hist: Float64Array }
export function bollinger(period: number, k: number, cap: number): { push(v: number): void; amend(v: number): void; mid: Float64Array; up: Float64Array; lo: Float64Array }
export function vwap(cap: number): { push(p: number, v: number, sessionStart: boolean): number; out: Float64Array }
export function atr(period: number, cap: number): { push(h: number, l: number, c: number): number; out: Float64Array }
export interface IndicatorSpec { id: string; kind: 'sma'|'ema'|'rsi'|'macd'|'bb'|'vwap'; period: number; color: string; pane: 'main' | 'sub' }
```
`amend()` is the non-obvious requirement: the forming candle's close changes many times per second and a naive `push` would corrupt every moving average.

## A.5 Persistence — `src/db.ts` v5 + `src/features/trading/store.ts`

### `db.ts` additions (owned by ONE workstream)
```ts
interface ConfigRow {
  key: 'accounts' | 'categories' | 'settings' | 'budget' | 'goals' | 'debts'
     | 'reconcile' | 'tax' | 'retirement' | 'notifications' | 'ai' | 'home'
     | 'trading'                                   // ← the one new key
  value: unknown
}
const db = new Dexie('money-tracker') as Dexie & {
  transactions: EntityTable<Txn, 'id'>
  config: EntityTable<ConfigRow, 'key'>
  goalMoves: EntityTable<GoalMove, 'id'>
  simAccounts: EntityTable<SimAccountRow, 'id'>
  simTrades: EntityTable<SimTradeRow, 'id'>
  simEquity: EntityTable<SimEquityRow, 'id'>
  simWorld: EntityTable<SimWorldRow, 'id'>
  simBars: EntityTable<SimBarChunk, 'id'>
}
// v5 — the paper-trading sandbox. Additive; every earlier store restated.
db.version(5).stores({
  transactions: '++id, period, account, type, category, transferId, debt',
  config: 'key',
  goalMoves: '++id, period, transferId',
  simAccounts: 'id',                    // uuid string
  simTrades:  '++id, accountId, t, symbol, [accountId+t]',
  simEquity:  '++id, accountId, t, [accountId+t]',
  simWorld:   'id',                     // singleton, id = 'world'
  simBars:    '++id, [symbol+tf], t0, [symbol+tf+t0]',
})
```

**Table vs. config row — the rule applied:**

| Data | Where | Why |
|---|---|---|
| UI prefs (timeframe, chart type, speed, mode, disclaimer flag) | `config['trading']` | patchable record → `{...DEFAULT, ...row}` merge |
| `indicators: string[]` (inside `TradingCfg`) | still config, but **validated not merged** | ordered collection — the `getDebts` (db.ts:369) pattern |
| Account (cash, positions, orders, watchlist, settings) | `simAccounts` table | multiple rows, per-account lifecycle |
| Trades | `simTrades` | unbounded append-only |
| Equity curve | `simEquity` | unbounded, capped at MAX_CURVE per account |
| World snapshot (seed, clock, per-symbol MarketState) | `simWorld`, one row | it's a singleton, but it's binary-ish and mutated on a different cadence than UI prefs |
| Candles | `simBars`, **chunked** | one row per 500 bars, columns as `Float64Array` — 500 rows would be 500 IDB writes |

```ts
export interface SimBarChunk {
  id: number
  symbol: string; tf: Timeframe
  t0: SimTime; count: number
  /** Packed columns. IndexedDB structured-clones TypedArrays natively and fast. */
  t: Float64Array; o: Float64Array; h: Float64Array
  l: Float64Array; c: Float64Array; v: Float64Array
}
export const BAR_CHUNK = 500
```

### `src/features/trading/store.ts` — the ONLY trading file that touches Dexie
```ts
export interface TradingCfg {
  selectedAccountId: string | null
  mode: 'sim' | 'live'
  speed: number
  timeframe: Timeframe
  chartType: 'candles' | 'hollow' | 'heikin' | 'bars' | 'line' | 'area'
  indicators: string[]          // ordered → VALIDATED on read
  symbol: string
  showDepth: boolean
  colorBlind: boolean
  soundOn: boolean
  disclaimerAcceptedAt: string | null
}
export const DEFAULT_TRADING: Readonly<TradingCfg>
/** Merged for scalars; `indicators` validated wholesale (getDebts pattern). */
export async function getTrading(): Promise<TradingCfg>
export async function saveTrading(cfg: TradingCfg): Promise<void>

export async function listAccounts(): Promise<BrokerAccount[]>
export async function getAccount(id: string): Promise<BrokerAccount | undefined>
export async function saveAccount(a: BrokerAccount): Promise<void>
export async function deleteAccount(id: string): Promise<void>

export async function appendTrades(ts: readonly Trade[]): Promise<void>   // bulkAdd
export async function listTrades(accountId: string, limit?: number): Promise<Trade[]>
export async function appendEquity(accountId: string, pts: readonly EquityPoint[]): Promise<void>
export async function listEquity(accountId: string): Promise<EquityPoint[]>

export async function saveWorld(w: WorldSnapshot): Promise<void>
export async function loadWorld(): Promise<WorldSnapshot | null>
export async function saveBars(symbol: string, tf: Timeframe, bars: readonly Candle[]): Promise<void>
export async function loadBars(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]>
/** Drop chunks older than `keepMs` of sim time. Called on idle. */
export async function pruneBars(keepMs: number, now: SimTime): Promise<number>

export type FlushReason = 'hidden' | 'idle' | 'action' | 'unmount'
/** The single write gate. The tick loop NEVER calls Dexie directly. */
export async function flush(reason: FlushReason): Promise<void>

/** Wipe every sim table + the config key. The "it can never touch real money"
 *  guarantee, made testable: this must leave `transactions` and `goalMoves`
 *  byte-identical. */
export async function resetSandbox(): Promise<void>
```

### Backup — `BACKUP_VERSION` 6 → **7**
```ts
export interface Backup {
  /* … existing fields … */
  trading?: TradingCfg
  simAccounts?: BrokerAccount[]
  simTrades?: Trade[]
  simEquity?: Array<{ accountId: string } & EquityPoint>
  /** Seed + clock only. Bars and MarketState are NOT backed up — they regenerate
   *  deterministically from the seed, and 30 days of 1m bars would be ~40 MB. */
  simWorld?: { seed: string; clock: ClockState; savedAtWall: number }
}
```

## A.6 React layer — `src/features/trading/`

### `runtime.ts` — the StrictMode-safe singleton
```ts
export interface TradingRuntime {
  readonly feed: MarketFeed
  readonly account: BrokerAccount
  readonly cfg: TradingCfg
  series(symbol: string, tf: Timeframe): CandleSeries | undefined
  marketView(): MarketView
  /** Fires at ≤ NOTIFY_HZ (8). Anything needing 60fps reads the runtime inside
   *  its own rAF instead of subscribing. */
  subscribe(cb: () => void): () => void
  getVersion(): number
  events(cb: (e: BrokerEvent) => void): () => void
  place(r: OrderRequest): PlaceResult
  preview(r: OrderRequest): OrderPreview | { error: TradeError }
  cancel(id: string): boolean
  setSpeed(v: number): void
  setPaused(p: boolean): void
  switchMode(m: 'sim' | 'live'): Promise<void>
  readonly catchUp: { active: boolean; done: number; total: number }
}
export const NOTIFY_HZ = 8
/** Refcounted. `release` defers disposal by one macrotask so React 19 StrictMode's
 *  mount→unmount→mount does NOT tear down and rebuild the world (which would reset
 *  the RNG and produce a visible price jump in dev). */
export function acquireRuntime(): Promise<TradingRuntime>
export function releaseRuntime(): void
```

### Hooks & components
```ts
// useTrading.ts — undefined while loading, per convention
export interface TradingView {
  cfg: TradingCfg
  account: BrokerAccount
  summary: AccountSummary
  positions: PositionRow[]
  openOrders: Order[]
  trades: Trade[]
  quote: Quote | undefined
  status: FeedStatus
  catchUp: { active: boolean; done: number; total: number }
  currency: string
}
export function useTrading(): TradingView | undefined
export function useChain(underlying: string, expiry: SimTime | null): OptionChain | undefined
export function useOrderBook(symbol: string): OrderBook | undefined   // 10 Hz, not 60
```

Files:
```
features/trading/TradingPage.tsx        route /trading
features/trading/AccountsPage.tsx       route /trading/accounts
features/trading/OptionsPage.tsx        route /trading/options
features/trading/ChartPanel.tsx         canvas host + gesture wiring
features/trading/OrderTicket.tsx        uses NumberField (mandatory)
features/trading/ConfirmSheet.tsx       mirrors previewOrder()
features/trading/PositionsList.tsx
features/trading/OrdersList.tsx
features/trading/Blotter.tsx
features/trading/Watchlist.tsx
features/trading/DepthPanel.tsx
features/trading/EquityCurve.tsx        canvas, reuses lib/chart
features/trading/LeverageSlider.tsx
features/trading/SpeedControl.tsx
features/trading/DisclaimerGate.tsx
features/trading/errors.ts              TradeErrorCode → t() key map
features/trading/runtime.ts
features/trading/store.ts
features/trading/useTrading.ts
features/trading/trading.css
```

---

# B. Parallel workstream decomposition

## Phase 0 — sequential, blocks everything (~1 day, 1 agent)

**W0 · Foundation & contracts.** Writes `src/lib/trading/types.ts`, `src/lib/trading/rng.ts` (+test), `src/lib/chart/types.ts`, `src/lib/chart/scale.ts` (+test), `src/lib/chart/format.ts` (+test), `src/lib/chart/testing/fakeCtx.ts`, and **type-only stub files for every other module listed in §A** (real `export interface`/`export type`, function bodies `throw new Error('W_n')`). Also `src/lib/trading/purity.test.ts` (the `Math.random`/import-guard test).

Output: the whole tree typechecks and `npm run build` passes on day one. Every downstream agent codes against real types immediately. ~650 lines.

## Phase 1 — full fan-out (all start together)

| # | Workstream | Owns exclusively | Consumes | Produces | Depends on | Size |
|---|---|---|---|---|---|---|
| **W1** | Market engine | `lib/trading/market/{model,candles,clock,feed,book}.ts` + tests | `types`, `rng` | `MarketEngine`, `CandleSeries`, `MarketFeed`, `SimClock`, `WorldSnapshot` | W0 | ~1,300 L |
| **W2** | Broker | `lib/trading/broker/{types,fills,engine,margin,analytics}.ts` + tests | `types` | `BrokerAccount`, `step`, `placeOrder`, `previewOrder`, `MarketView`, `BrokerEvent` | W0 | ~1,000 L |
| **W3** | Options | `lib/trading/options/{bs,chain,expiry}.ts` + tests | `types` | `bs`, `Greeks`, `OptionChain`, `settleExpiries`, `shortOptionMargin` | W0 | ~550 L |
| **W4** | Chart core | `lib/chart/{renderer,physics,gestures,offscreen,theme}.ts` + tests | `chart/types`, `scale` | `ChartEngine`, `ChartLayer`, `RenderCtx`, `Kinetic`, `Spring`, `attachGestures`, `ChartTheme` | W0 | ~950 L |
| **W5** | Chart layers + indicators | `lib/chart/layers/*.ts`, `lib/trading/indicators.ts` + tests | `RenderCtx`, `Scales`, `OhlcvColumns` | 11 `ChartLayer` factories, `Indicator` | W0 (RenderCtx frozen there) | ~1,200 L |
| **W6** | Live crypto adapter | `lib/trading/market/live.ts`, `live.test.ts` | `MarketFeed`, `CandleAggregator` | `createLiveFeed` | W0; needs W1's aggregator at integration | ~400 L |
| **W7** | Persistence | `src/db.ts`, `lib/backup/backup.ts`, `features/trading/store.ts` + tests | `BrokerAccount`, `Trade`, `WorldSnapshot`, `TradingCfg` | `getTrading`, `saveAccount`, `flush`, `resetSandbox`, v5 schema, BACKUP_VERSION 7 | W0 | ~450 L |
| **W8** | React shell | `features/trading/*.tsx`, `runtime.ts`, `useTrading.ts`, `errors.ts` | everything | `/trading` routes, the UI | W0; integrates W1–W7 | ~2,200 L |
| **W9** | i18n + CSS + copy | `src/i18n.ts`, `features/trading/trading.css` | the `TradeErrorCode` union, a string manifest | ~180 EN/TH strings, the stylesheet | W0 (error codes frozen there) | ~700 L |

## Merge hazards — every file more than one workstream would want

| File | **Sole owner** | Rule |
|---|---|---|
| `src/db.ts` | **W7** | Nobody else opens it. Others request schema through W7. |
| `src/lib/backup/backup.ts` | **W7** | Same. |
| `src/i18n.ts` | **W9** | Everyone else appends to `features/trading/STRINGS.md` (a manifest, not code); W9 lands them in one commit at the end. |
| `src/App.tsx` | **W8** | A 3-line diff (lazy import + 3 `<Route>`s), landed last. |
| `src/features/apps/AppsPage.tsx` | **W8** | One tile object appended to a new `SIMULATORS` array. |
| `src/data/changelog.ts` | **W8** | One release entry, last commit. |
| `src/theme.css` | **W9** | Exactly two new tokens: `--chart-grid`, `--chart-axis-bg`. Nothing else. |
| `vite.config.ts` | **W7** | Only if `manualChunks` is added. |
| `src/lib/chart/types.ts`, `src/lib/trading/types.ts` | **W0, then FROZEN** | Any change after Phase 0 requires an explicit unfreeze announcement to all agents. |

## Sequencing notes

- **Genuinely parallel:** W1–W7 and W9 share zero files after W0. W8 shares only its own tree plus the three 1–3 line diffs above.
- **Integration order:** W7 → W2 → W1 → W5/W4 → W3 → W6 → W8. W8 should build against a hand-rolled `fakeFeed`/`fakeAccount` from day one and swap in the real ones as they land.
- **The riskiest joins:** (a) W4↔W5 — `RenderCtx` must not grow after W0; (b) W1↔W2 — `MarketView` is the only surface between them and it is 5 methods; (c) W8↔runtime lifecycle — see §D.1.

---

# C. The hard problems, solved

## C.1 60fps on a mid-range phone

**Frame budget: 16.6ms. Target ≤ 6ms for the chart.**

**What is cached to an offscreen canvas.** One `HTMLCanvasElement` (not `OffscreenCanvas` — Safari support is late and a worker adds nothing here) sized `(plotW * 3) × plotH × dpr`, i.e. one plot-width of bleed on each side. It holds grid + volume + candles + indicators. Panning within the bleed is a single `drawImage(cache, -offset, 0)` — **~0.15ms regardless of candle count**. That is what makes a fling free.

The cache is rebuilt only when: bar width changes (zoom), the price range moves beyond a 2% deadband, a bar closes, the theme changes, or the pan exits the bleed. During a 1000px fling at 120 visible bars, that's ~2 rebuilds instead of ~40 full redraws.

**What is drawn live every frame.** Forming candle, last-price line + pill, crosshair, price-axis labels (they move with the autoscale spring), position/liquidation lines, depth spine, legend. ~14 `fillRect`s and ~12 `fillText`s.

**Candle draw rules (freeze these — they are also asserted by the `fakeCtx` tests):**
```
ctx.fillStyle = theme.up;   ctx.beginPath(); for (up bars)   { ctx.rect(body); ctx.rect(wick) } ctx.fill()
ctx.fillStyle = theme.down; ctx.beginPath(); for (down bars) { ctx.rect(body); ctx.rect(wick) } ctx.fill()
```
- Exactly **two** `fill()` calls and **two** `fillStyle` assignments per candle pass. No `beginPath()` inside the loop, no `stroke()` anywhere, no `new Path2D()`.
- Wicks are `rect`s, never strokes — a 1px stroke off a half-pixel boundary is the grey blur that gives away a hobby chart.
- 120 bars → 240 `rect` calls + 2 `fill()` ≈ **0.25ms**, versus ~0.9ms with per-candle `fillRect`.

**Text.** `fillText` is ~40µs on a mid phone and `measureText` costs the same. So: widths are measured **once per label-set change**, cached in a `Map<number,string>` of formatted labels keyed by tick value, invalidated when `priceTicks` returns a different array. Cap at 7 price labels and 6 time labels. Budget: 13 × 40µs = **0.52ms**.

**Decoupling the tick stream from the render loop.**
- The feed pumps on `setInterval` at **20 Hz** (not rAF — rAF is throttled/stopped when the tab is hidden, and 20 Hz is plenty since one pump emits many ticks).
- The render loop is a separate rAF that reads `series.rev`. If `rev` is unchanged **and** no spring/kinetic is animating **and** no pointer is down, the frame returns immediately and the loop **stops scheduling itself**. It is woken by `invalidate()` from the feed's `onTick`, the gesture handler, or a theme change.
- Result: an idle chart at 1× speed costs ~4 frames/second, not 60.

**DPR.** `dpr = Math.min(window.devicePixelRatio || 1, 2)`. Capping at 2 halves fill cost on 3× phones with no perceptible difference for 1px geometry. Set once per resize:
```
canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr)
canvas.style.width = cssW + 'px';      canvas.style.height = cssH + 'px'
ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
```
Never `ctx.scale()` inside `draw`. Every coordinate goes through `snap(v) = Math.round(v * dpr) / dpr`.

**GC churn — the rules:**
1. No object/array literals inside any `draw()`. Layers own preallocated scratch.
2. The tick sink takes **primitives** (`t, p, q, s`), never a `Tick` object. At 4 ticks/s × 8 subscribers that's 32 objects/s avoided; at 1000× catch-up it's 32,000/s.
3. `quote()` and `book()` return the **same object mutated**. Documented in the interface.
4. Candles live in `Float64Array` ring buffers — zero boxing, and `simBars` persistence is a direct structured clone.
5. Label strings are cached by tick value. The only per-frame allocations are the 1–3 crosshair readout strings.
6. `Indicator.amend()` exists precisely so the forming bar doesn't force an array rebuild every tick.

## C.2 Physics — actual numbers

**Horizontal fling (time axis).** iOS `UIScrollViewDecelerationRateNormal` = 0.998/ms → **0.135 per second**.
```
v(t)  = v0 · 0.135^t
x(t)  = v0 · (0.135^t − 1) / ln(0.135)          // ln(0.135) = −2.002
total = v0 / 2.002 ≈ 0.4995 · v0                // a 2000 px/s fling glides ~1000 px
```
Stop below **12 px/s**. Integrated analytically per frame from the accumulated `dt`, so a dropped frame doesn't change the trajectory.

**Rubber-band overscroll** — Apple's exact formula, `c = 0.55`, `dim` = plot width:
```
rubber(d, dim) = sign(d) · (1 − 1/(|d|·c/dim + 1)) · dim/c
```
At `d = dim` this shows `0.645·dim` — monotone, saturating, indistinguishable from UIScrollView by feel.

**Spring-back from overscroll** — critically damped, `k = 220`, `ζ = 1` → `c = 2√220 = 29.66`, `ω = 14.83 rad/s`. Settle to 0.5px from 100px ≈ **300ms**.

**Price-axis autoscale** — deliberately *softer*, `k = 90`, `ζ = 1` → `c = 18.97`, settle ≈ **470ms**. Two independent springs (`p0`, `p1`) so an expanding range doesn't translate the chart. **Deadband: do not retarget unless the new bound moves more than 0.35% of the current range** — without this the axis shimmers on every tick and instantly reads as amateur.

**Integration** — semi-implicit Euler at a **fixed 1/240s substep, max 8 substeps/frame** (caps a 33ms stall):
```
a = −k·(x − target) − c·v ;  v += a·h ;  x += v·h
```
Frame-rate independent and unconditionally stable at these constants.

**Pinch-zoom** about the centroid, in bar-index space:
```
span' = clamp(span / s, 12, min(len, 2000))
i0'   = iC − (iC − i0) · (span'/span)
```
Low-pass the raw scale: `s = 0.7·s_prev + 0.3·s_raw` — raw touch distance is jittery enough to be visible.

**Price flash decay.**
- Last-price pill: alpha 1 → 0 over **220ms**, `easeOutCubic` = `1 − (1−t)³`.
- Order-book / position row flash: **380ms**, linear-out (peripheral, so longer).
- **Digit roll:** the displayed last price is a spring (`k = 160`, `ζ = 1`, settle ≈ 350ms) toward the true price, but **snaps instantly when |Δ| > 0.5%** of price. A real move must feel instant; a 1-tick jiggle must feel liquid. This one detail is most of what reads as "expensive".

**Crosshair** — no smoothing on the position (a lagging crosshair feels broken). The magnetise-to-candle snap animates over **90ms** `easeOutQuad` when the index changes.

**Timeframe change** — cross-fade old→new candle bitmaps over **180ms** `easeOutCubic`. A hard cut on timeframe switch is the most jarring moment in most charts.

**New candle opens** — when following, the right-edge gap animates by exactly one bar width over **200ms** so the chart breathes instead of stepping.

All of the above is disabled under `prefers-reduced-motion` (App.css already has that block at line 89) — springs `snap()`, flashes are instant on/off.

## C.3 Backgrounded / closed

- On `visibilitychange → hidden` and on `pagehide`: cancel rAF, clear the pump interval, `flush('hidden')` (world snapshot + dirty accounts + buffered bars), record `savedAtWall = Date.now()`. **Nothing runs while hidden.** No Background Sync, no Periodic Sync — unsupported on iOS, and a market that moved while you weren't watching is exactly right for a trading sim.
- On resume or fresh load:
  ```
  wallElapsed = Date.now() − savedAtWall
  simElapsed  = min(wallElapsed × speed, MAX_CATCHUP_SIM_MS)     // 24h
  ```
- `feed.catchUp(simElapsed, 6, onProgress)` runs an **adaptive chunked loop**: each slice advances `sliceSimMs`, measures its own cost, and rescales `sliceSimMs` so the next slice lands at ~6ms. Between slices it yields with `await new Promise(r => setTimeout(r, 0))` (not `requestIdleCallback` — Safari lacks it). The UI stays fully interactive; the chart shows a determinate 2px `--accent` bar and "Catching up · 3h 12m".
- **Critically: the sim clock never gaps.** Sim time is *defined* as the amount the engine has been advanced. If we cap catch-up at 24h, the sim simply ran slower than wall clock — the RNG stream is unbroken and determinism is intact. There is no "skipped range" to record.
- Cost check: 8h wall × 1× speed = 28,800s × 4 ticks/s = **115k ticks ≈ 10ms total**. At 60× compression, 6.9M ticks ≈ **1.5s**, spread over ~250 yielded slices — invisible.

## C.4 Deterministic replay

**The contract:** *given `(seed, params, quantaElapsed)`, the tick stream is bit-identical, regardless of frame rate, chunking, pause/resume, or a browser restart.*

Mechanics:
1. One `Rng` per symbol, `createRng(seed).fork(symbol)`. `Math.random()` is banned under `lib/trading/{market,broker,options}` and enforced by `purity.test.ts`.
2. The clock advances **only in whole `TICK_QUANTUM_MS` (250ms) steps**; the sub-quantum remainder is banked in `ClockState.residual`. So the number of RNG draws depends solely on the quantum count — never on how the elapsed time was sliced.
3. Within a quantum: `n = rng.poisson(λ·0.25·seasonality)` trades; each consumes a fixed number of draws (inter-arrival, size, side, plus the per-quantum GARCH innovation and jump indicator). Fixed draw count per quantum is what keeps the stream aligned.
4. `MarketState` serialises **everything mutable**: `rng` (4×uint32 + Box–Muller spare), `sigma2`, `ePrev`, `logP`, `trend`, `imbalance`, 24h rolling stats, `quanta`. Restoring and advancing N quanta ≡ never having stopped.
5. Two tests are the whole guarantee:
   - `advanceTo(T)` in one call ≡ 1,000 random-sized calls summing to T (identical tick arrays).
   - snapshot at quantum 500 → JSON round-trip → restore → advance to 1000 ≡ advancing straight to 1000.
6. All arithmetic is `float64` in a fixed order. No `Math.fround`, no worker, no float `sort` in the hot path.
7. `buildChain` and `fundingRate` take no RNG at all — they are pure functions of `(spot, now, params)`, so they replay trivially. Cosmetic open-interest/volume come from a hash of `(strike, expiry)`.

## C.5 Margin / liquidation

**Definitions** (all against `markPrice`, never `last` — this is what real exchanges do and what makes the math defensible):
```
notional      = |qty| · mark
unrealised    = qty · (mark − avgCost)                    // signed qty handles shorts
maintenance   = notional · r − D                          // tiered ladder
posEquity     = margin + unrealised − fundingPaid
liquidate when posEquity ≤ maintenance
```
**Closed-form liquidation price.** With `q = |qty|`, `σ = +1` long / `−1` short, `M` = margin, `E` = avgCost, `r′ = r + liqFeeBps/10000`, `D` = tier deduction:
```
M + σq(L − E) = r′qL − D
⇒ L = (σqE − M − D) / (q(σ − r′))

Long : L = (qE − M − D) / (q(1 − r′))
Short: L = (qE + M + D) / (q(1 + r′))
```
Folding the liquidation fee in as a **rate**, not a lump, is what keeps this closed-form exact (no iteration).

**Cross margin:** `accountEquity = cash + Σ unrealised`; liquidate when `accountEquity < Σ maintenance`. **Partial liquidation:** close the largest-maintenance position first, repeatedly, until `accountEquity ≥ 1.3 × Σ maintenance`. Far better UX than nuking the account, and trivially testable.

**Bankruptcy clamp:** cash floors at 0; the shortfall is recorded as `socialised` on the `liquidation` event and surfaced in the blotter. The account can never go negative from a liquidation (it *can* from short-option assignment — see below).

**Test names (these ARE the spec):**
- `at exactly the liquidation price, marginRatio === 1` (±1e-9)
- `long 1 @ 100, 10×, mm 1%, no fee → L = 90.909090…` (exact, pinned)
- `short 1 @ 100, 10×, mm 1% → L = 108.910891…`
- `higher leverage strictly raises L for a long, strictly lowers it for a short`
- `adding margin strictly lowers L for a long`
- `funding paid moves L monotonically adverse`
- `partial liquidation stops at ratio ≥ 1.3 and leaves the smallest positions open`
- `liquidation never leaves cash < 0; the shortfall appears as socialised`
- `crossing a margin tier makes L jump discontinuously in the documented direction`

**Funding** (`step`, once per `fundingIntervalMs`): `rate = clamp((mark − index)/index / intervalsPerDay + interestRate, ±cap)`. Longs pay when positive. Deterministic from the mark/index spread, so it replays exactly. Booked as a `Trade` with `side: 'funding'` so the blotter tells the whole story.

## C.6 Options expiry & assignment on a synthetic underlying

- **Settlement price = the 30-minute TWAP of the underlying's 1m closes ending at expiry.** Instantaneous last-price settlement feels arbitrary and is gameable (pause at the right moment); a TWAP is what real exchanges use, comes free from the existing 1m aggregator (`mean` of 30 closes), and is exactly deterministic.
- Intrinsic: call `max(0, S − K)`, put `max(0, K − S)`.
- **Cash settlement, not physical delivery.** Physical assignment would need a spot position in a symbol the sim may not trade and would tangle with the margin model. Cash settlement is arithmetically exact, trivially testable, and matches index options. **The UI must display "Cash settled" on every contract** so it doesn't read as a bug.
- Long ITM (> 0.01): `cash += qty · intrinsic · mult`, `exercised = true`.
- Short ITM: `cash −= |qty| · intrinsic · mult`, `assigned = true`. **Cash may go negative here** — that's real. The account records `marginDeficit`, a banner appears, and *opening* orders are blocked until it's cured by a deposit or a liquidation of other positions (cross mode auto-liquidates).
- OTM: expires worthless; `realized = −qty·avgCost·mult` for a long, `+` for a short. `realized` stays consistent with the blotter by construction.
- Short options reserve margin at open via `shortOptionMargin` (CBOE 20% rule: `max(0.20·S − OTM, 0.10·K)·mult + premium`), released on close/expiry.
- Processed inside `step()` when `now ≥ expiry`; since `step` runs on a 1s sim grid, expiry lands within one sim-second of the true instant — deterministic in both live and catch-up paths.

**The one thing that makes catch-up and live identical:** `step()` evaluates triggers, funding, expiry and liquidation **once per closed 1-second sim bar in both paths**. There is no per-tick order path and no bar-OHLC approximation. 24h of catch-up = 86,400 cheap evaluations. Market orders placed by tapping bypass `step` entirely and fill instantly against the live book, which is correct.

---

# D. Risks and traps

**D.1 React 19 StrictMode double-mount.** Dev mounts → unmounts → remounts every component. Three failure modes: two rAF loops, a canvas sized in mount #1 and resized in mount #2, gesture listeners attached twice. Worst: rebuilding the market resets the RNG and produces a **visible price jump on every hot reload**, which will be mistaken for an engine bug for days.
Mitigations, frozen: `createChart().destroy()` and `attachGestures()`'s disposer are **idempotent**; the runtime is **refcounted with deferred disposal** (`releaseRuntime` schedules teardown on a macrotask; a re-acquire inside that window cancels it), so 1→0→1 never tears the world down. Never seed from `Math.random()` at mount. Add a dev-only assertion that at most one rAF loop and one pump interval exist.

**D.2 Canvas in jsdom.** `getContext('2d')` returns **`null`** in jsdom without `node-canvas` — which is a native build and must not be added. Answers:
- Keep ≥90% of chart logic outside the renderer: `scale.ts`, `physics.ts`, `format.ts`, hit-testing, layout, tick generation are pure and fully tested.
- Test the renderer against `createFakeCtx()` (§A.4) by asserting on the **ops log**, which also *enforces the perf rules*: "exactly 2 `fill()` per candle pass", "zero `fillStyle` assignments inside the loop", "every `rect` x is on a device-pixel boundary", "≤13 `fillText` per frame". These are better tests than pixel diffs.
- `ResizeObserver`, `matchMedia`, `requestIdleCallback` are absent in jsdom — guard exactly as `Plot.tsx:39` already does.
- jsdom's rAF never fires usefully → tests drive frames with `renderNow(nowMs)`.
- `structuredClone` of `Float64Array` works in fake-indexeddb; `simBars` round-trip is testable.

**D.3 iOS Safari touch/pointer.**
- **The known one:** React registers `touchstart`/`touchmove` **passively at the root**, so `onTouchStart` + `preventDefault()` is a no-op. Already documented in this repo at `Keypad.tsx:176-186` and `Modal.tsx:118-120`. The chart **must** use native `addEventListener(..., { passive: false })`. This is baked into `attachGestures`.
- `touch-action: none` goes on the **canvas only**. Per `touchDrag.ts:16-17`, `touch-action` on an ancestor also forbids panning descendants — putting it on the page wrapper would kill the page's own scrolling.
- iOS also fires `gesturestart`/`gesturechange` for pinch; without `preventDefault()` on those (non-passive) the **page** zooms even with `touch-action: none`.
- `pointercancel` fires when Safari reclaims a gesture as a scroll — treat it as a zero-velocity release, never drop the interaction (dropping it strands the crosshair on screen).
- Long-press triggers text selection / the callout menu: `-webkit-touch-callout: none; user-select: none` on the chart container.
- Never size from `window.innerHeight` (the URL bar) — always `ResizeObserver` on the container, plus `visualViewport` awareness as `Modal.tsx:88-91` does.
- The existing `lockScroll()` (`useScrollLock.ts`) is the proven fix for document rubber-band under an overlay; the chart page should set `overscroll-behavior: none` and rely on `touch-action: none` on the canvas.
- Inputs must stay at 16px or iOS zooms on focus (`theme.css:99-104`) — but the order ticket uses `NumberField`, which is `readOnly` + `inputMode="none"`, so this is already handled.

**D.4 PWA precache size.** Current globs are `**/*.{js,css,html,svg,png,woff2}` minus `plotly*`. Rules:
- Lazy-load `TradingPage` exactly like `ImportPage` (`App.tsx:58-60`).
- Trading adds **zero runtime dependencies** — enforced by `purity.test.ts`. Estimated ~150 kB gz across 3 chunks.
- Keep it *in* precache (offline is a selling point at that size), but `manualChunks` the options pricer and the live adapter into separate chunks; the live adapter is dead weight offline.
- Verify no SW route captures `api.binance.com` / `ws-feed.exchange.coinbase.com`. The only route today is `/\/assets\/plotly.*\.js$/`, so we're clean — but add a test asserting the regex doesn't match a Binance URL, because the next person to touch `sw.ts` won't know.
- WebSockets bypass the SW entirely.

**D.5 IndexedDB write volume.** A naive per-tick write would be thousands of commits/minute; IDB commits land on the main thread in Safari and would jank the chart. Frozen policy:
- **The tick loop writes nothing.** All writes go through `flush(reason)`.
- Bars: buffered in memory, one `simBars` row per **500** closed bars, plus on `hidden`.
- Trades: user-initiated trades write immediately (losing one is unacceptable). Liquidation/funding/expiry trades produced during catch-up are `bulkAdd`ed once per slice.
- Equity: sampled at most every **8 sim-seconds** (paper.py's `SNAPSHOT_MIN_GAP`), capped at **4000** points (`MAX_CURVE`), overflow **downsampled 2:1** rather than truncated so the curve keeps its full range. Written in batches of 50.
- Retention: prune `simBars` older than 30 sim-days on idle. Guard with `navigator.storage.estimate()` — above 80% usage, pause bar persistence and warn.
- `resetSandbox()` must be tested to leave `transactions` and `goalMoves` **byte-identical**. That test *is* the sandbox guarantee.

**D.6 Battery.**
- The rAF loop is **demand-driven** and stops scheduling when idle (§C.1). An idle chart at 1× costs ~4 frames/s.
- Zero work while `document.hidden`.
- `speed` capped at 1000× with a warning above 100× (CPU is linear in speed).
- `releaseRuntime()` on page unmount — the sim must not run while the user is on the Budget page.
- `prefers-reduced-motion` disables every spring and flash.

**D.7 Others worth naming now.**
- **`crypto.randomUUID()` is undefined on insecure origins** (http on a LAN IP — exactly how you'd test on a phone). Already a latent issue at `db.ts:560`, but trading generates far more ids. Add `src/lib/trading/ids.ts` with a fallback. Scope the `Math.random` ban to `market/`, `broker/`, `options/` so id generation is exempt — and say so in the ban's comment, or the next agent will "fix" it.
- **Censor mode does not reach canvas.** `:root[data-censor='on'] .money` is CSS on DOM only. Every price, P&L, equity value and axis label the canvas draws must route through `formatPriceForCanvas(v, precision, censor)`. Frozen: `ChartTheme.censor` + exactly one formatter, no layer formats money itself.
- **Thai text on canvas.** `ChartTheme.font` must copy the body stack including `'Noto Sans Thai'` (`theme.css:49`) or Thai renders in a metrics-wrong fallback. Thai has no word spaces — never truncate by character count; use `measureText` + ellipsis.
- **Tabular numerals.** Canvas ignores `font-variant-numeric`. A price readout whose digits change width jitters and is an instant tell. `ChartTheme.fontMono` (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`) is mandatory for **every** number.
- **Ethical/legal framing.** A personal-finance app shipping leverage and options needs an unmistakable gate: a one-time modal (`disclaimerAcceptedAt`) plus a permanent `SIM` badge at the chart's top-left. This also reinforces the sandbox story to the user.
- **Backup bloat.** 30 days of 1m bars would make a 40 MB backup. Bars and `MarketState` are excluded; only the seed + clock travel, and bars regenerate.
- **Number precision.** Never `toFixed` on a Px for storage — only for display, and only through the formatter, using the instrument's `pricePrecision`.

---

# E. The visual-quality bar

To win a blind screenshot comparison against TradingView / Robinhood / Binance / Webull, **all** of the following must be true.

## Candle geometry
- Bar pitch `barW = plotW / span`. Body width `= max(1, barW × 0.72)`, **snapped to device pixels, and forced ODD in device pixels when `barW < 6`** so the 1px wick centres exactly. An off-centre wick at high zoom-out is the single most common tell.
- Wick width: exactly 1 device px below `barW = 8`; 2 device px above `barW = 16`; lerped between. Never a fractional stroke.
- **Every** rect edge through `snap()`. One unsnapped edge produces the grey halo that says "hobby chart".
- Doji (`|o−c| < tickSize/2`): a **1-device-px horizontal line at full body width**, not a zero-height rect (which disappears).
- Progressive degradation: `barW < 2.5` → 1px OHLC line per bar coloured by direction; `barW < 1.2` → filled step-area of closes. TradingView does exactly this; it's why their zoomed-out view stays crisp instead of turning into a smear. **Non-negotiable.**
- Hollow-candle mode (up = hollow with coloured border) as a toggle. Six lines of code, and its absence is noticed.
- **Right-edge gap: always reserve `span × 0.12` bars of empty space right of the newest bar.** A chart glued to the right edge reads as amateur instantly. This is the highest ratio of "perceived quality" to "lines of code" in the whole feature.

## Price axis (right-hand)
- Width = widest label + 16px, recomputed only on label-set change; 8px left padding, fixed.
- 1/2/2.5/5 ladder, **min 34px vertical gap** (touch-legible), max 7 labels.
- Decimals derived from `tickSize`, never from the value — so every label on the axis has the same decimal count, always.
- Last-price pill: full axis width, up/down background, ink chosen by computed luminance (white or `#0a0e14`), 4px radius. **It hides any grid label within 18px of it.** Overlapping labels is the #1 tell.
- 1px dashed line (`[4,4] × dpr`) from the pill to the last candle at 45% alpha.
- **Bar-close countdown** under the pill, 10px `fontMono`, `--muted`. Robinhood lacks it, TradingView has it, it costs 15 lines, and it reads as serious.

## Time axis
- 26px tall. Never clip an edge label — drop it instead.
- **Hierarchy is the whole game:** a label crossing a day boundary renders in `--ink` as `MMM D`; within-day labels render in `--muted` as `HH:mm`. This one rule is most of TradingView's time-axis legibility.
- Min gap 64px. `Intl.DateTimeFormat` with the app language, `calendar: 'gregory'` pinned (the rest of the app uses Gregorian in Thai).

## Crosshair readout
- 1px lines at 35% alpha, dashed `[2,3]`.
- Price label in the price axis and time label in the time axis: rounded pills, `--surface-2` bg, 1px `--border`, `--ink` mono text.
- **OHLC legend at the plot's top-left, inside the plot area:** `O 43,210.5  H 43,388.0  L 43,102.2  C 43,301.4  +0.21%` — labels 10px/600 `--muted`, values 12px `fontMono` coloured by the candle's direction. This exact readout is what makes a screenshot *look like* a trading app. Mandatory.
- **On touch, the crosshair follows the finger offset +44px vertically** so the finger doesn't cover the readout. Appears on long-press (260ms) or immediately on a second finger. Missing this is the most common mobile-chart failure.
- Magnetise to the candle's close on y when within 12px.

## Typography
- Two stacks only: prose = the app body stack; numbers = `fontMono`. **Zero exceptions for numbers.**
- Exact sizes: axis 10px/600 `--muted`; crosshair readout 12px/500; legend labels 10px/600 uppercase, letter-spacing 0.4px; big last price 28px/650 mono; position P&L 13px mono.
- Never below 10px on a 2× screen; never above 13px in an axis.
- **Letter-spacing 0.4–0.6px on the uppercase micro-labels.** This single detail is most of the difference between "designed" and "default".

## Colour
- Up/down = `--income` / `--expense` so the page belongs to the app. Derived: fills at 88% opacity, volume bars at 26%.
- **Exactly two new tokens** in `theme.css`: `--chart-grid`, `--chart-axis-bg`. Inventing a palette would break the app's identity and a critic will notice the inconsistency faster than they'd notice a slightly-off green.
- Grid: 1 device px at **6% ink alpha in dark, 8% in light**. Anything stronger and it looks like a spreadsheet. Horizontal only by default; vertical at 4% and **only at major time boundaries**.
- No pure `#fff` or `#000` anywhere.
- **A colour-blind pair** (blue `#2f81f7` / orange `#f0883e`) in settings. TradingView has it; a harsh critic will check.

## Motion
Everything in §C.2, plus: the 180ms timeframe cross-fade and the 200ms one-bar breathe. All off under `prefers-reduced-motion`.

## Empty / loading / error states — the critic will screenshot these
- **Loading: never a spinner over an empty box.** Draw the grid and both axes immediately (they need no data) and a 6%-alpha candle silhouette. Real chrome from frame 1 is the entire trick.
- **Empty account:** not "No data". One sentence + one primary action, in the app's existing `.muted` + button idiom: *"Your simulator starts with ฿0. Fund it to place your first trade."*
- **Feed error (live mode):** an inline pill at the plot's top — `--expense` dot + "Reconnecting…" — never a modal. The chart keeps showing the last data.
- **Catch-up:** a 2px determinate `--accent` bar across the plot top + "Catching up · 3h 12m".
- **Censored:** the axis renders `•••` at **the same measured width** as the widest real label, so nothing reflows when privacy toggles. Nobody does this; it's free polish.

## Layout / spacing
- Plot insets: left 0, right = price-axis width, bottom 26px, top 0. The legend floats *inside* the plot at (10,10) — never in its own band, which wastes 24px of phone screen.
- Volume in the bottom 16% of the plot, **under** the candles at 30% alpha, sharing the x-axis. Never a separate pane on mobile.
- Depth spine 64px on the plot's right edge, horizontal bars at 18% alpha, toggleable.
- On a 390×844 phone: chart ≥ 360px tall (≥ 40% of viewport, or it reads as a widget), then a 44px timeframe segmented row, then the ticket.
- Every tap target ≥ 44×44 CSS px — the timeframe chips especially.

## The order ticket (half the screenshot)
- Buy/Sell as a two-up segmented control tinted `--income`/`--expense`, active side filled.
- Amount via **`NumberField`** (mandatory repo convention — `mode='calc'`, `allowDecimal`), never a raw `<input>`.
- A 25/50/75/100% quick-size row bound to buying power.
- **A leverage slider with the liquidation price updating live beneath it in `--expense`.** This is the single most "real trading app" element on the screen and it costs almost nothing given `liquidationPrice()` is already a closed form.
- The confirm sheet mirrors `previewOrder()` field-for-field, including the short warning (`isShort`, `held`, `shortQty`) that `preview_order` already defines.

---

## Critical files for implementation

- `/Users/suteepornz/Documents/Suttikoon/Fun_Projects/money_tracker/src/analytics/paper.py` — the fill/dust-snap/short/trailing semantics that must be ported exactly (`_apply_fill` 549-589, `_check_funds` 531-546, `_triggered` 786-802, dust snap 650-654).
- `/Users/suteepornz/Documents/Suttikoon/Fun_Projects/money_tracker/web/src/db.ts` — v5 schema, the `ConfigRow` key union at 75-78, and the `getDebts` validate-don't-merge pattern at 369.
- `/Users/suteepornz/Documents/Suttikoon/Fun_Projects/money_tracker/web/src/components/Keypad.tsx` — lines 176-186 are the authoritative example of the native non-passive `touchstart` workaround the chart's gesture layer must copy.
- `/Users/suteepornz/Documents/Suttikoon/Fun_Projects/money_tracker/web/src/components/NumberField.tsx` — the mandatory numeric input for the order ticket.
- `/Users/suteepornz/Documents/Suttikoon/Fun_Projects/money_tracker/web/src/lib/backup/backup.ts` — `BACKUP_VERSION` 6 → 7 and the `Backup` shape.
- `/Users/suteepornz/Documents/Suttikoon/Fun_Projects/money_tracker/tests/test_paper_orders.py` — the 13 pinned behaviours that must survive as TS tests.