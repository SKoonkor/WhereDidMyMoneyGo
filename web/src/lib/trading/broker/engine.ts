// The broker engine — the thing that turns a tap into a position.
//
// Port of src/analytics/paper.py's `place_order`, `preview_order`, `process`,
// `deposit`, `withdraw` and `cancel_order`, with the parts paper.py did not have
// (leverage, funding, expiry, liquidation) folded into one clock-driven cycle.
//
// Two rules shape everything here:
//
//   1. The world is INJECTED. Every price and the current time come through a
//      MarketView, so this file has no market engine, no database and no clock of
//      its own, and a unit test replaces the entire world with twenty lines.
//
//   2. There is ONE code path for live and for catch-up. `step()` runs its cycle
//      once per elapsed BROKER_STEP_MS and works through missed steps in order, so
//      a day fast-forwarded in 200ms produces exactly the fills that a day watched
//      live would have produced. The alternative — a per-tick path live and a
//      bar-approximation path for catch-up — is the classic source of "my stop
//      filled at a different price after I reloaded".
//
// Errors are machine codes, never English. paper.py raises prose straight into the
// UI; this app ships EN and TH, so a sentence has to be assembled in the React
// layer from a code plus variables.
import { orderId, uuid } from '../ids'
import {
  BROKER_STEP_MS,
  FUNDS_EPS,
  MAX_CATCHUP_SIM_MS,
  SNAPSHOT_MIN_GAP_MS,
  type Instrument,
  type OrderType,
  type Px,
  type Qty,
  type Side,
  type SimTime,
} from '../types'
import { applyFill, checkFunds, instrumentLabel, marketOpenNow, qtyFromSpec, sessionDay, snapQty, triggered } from './fills'
import {
  DEFAULT_TIERS,
  fundingRate,
  initialMargin,
  liquidate,
  liquidationPrice,
  LIQ_TARGET_RATIO,
  marginSummary,
  markOf,
  type MarginTier,
} from './margin'
import {
  DEFAULT_SETTINGS,
  instMult,
  tradeError,
  type BrokerAccount,
  type BrokerEvent,
  type ExpiryOutcome,
  type MarketView,
  type Order,
  type Position,
  type Trade,
  type TradeError,
  type TradeErrorCode,
} from './types'

export type { MarketView, BrokerEvent } from './types'

// ── Requests and results ─────────────────────────────────────────────────────

export interface OrderRequest {
  symbol: string
  side: Side
  type: OrderType
  /** `dollars` is the "spend ฿5,000 of this" mode — resolved to a quantity at the
   *  reference price and then locked, so confirming buys what was previewed. */
  mode: 'shares' | 'dollars'
  qty: number
  limit?: number
  stop?: number
  /** PERCENT. */
  trail?: number
  leverage?: number
  reduceOnly?: boolean
  tif?: 'gtc' | 'ioc' | 'day'
}

export interface OrderPreview {
  label: string
  symbol: string
  side: Side
  type: OrderType
  qty: Qty
  mult: number
  price: Px | null
  /** True when `price` is an estimate that the fill may not match. */
  approx: boolean
  est: number | null
  fee: number
  isOption: boolean
  /** Port of preview_order's `is_short` / `held` / `short_qty`: the three numbers
   *  the confirmation sheet needs to say "this opens a 50-share short". */
  isShort: boolean
  held: Qty
  shortQty: Qty
  leverage?: number
  initialMargin?: number
  liqPrice?: Px | null
  /** Account health if this order fills — the number that stops a user opening
   *  the position that liquidates them one tick later. */
  afterMarginLevel?: number
  /** Advisory, non-blocking. `market-closed` is paper.py's `queued_open`. */
  warnings: TradeErrorCode[]
}

export type PlaceResult =
  | { ok: true; outcome: 'filled'; order: Order; trade: Trade }
  | { ok: true; outcome: 'queued'; order: Order }
  | { ok: false; error: TradeError }

