// The `MarketView` the broker is driven through, and the option prices the feed
// does not have.
//
// The market engine simulates SPOT instruments only: it knows BTCUSDT, it has
// never heard of `BTCUSDT|2026-08-14|call|70000`. The broker, meanwhile, asks the
// view for a quote and an instrument for whatever symbol an order names — so
// without this adapter every option order would come back `no-quote` and the
// options page would be a table you cannot trade from.
//
// The seam is exactly where the architecture put it: broker/ never imports
// options/, and options/ never learns about the feed. This file is the only place
// that knows both exist.

import { bs, type Greeks } from '../../lib/trading/options/bs'
import {
  buildChain, parseOptionSymbol, surfaceVol,
  type ChainParams, type OptionChain, type VolSurface,
} from '../../lib/trading/options/chain'
import { settleExpiries, twapFromCandles } from '../../lib/trading/options/expiry'
import type { MarketFeed } from '../../lib/trading/market/feed'
import type { MarketView } from '../../lib/trading/broker/engine'
import type { ExpiryOutcome, Position, PositionGreeks } from '../../lib/trading/broker/types'
import type { Candle, Instrument, Px, Qty, Quote, Side, SimTime } from '../../lib/trading/types'
import { OPTION_MULT, TF_MS } from '../../lib/trading/types'

const MS_PER_DAY = 86_400_000
const DAYS_PER_YEAR = 365

/**
 * The perpetual twin of a spot symbol.
 *
 * The market engine only ever produces SPOT instruments — `instrumentFor` in
 * feed.ts hard-codes `kind: 'spot'` — and the broker refuses leverage on anything
 * that is not a perp (`leverageFor`: `if (meta.kind !== 'perp') return 1`). So
 * without this the leverage slider and the liquidation price §E asks for would be
 * decoration attached to nothing.
 *
 * It is a derived VIEW of the same market, not a second simulation: the perp
 * marks and fills against its underlying's book, tick for tick. That is also what
 * a real linear perp does, which is why the suffix is the only thing that has to
 * be invented.
 */
export const PERP_SUFFIX = '.P'

export const isPerpSymbol = (s: string) => s.endsWith(PERP_SUFFIX)
export const perpOf = (spot: string) => spot + PERP_SUFFIX
export const spotOf = (perp: string) => (isPerpSymbol(perp) ? perp.slice(0, -PERP_SUFFIX.length) : perp)

/** Venue cap. The account's own `settings.maxLeverage` (20) is the binding one in
 *  practice; this is the instrument's side of the same limit. */
const PERP_MAX_LEVERAGE = 25
const FUNDING_INTERVAL_MS = 28_800_000

/**
 * One surface for the whole sandbox.
 *
 * Crypto-shaped on purpose: a 60% ATM, a mildly upward term structure and a
 * negative skew, which is the shape every real chain has and the reason a put
 * one strike below spot costs more than the call one strike above. A flat surface
 * would price a symmetric chain, and a symmetric chain is the single clearest
 * sign that an options screen is decorative.
 */
export const DEFAULT_SURFACE: VolSurface = {
  atmVol: 0.6,
  termSlope: 0.06,
  skew: -0.12,
  smile: 0.08,
}

/** Risk-free and carry. Fixed rather than configurable: they move an option's
 *  price by less than the spread at these tenors, and a second slider that
 *  changes nothing visible is worse than no slider. */
export const RATE = 0.04
export const CARRY = 0

export const CHAIN: Omit<ChainParams, 'underlying'> = {
  strikeSteps: 7,
  strikeStepPct: 0.025,
  r: RATE,
  q: CARRY,
  surface: DEFAULT_SURFACE,
  // 150 bps of half-spread. Wide enough that round-tripping a contract costs
  // something — the lesson short-dated options exist to teach — and tight enough
  // that the bid/ask columns do not look broken.
  spreadBps: 150,
  multiplier: OPTION_MULT,
}

export function chainParams(underlying: string): ChainParams {
  return { underlying, ...CHAIN }
}

const yearsTo = (expiry: SimTime, now: SimTime) => Math.max(expiry - now, 0) / MS_PER_DAY / DAYS_PER_YEAR

/** Every candle a series holds, as objects. Only ever called at settlement, which
 *  happens at most a handful of times a day of sim time. */
function candlesOf(feed: MarketFeed, symbol: string): Candle[] {
  const s = feed.series(symbol, '1m')
  if (!s) return []
  const out: Candle[] = []
  for (let i = 0; i < s.length; i++) {
    const k = s.at(i)
    out.push({ t: s.t[k], o: s.o[k], h: s.h[k], l: s.l[k], c: s.c[k], v: s.v[k], n: s.n[k] })
  }
  return out
}

export interface TradingMarketView extends MarketView {
  /** Greeks for a held option, for `positionRows`. Undefined for anything else. */
  greeks(pos: Position, m: MarketView): PositionGreeks | undefined
  /** `StepHooks.settle`, already wired to the TWAP source. */
  settle(positions: Position[], m: MarketView, now: SimTime): ExpiryOutcome[]
  chain(underlying: string, expiry: SimTime): OptionChain | undefined
}

/**
 * Wrap a feed as the world the broker sees.
 *
 * Option quotes are synthesised on demand and cached for the instant they were
 * computed at. The cache is not an optimisation for its own sake: `step()` marks
 * every position once a second and `previewOrder` prices the same contract three
 * times in one call, so without it a five-contract book would run Black-Scholes
 * a few dozen times per simulated second — and during a 24h catch-up that is
 * millions of evaluations for a number that cannot have changed.
 */