/**
 * The seam to the options workstream.
 *
 * `step()` owns the TIMING of expiry — it is the only thing that knows the sim
 * clock crossed 08:00Z on a Friday — and options/expiry.ts owns the settlement
 * MATH. Injecting the settler keeps broker/ from importing options/, which is
 * what lets the two be built in parallel.
 */
export interface StepHooks {
  /** `settleExpiries` from options/expiry.ts, adapted. Return one outcome per
   *  position; the engine applies the cash and removes the positions. */
  settle?: (positions: Position[], m: MarketView, now: SimTime) => ExpiryOutcome[]
  /** Maintenance ladder override, so a test can pin a flat 1%. */
  tiers?: readonly MarginTier[]
}

// ── Account lifecycle ────────────────────────────────────────────────────────

export function createAccount(o: {
  id: string
  name: string
  currency: string
  startCash: number
  now: SimTime
}): BrokerAccount {
  return {
    id: o.id,
    name: o.name,
    createdAt: o.now,
    currency: o.currency,
    cash: o.startCash,
    startCash: o.startCash,
    // Opening capital IS a contribution. Seeding this to 0 would report the
    // starting balance as a profit the moment the account was created.
    contributed: o.startCash,
    realized: 0,
    positions: {},
    orders: [],
    orderSeq: 0,
    watchlist: [],
    settings: { ...DEFAULT_SETTINGS },
    lastFundingAt: o.now,
    lastStepAt: o.now,
    marginDeficit: 0,
  }
}

// ── Shared resolution (port of paper.py `_resolve_trade`) ────────────────────

interface Resolved {
  meta: Instrument
  mult: number
  /** The live mark, or undefined when the feed has nothing. */
  live: Px | undefined
  /** `live` with a 0 fallback — paper.py's `ref`. */
  ref: Px
  qty: Qty
  /** Signed holding BEFORE the order. */
  held: Qty
}

function resolve(a: BrokerAccount, m: MarketView, r: OrderRequest): Resolved | { error: TradeError } {
  if (!r.symbol || !r.symbol.trim()) return { error: tradeError('no-symbol') }
  const meta = m.instrument(r.symbol.trim())
  if (!meta) return { error: tradeError('unknown-instrument', { symbol: r.symbol }) }

  const mult = instMult(meta)
  const q = m.quote(meta.symbol)
  const live = q ? q.markPrice : undefined
  if (live === undefined && r.type === 'market') {
    return { error: tradeError('no-quote', { symbol: meta.symbol }) }
  }
  if (meta.kind === 'option' && m.now() >= meta.expiry) {
    return { error: tradeError('option-expired', { symbol: meta.symbol }) }
  }

  const ref = live ?? 0
  // paper.py passes `ref or 1.0`: in $-mode with no quote the amount becomes the
  // quantity rather than dividing by zero. Kept, so the two agree on that edge.
  const spec = qtyFromSpec({ mode: r.mode, qty: r.qty }, ref || 1, mult)
  if ('error' in spec) return { error: spec.error }

  const pos = a.positions[meta.symbol]
  const held = pos ? pos.qty : 0
  const qty = snapQty(held, r.side, spec.qty)
  if (!(qty > 0)) return { error: tradeError(r.mode === 'dollars' ? 'bad-amount' : 'bad-qty') }

  return { meta, mult, live, ref, qty, held }
}

/** Whether the order would create or enlarge exposure, as opposed to reducing it. */
function opens(held: Qty, side: Side, qty: Qty): boolean {
  if (side === 'buy') return held >= 0 || qty > Math.abs(held)
  return held <= 0 || qty > held
}

/** Leverage the request asks for, clamped to what the venue and account allow. */
function leverageFor(a: BrokerAccount, meta: Instrument, r: OrderRequest): number | TradeError {
  if (meta.kind !== 'perp') return 1
  const want = r.leverage ?? 1
  const cap = Math.min(a.settings.maxLeverage, meta.maxLeverage)
  if (!(want >= 1) || want > cap) return tradeError('exceeds-leverage', { want, cap })
  return want
}