export function createMarketView(feed: MarketFeed): TradingMarketView {
  const derived = new Map<string, Instrument>()
  const quoteCache = new Map<string, { t: SimTime; q: Quote }>()

  function optionInstrument(symbol: string): Instrument | undefined {
    const hit = derived.get(symbol)
    if (hit) return hit
    const parsed = parseOptionSymbol(symbol)
    if (!parsed) return undefined
    derived.set(symbol, parsed)
    return parsed
  }

  function perpInstrument(symbol: string): Instrument | undefined {
    const hit = derived.get(symbol)
    if (hit) return hit
    const spot = feed.instrument(spotOf(symbol))
    if (!spot || spot.kind !== 'spot') return undefined
    const inst: Instrument = {
      kind: 'perp',
      symbol,
      underlying: spot.symbol,
      tickSize: spot.tickSize,
      lotSize: spot.lotSize,
      pricePrecision: spot.pricePrecision,
      qtyPrecision: spot.qtyPrecision,
      maxLeverage: PERP_MAX_LEVERAGE,
      fundingIntervalMs: FUNDING_INTERVAL_MS,
    }
    derived.set(symbol, inst)
    return inst
  }

  function instrument(symbol: string): Instrument | undefined {
    const native = feed.instrument(symbol)
    if (native) return native
    if (isPerpSymbol(symbol)) return perpInstrument(symbol)
    return optionInstrument(symbol)
  }

  /** The underlying's quote, re-badged. A COPY, because the market engine returns
   *  the same Quote object every call and mutates it in place — handing that
   *  object out under a different symbol would rename the spot quote too. */
  function perpQuote(symbol: string, now: SimTime): Quote | undefined {
    const cached = quoteCache.get(symbol)
    if (cached && cached.t === now) return cached.q
    const under = feed.quote(spotOf(symbol))
    if (!under) return undefined
    // mark == index by construction. A synthetic basis would move the funding
    // rate around for no modelled reason, and funding that drifts without a cause
    // reads as a bug rather than as a cost.
    const q: Quote = { ...under, symbol, t: now }
    quoteCache.set(symbol, { t: now, q })
    return q
  }

  /** Model price + greeks for a contract at the current spot. */
  function priceOption(inst: Instrument, now: SimTime): { g: Greeks; spot: Px } | undefined {
    if (inst.kind !== 'option') return undefined
    const under = feed.quote(inst.underlying)
    if (!under) return undefined
    const spot = under.markPrice
    const tYears = yearsTo(inst.expiry, now)
    const sigma = surfaceVol(DEFAULT_SURFACE, spot, inst.strike, tYears, RATE)
    return { g: bs({ s: spot, k: inst.strike, tYears, r: RATE, q: CARRY, sigma, right: inst.right }), spot }
  }

  function optionQuote(symbol: string, now: SimTime): Quote | undefined {
    const cached = quoteCache.get(symbol)
    if (cached && cached.t === now) return cached.q
    const inst = optionInstrument(symbol)
    if (!inst || inst.kind !== 'option') return undefined
    const priced = priceOption(inst, now)
    if (!priced) return undefined
    // Never below one tick: a mark of zero makes bid < mark < ask unsatisfiable
    // and leaves a deep wing position impossible to close.
    const mark = Math.max(priced.g.price, inst.tickSize)
    const half = (mark * CHAIN.spreadBps) / 10_000
    const q: Quote = {
      t: now,
      symbol,
      last: mark,
      bid: Math.max(inst.tickSize, mark - half),
      ask: mark + half,
      markPrice: mark,
      indexPrice: mark,
      // An option's own 24h stats would be a second, differently-shaped history to
      // keep. `summarize` excludes options from day-change for exactly this
      // reason, so flat values here are read by nothing.
      open24h: mark,
      high24h: mark,
      low24h: mark,
      volume24h: 0,
    }
    quoteCache.set(symbol, { t: now, q })
    return q
  }

  const view: TradingMarketView = {
    now() {
      return feed.clock.now()
    },

    quote(symbol) {
      const native = feed.quote(symbol)
      if (native) return native
      const now = feed.clock.now()
      return isPerpSymbol(symbol) ? perpQuote(symbol, now) : optionQuote(symbol, now)
    },

    fillPrice(symbol, side: Side, q: Qty) {
      const walked = feed.fillPrice(symbol, side, q)
      if (walked !== undefined) return walked
      // A perp fills against its underlying's book, impact and all — that is what
      // makes it the same market rather than a second one.
      if (isPerpSymbol(symbol)) return feed.fillPrice(spotOf(symbol), side, q)
      // No book for a synthetic contract, so the order crosses the spread — which
      // is the honest answer, and the one that makes an option round-trip cost
      // what it should.
      const oq = optionQuote(symbol, feed.clock.now())
      return oq ? (side === 'buy' ? oq.ask : oq.bid) : undefined
    },

    instrument,

    recentCloses(symbol, count) {
      // A perp has no candles of its own; it settles and marks against the spot
      // series it is derived from.
      const s = feed.series(spotOf(symbol), '1m')
      if (!s || s.length === 0) return undefined
      // The forming bar is excluded: it has no close yet, and settling against a
      // price that has not finished happening is the one thing a TWAP exists to
      // avoid.
      const closed = s.length - 1
      const take = Math.min(Math.max(0, count), closed)
      if (take === 0) return undefined
      const out = new Float64Array(take)
      for (let i = 0; i < take; i++) out[i] = s.c[s.at(closed - take + i)]
      return out
    },

    greeks(pos) {
      if (pos.kind !== 'option') return undefined
      const inst = instrument(pos.symbol)
      if (!inst || inst.kind !== 'option') return undefined
      const priced = priceOption(inst, feed.clock.now())
      return priced?.g
    },

    settle(positions, m, now) {
      return settleExpiries(positions, (underlying) => {
        const bars = candlesOf(feed, underlying)
        // The 30-minute TWAP where there is history, the live mark where there is
        // not — a contract can expire in the first half hour of a fresh sandbox,
        // and refusing to settle it would strand the position forever.
        return twapFromCandles(bars, now) ?? m.quote(underlying)?.markPrice
      }, now)
    },

    chain(underlying, expiry) {
      const q = feed.quote(underlying)
      if (!q) return undefined
      return buildChain(chainParams(underlying), q.markPrice, feed.clock.now(), expiry)
    },
  }
  return view
}

/** Bar length in sim ms, for the chart's close countdown. Re-exported so the
 *  components do not each import the constants table. */
export const barMs = (tf: keyof typeof TF_MS) => TF_MS[tf]