/**
 * Collateral check.
 *
 * Cash instruments go through paper.py's `checkFunds` unchanged. Perps do not:
 * they are collateralised by reserved margin, not by notional cash, so the test
 * is whether free equity covers the initial margin the order adds.
 */
function affordable(
  a: BrokerAccount,
  m: MarketView,
  meta: Instrument,
  side: Side,
  qty: Qty,
  price: Px,
  leverage: number,
  tiers: readonly MarginTier[],
): TradeError | null {
  if (meta.kind !== 'perp') return checkFunds(a, meta, side, qty, price)
  const pos = a.positions[meta.symbol]
  const held = pos ? pos.qty : 0
  if (!opens(held, side, qty)) return null // reducing risk never needs collateral
  const add = initialMargin(qty, price, leverage)
  const free = marginSummary(a, m, tiers).free
  if (add > free + FUNDS_EPS) {
    return tradeError('insufficient-collateral', { need: add, have: free })
  }
  return null
}

// ── Applying a fill ──────────────────────────────────────────────────────────

function feeFor(a: BrokerAccount, type: OrderType, notional: number): number {
  // A resting limit order is the maker; everything else crosses the spread.
  const bps = type === 'limit' ? a.settings.makerFeeBps : a.settings.takerFeeBps
  return (notional * bps) / 10_000
}

/**
 * Mutate the account for a fill and build its blotter row.
 *
 * The one place the port bends: `applyFill` returns paper.py's exact
 * `cash -= signed * price * mult`, and that is right for a cash instrument, but a
 * perp never had its notional taken out of cash — only margin was reserved. So a
 * perp's cash moves by realized P/L. Using the cash-account rule on a perp would
 * charge the full notional for a 20x position and make leverage meaningless.
 */
function execute(
  a: BrokerAccount,
  m: MarketView,
  meta: Instrument,
  side: Side,
  qty: Qty,
  price: Px,
  type: OrderType,
  leverage: number,
  note: string,
): Trade {
  const mult = instMult(meta)
  const notional = qty * price * mult
  const fee = feeFor(a, type, notional)
  const pos = a.positions[meta.symbol] ?? null
  const r = applyFill(pos, meta, side, qty, price, fee, m.now())

  a.cash += (meta.kind === 'perp' ? r.realized : r.cashDelta) - fee
  a.realized += r.realized

  if (r.position) {
    if (meta.kind === 'perp') {
      // Re-reserve margin at the new size. Scaling the old reservation instead
      // would drift after a flip, where the basis resets.
      r.position.leverage = leverage
      r.position.margin = initialMargin(r.position.qty, r.position.avgCost, leverage)
    }
    a.positions[meta.symbol] = r.position
  } else {
    delete a.positions[meta.symbol]
  }

  return {
    id: uuid(),
    t: m.now(),
    accountId: a.id,
    symbol: meta.symbol,
    label: instrumentLabel(meta),
    kind: meta.kind,
    side,
    qty,
    price,
    value: notional,
    fee,
    realized: r.realized,
    note,
  }
}

/** Adverse slippage on the order types that actually suffer it. A limit order
 *  fills at the price that crossed it (paper.py's behaviour, and better than the
 *  limit); a stop or a market-on-open takes what the book gives. */
function slipped(a: BrokerAccount, price: Px, side: Side, type: OrderType): Px {
  if (type === 'limit') return price
  const bps = a.settings.slippageBps / 10_000
  return side === 'buy' ? price * (1 + bps) : price * (1 - bps)
}

function newOrder(a: BrokerAccount, meta: Instrument, r: OrderRequest, qty: Qty, ref: Px, leverage: number, now: SimTime): Order {
  a.orderSeq += 1
  const o: Order = {
    id: orderId(a.orderSeq),
    seq: a.orderSeq,
    accountId: a.id,
    symbol: meta.symbol,
    kind: meta.kind,
    side: r.side,
    type: r.type,
    qty,
    status: 'open',
    createdAt: now,
    tif: r.tif ?? 'gtc',
  }
  if (r.limit !== undefined && Number.isFinite(r.limit)) o.limit = r.limit
  if (r.stop !== undefined && Number.isFinite(r.stop)) o.stop = r.stop
  if (r.trail !== undefined && Number.isFinite(r.trail)) o.trail = r.trail
  // paper.py seeds `peak` with the reference price, so a trailing stop starts
  // trailing from where it was placed and not from the first tick it happens to
  // see — the difference is a stop that fires immediately on a gap.
  if (r.type === 'trailing') o.peak = ref || undefined
  if (r.reduceOnly) o.reduceOnly = true
  if (meta.kind === 'perp') o.leverage = leverage
  if (meta.kind === 'option') {
    o.underlying = meta.underlying
    o.expiry = meta.expiry
    o.right = meta.right
    o.strike = meta.strike
  }
  return o
}

/** Port of the type-specific validation in place_order (lines 696–701). */
function missingTrigger(r: OrderRequest): TradeError | null {
  if (r.type === 'limit' && !Number.isFinite(r.limit as number)) return tradeError('missing-limit')
  if (r.type === 'stop' && !Number.isFinite(r.stop as number)) return tradeError('missing-stop')
  if (r.type === 'trailing' && !r.trail) return tradeError('missing-trail')
  return null
}

// ── previewOrder ─────────────────────────────────────────────────────────────

/**
 * Non-mutating dry run — port of paper.py `preview_order` (712+).
 *
 * Returns everything the confirmation sheet shows AND the numbers that make it a
 * safety net rather than decoration: whether this opens a short, what margin
 * level the account lands on, and where the liquidation would be.
 */
export function previewOrder(
  a: BrokerAccount,
  m: MarketView,
  r: OrderRequest,
  tiers: readonly MarginTier[] = DEFAULT_TIERS,
): OrderPreview | { error: TradeError } {
  const res = resolve(a, m, r)
  if ('error' in res) return res
  const { meta, mult, live, ref, qty, held } = res

  const lev = leverageFor(a, meta, r)
  if (typeof lev !== 'number') return { error: lev }

  const trigger = missingTrigger(r)
  if (trigger) return { error: trigger }

  let price: Px | null
  let approx: boolean
  if (r.type === 'limit') {
    price = r.limit as number
    approx = false
  } else if (r.type === 'stop') {
    price = r.stop as number
    approx = false
  } else if (r.type === 'trailing') {
    price = ref
    approx = true
  } else {
    price = live ?? null
    approx = true
  }

  const est = price ? qty * price * mult : null
  const fee = est ? feeFor(a, r.type, est) : 0
  const longHeld = Math.max(held, 0)

  const warnings: TradeErrorCode[] = []
  if (a.settings.marketHoursOnly && r.type === 'market' && !marketOpenNow(meta.kind, meta.symbol, m.now())) {
    warnings.push('market-closed') // paper.py `queued_open`
  }
  if (a.marginDeficit > 0 && opens(held, r.side, qty)) warnings.push('margin-deficit')
  if (price) {
    const err = affordable(a, m, meta, r.side, qty, price, lev, tiers)
    if (err) warnings.push(err.code)
  }

  const out: OrderPreview = {
    label: instrumentLabel(meta),
    // paper.py shows the UNDERLYING for an option, so the sheet reads "AAPL"
    // rather than the pipe-delimited contract key.
    symbol: meta.kind === 'option' ? meta.underlying : meta.symbol,
    side: r.side,
    type: r.type,
    qty,
    mult,
    price,
    approx,
    est,
    fee,
    isOption: meta.kind === 'option',
    // The 1e-9 is paper.py's: a full close must not read as opening a short.
    isShort: r.side === 'sell' && qty > longHeld + 1e-9,
    held: longHeld,
    shortQty: Math.max(0, qty - longHeld),
    warnings,
  }

  if (meta.kind === 'perp' && price) {
    out.leverage = lev
    out.initialMargin = initialMargin(qty, price, lev)
    const after = simulate(a, m, meta, r.side, qty, price, r.type, lev)
    out.afterMarginLevel = marginSummary(after, m, tiers).marginLevel
    const p = after.positions[meta.symbol]
    out.liqPrice = p ? liquidationPrice(p, a.settings, tiers) : null
  } else if (price) {
    const after = simulate(a, m, meta, r.side, qty, price, r.type, lev)
    out.afterMarginLevel = marginSummary(after, m, tiers).marginLevel
  }
  return out
}

/** A throwaway account with the fill applied, for "what would this do to me".
 *  Shallow copies are enough: execute() replaces the position object it touches
 *  rather than mutating it, so the real account's objects are never reached. */
function simulate(
  a: BrokerAccount,
  m: MarketView,
  meta: Instrument,
  side: Side,
  qty: Qty,
  price: Px,
  type: OrderType,
  leverage: number,
): BrokerAccount {
  const clone: BrokerAccount = { ...a, positions: { ...a.positions }, orders: a.orders.slice() }
  execute(clone, m, meta, side, qty, price, type, leverage, 'preview')
  return clone
}

// ── placeOrder ───────────────────────────────────────────────────────────────

/**
 * Port of paper.py `place_order` (658+): fill a market order now, or queue
 * anything with a trigger.
 *
 * The market-hours branch is paper.py's realism setting verbatim: with it on and
 * the session closed, a market order QUEUES and fills on the first evaluation of
 * the next session, exactly as a real broker's market-on-open works — rather than
 * filling against a stale last price from Friday.
 */
export function placeOrder(
  a: BrokerAccount,
  m: MarketView,
  r: OrderRequest,
  tiers: readonly MarginTier[] = DEFAULT_TIERS,
): PlaceResult {
  const res = resolve(a, m, r)
  if ('error' in res) return { ok: false, error: res.error }
  const { meta, live, ref, qty, held } = res

  const lev = leverageFor(a, meta, r)
  if (typeof lev !== 'number') return { ok: false, error: lev }

  const opening = opens(held, r.side, qty)
  if (r.reduceOnly && opening) return { ok: false, error: tradeError('reduce-only-would-open') }
  // A short-option assignment can leave the account owing money. Until that is
  // cured, the user may close positions but may not open new ones.
  if (a.marginDeficit > 0 && opening) {
    return { ok: false, error: tradeError('margin-deficit', { deficit: a.marginDeficit }) }
  }

  const trigger = missingTrigger(r)
  if (trigger) return { ok: false, error: trigger }

  if (r.type === 'market') {
    const closed = a.settings.marketHoursOnly && !marketOpenNow(meta.kind, meta.symbol, m.now())
    if (!closed) {
      // The book walk, so a large order pays the impact it causes; the flat mark
      // is only the fallback for a view that cannot price depth.
      const price = m.fillPrice(meta.symbol, r.side, qty) ?? live
      if (price === undefined) return { ok: false, error: tradeError('no-quote', { symbol: meta.symbol }) }
      const err = affordable(a, m, meta, r.side, qty, price, lev, tiers)
      if (err) return { ok: false, error: err }

      const order = newOrder(a, meta, r, qty, ref, lev, m.now())
      const trade = execute(a, m, meta, r.side, qty, price, r.type, lev, 'market')
      order.status = 'filled'
      order.fillPrice = price
      order.filledAt = m.now()
      // Kept on the account even though paper.py records no order for an instant
      // fill: the order list is the user's history, and a market fill that leaves
      // no trace there reads as a missing order.
      a.orders.push(order)
      return { ok: true, outcome: 'filled', order, trade }
    }
  }

  const order = newOrder(a, meta, r, qty, ref, lev, m.now())
  a.orders.push(order)
  return { ok: true, outcome: 'queued', order }
}

export function cancelOrder(a: BrokerAccount, id: string): boolean {
  for (const o of a.orders) {
    if (o.id === id && o.status === 'open') {
      o.status = 'cancelled'
      o.note = 'user'
      return true
    }
  }
  return false
}

// ── Cash ─────────────────────────────────────────────────────────────────────

/**
 * Port of paper.py `deposit`. Raises `cash` AND `contributed` together, which is
 * the entire point: total P/L is measured against contributed capital, so moving
 * money in can never read as a gain.
 */
export function deposit(a: BrokerAccount, m: MarketView, amount: number): PlaceResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: tradeError('bad-amount') }
  a.cash += amount
  a.contributed += amount
  // A deposit is the cure for an assignment deficit.
  if (a.marginDeficit > 0) a.marginDeficit = Math.max(0, a.marginDeficit - amount)
  return { ok: true, outcome: 'filled', order: cashOrder(a, m, 'deposit'), trade: cashTrade(a, m, 'deposit', amount) }
}

/** Port of paper.py `withdraw`: only free cash leaves, positions are never sold
 *  to fund it, and the basis drops with the cash. */
export function withdraw(a: BrokerAccount, m: MarketView, amount: number): PlaceResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: tradeError('bad-amount') }
  if (amount > a.cash + FUNDS_EPS) {
    return { ok: false, error: tradeError('insufficient-funds', { need: amount, have: a.cash }) }
  }
  a.cash -= amount
  a.contributed = Math.max(0, a.contributed - amount)
  return { ok: true, outcome: 'filled', order: cashOrder(a, m, 'withdraw'), trade: cashTrade(a, m, 'withdraw', amount) }
}

function cashTrade(a: BrokerAccount, m: MarketView, side: 'deposit' | 'withdraw', amount: number): Trade {
  return {
    id: uuid(),
    t: m.now(),
    accountId: a.id,
    symbol: '',
    label: a.currency,
    kind: 'spot',
    side,
    qty: null,
    price: null,
    value: amount,
    fee: 0,
    realized: 0,
    note: side,
  }
}

/** PlaceResult's filled arm carries an Order; a cash movement has none. This
 *  synthetic record satisfies the shape and is deliberately NOT added to
 *  `a.orders`, where it would pollute the user's order history. */
function cashOrder(a: BrokerAccount, m: MarketView, note: string): Order {
  return {
    id: uuid(),
    seq: 0,
    accountId: a.id,
    symbol: '',
    kind: 'spot',
    side: 'buy',
    type: 'market',
    qty: 0,
    status: 'filled',
    createdAt: m.now(),
    tif: 'gtc',
    note,
  }
}

// ── step ─────────────────────────────────────────────────────────────────────

/**
 * Advance the account to `m.now()`, running the cycle once per elapsed
 * BROKER_STEP_MS and working through missed steps in order.
 *
 * `lastStepAt` holds the last GRID POINT processed, never `now`: banking the
 * sub-second residual is what makes a thousand one-second calls identical to one
 * thousand-second call. Rounding it to `now` would drop up to 999ms per call and
 * make funding intervals drift apart between the live and catch-up paths.
 */
export function step(a: BrokerAccount, m: MarketView, out: BrokerEvent[], hooks?: StepHooks): void {
  const now = m.now()
  if (!(a.lastStepAt > 0) || a.lastStepAt > now) {
    // First run, or the clock moved backwards (a restored snapshot). Sync and
    // wait: replaying an unbounded gap would fire every stop the price ever
    // crossed while the app was shut.
    a.lastStepAt = now
    return
  }
  // types.ts: past the cap the sim simply ran slower than the wall clock. Sim
  // time is DEFINED as how far the engine has been advanced, so there is no gap
  // to make up and determinism is untouched.
  let t = Math.max(a.lastStepAt, now - MAX_CATCHUP_SIM_MS)

  // One time-shifted view for the whole catch-up, mutated per step rather than
  // re-allocated: 24h of catch-up is 86,400 steps.
  const view = viewAt(m)
  while (now - t >= BROKER_STEP_MS) {
    t += BROKER_STEP_MS
    view.t = t
    stepOnce(a, view, t, out, hooks)
  }
  a.lastStepAt = t
}

/** The MarketView as of an arbitrary instant. Everything inside a step reads the
 *  time from here, so a trade booked during catch-up carries the sim time it
 *  actually happened at rather than the time the catch-up finished. */
function viewAt(m: MarketView): MarketView & { t: SimTime } {
  return {
    t: 0,
    now() {
      return this.t
    },
    quote: (s) => m.quote(s),
    fillPrice: (s, side, q) => m.fillPrice(s, side, q),
    instrument: (s) => m.instrument(s),
    recentCloses: (s, c) => m.recentCloses(s, c),
  }
}

function stepOnce(a: BrokerAccount, m: MarketView, t: SimTime, out: BrokerEvent[], hooks?: StepHooks): void {
  const tiers = hooks?.tiers ?? DEFAULT_TIERS
  markPositions(a, m)
  chargeFunding(a, m, t, out)
  settleExpiries(a, m, t, out, hooks)
  const filled = runOrders(a, m, t, out, tiers)

  const before = marginSummary(a, m, tiers)
  if (before.marginRatio < 1) liquidate(a, m, out, tiers)

  // Equity sampling. paper.py throttled on the WALL clock (SNAPSHOT_MIN_GAP);
  // that cannot work here, because catch-up would emit one point for a whole
  // day. Keying off the sim grid instead is stateless AND identical in both
  // paths — the same instants are sampled however the time was sliced.
  const sample = t % SNAPSHOT_MIN_GAP_MS < BROKER_STEP_MS
  if (sample || filled) {
    const s = marginSummary(a, m, tiers)
    out.push({ type: 'equity', t, v: s.equity })
    if (sample && s.maintenance > 0 && s.marginRatio < LIQ_TARGET_RATIO) {
      out.push({ type: 'margin-call', marginLevel: s.marginLevel })
    }
  }
}

/** paper.py `mark_all`, minus the network: the feed already has the prices. */
function markPositions(a: BrokerAccount, m: MarketView): void {
  for (const pos of Object.values(a.positions)) {
    const q = m.quote(pos.symbol)
    if (q) pos.mark = q.markPrice
  }
}

function chargeFunding(a: BrokerAccount, m: MarketView, t: SimTime, out: BrokerEvent[]): void {
  const interval = a.settings.fundingIntervalMs
  if (!(interval > 0)) return
  if (!(a.lastFundingAt > 0)) {
    a.lastFundingAt = t
    return
  }
  while (t - a.lastFundingAt >= interval) {
    a.lastFundingAt += interval
    for (const pos of Object.values(a.positions)) {
      if (pos.kind !== 'perp' || pos.qty === 0) continue
      const q = m.quote(pos.symbol)
      if (!q) continue
      const rate = fundingRate(q.markPrice, q.indexPrice, a.settings)
      // Signed by qty, so a long PAYS a positive rate and a short receives it.
      const amount = pos.qty * q.markPrice * rate
      a.cash -= amount
      pos.fundingPaid = (pos.fundingPaid ?? 0) + amount
      out.push({ type: 'funding', symbol: pos.symbol, amount, rate })
      out.push({
        type: 'fill',
        trade: {
          id: uuid(),
          t,
          accountId: a.id,
          symbol: pos.symbol,
          label: pos.symbol,
          kind: 'perp',
          side: 'funding',
          qty: pos.qty,
          price: q.markPrice,
          value: amount,
          fee: 0,
          realized: 0,
          note: 'funding',
        },
      })
    }
  }
}

/**
 * Expiry TIMING. The settlement math is the options workstream's, injected as
 * `hooks.settle`.
 *
 * Without a settler the position stays on the book and a single event fires on
 * the step that crosses the expiry instant — once, not once per second — so a
 * broker wired up without options is noisy about the gap rather than silently
 * spinning on it.
 */
function settleExpiries(
  a: BrokerAccount,
  m: MarketView,
  t: SimTime,
  out: BrokerEvent[],
  hooks?: StepHooks,
): void {
  const expired: Position[] = []
  const crossing: Position[] = []
  for (const pos of Object.values(a.positions)) {
    if (pos.kind !== 'option' || pos.expiry === undefined) continue
    if (pos.expiry > t) continue
    expired.push(pos)
    if (pos.expiry > t - BROKER_STEP_MS) crossing.push(pos)
  }
  if (!expired.length) return

  if (!hooks?.settle) {
    for (const pos of crossing) {
      out.push({
        type: 'expiry',
        outcome: {
          symbol: pos.symbol,
          qty: pos.qty,
          settlementPrice: 0,
          intrinsic: 0,
          cash: 0,
          realized: 0,
          exercised: false,
          assigned: false,
        },
      })
    }
    return
  }

  for (const o of hooks.settle(expired, m, t)) {
    const pos = a.positions[o.symbol]
    a.cash += o.cash
    a.realized += o.realized
    delete a.positions[o.symbol]
    // C.6: a short assignment CAN drive cash negative, and that is real. Record
    // the deficit so opening orders are blocked until it is cured.
    if (a.cash < 0) {
      a.marginDeficit = -a.cash
    }
    out.push({ type: 'expiry', outcome: o })
    out.push({
      type: 'fill',
      trade: {
        id: uuid(),
        t,
        accountId: a.id,
        symbol: o.symbol,
        label: pos ? instrumentLabel(pos) : o.symbol,
        kind: 'option',
        side: 'settlement',
        qty: o.qty,
        price: o.settlementPrice,
        value: o.cash,
        fee: 0,
        realized: o.realized,
        note: o.assigned ? 'assigned' : o.exercised ? 'exercised' : 'expired',
      },
    })
  }
}

/**
 * Port of paper.py `process` (806+): fill every pending order whose trigger the
 * price has crossed, and cancel the ones that can no longer be funded.
 *
 * The market-hours guard is paper.py's, including the subtle half: while the
 * session is closed nothing fills AND trail peaks do not move, because
 * `triggered()` is never reached.
 */
function runOrders(
  a: BrokerAccount,
  m: MarketView,
  t: SimTime,
  out: BrokerEvent[],
  tiers: readonly MarginTier[],
): boolean {
  let filled = false
  const hoursOnly = a.settings.marketHoursOnly
  for (const o of a.orders) {
    if (o.status !== 'open') continue

    if (o.tif === 'day' && sessionDay(o.createdAt) !== sessionDay(t)) {
      o.status = 'expired'
      out.push({ type: 'order-cancelled', order: o, reason: 'day-expired' })
      continue
    }
    if (hoursOnly && !marketOpenNow(o.kind, o.symbol, t)) continue

    const meta = m.instrument(o.symbol)
    if (!meta) continue
    const q = m.quote(o.symbol)
    if (!q) continue
    if (!triggered(o, q.markPrice)) {
      // An IOC order that did not fill the moment it became eligible is done.
      if (o.tif === 'ioc') {
        o.status = 'cancelled'
        out.push({ type: 'order-cancelled', order: o, reason: 'ioc' })
      }
      continue
    }

    const price = slipped(a, q.markPrice, o.side, o.type)
    const lev = o.leverage ?? 1
    const err = affordable(a, m, meta, o.side, o.qty, price, lev, tiers)
    if (err) {
      o.status = 'cancelled'
      o.note = err.code
      out.push({ type: 'order-cancelled', order: o, reason: err.code })
      continue
    }

    const trade = execute(a, m, meta, o.side, o.qty, price, o.type, lev, o.type)
    o.status = 'filled'
    o.fillPrice = price
    o.filledAt = t
    filled = true
    out.push({ type: 'fill', trade, order: o })
  }
  return filled
}

/** Re-exported so callers can value a position without importing margin.ts. */
export { markOf }
