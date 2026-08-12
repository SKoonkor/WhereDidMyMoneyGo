// One synthetic instrument: its price process, its trades, and its book.
//
// The whole engine advances in whole TICK_QUANTUM_MS steps and nothing else.
// Every number it draws depends only on (seed, state, quantum index), never on
// how the elapsed time was sliced into calls — that single rule is what makes a
// snapshot restorable, a day catchable-up in 200ms, and a bug reportable by
// seed. advanceTo() therefore ignores a partial trailing quantum rather than
// advancing "a bit"; the leftover is the clock's problem, not the market's.
//
// The price process is four things layered, in this order per quantum:
//
//   GARCH(1,1)  volatility clusters, because a market with constant vol looks
//               obviously fake within about ten seconds of watching it
//   Merton      rare jumps, so the chart occasionally does something a diffusion
//               never would
//   OU          a pull toward a slowly wandering trend, which is what keeps a
//               random walk from drifting to zero or to the moon over a week
//   seasonality 48 half-hour multipliers, so an equity is dead at 03:00 UTC and
//               forex peaks on the London/New York overlap
//
// Seasonality multiplies the REALISED shock but is kept out of the GARCH
// recursion. Feeding a seasonally-inflated residual back into sigma2 makes the
// afternoon's vol raise the evening's baseline, which compounds day over day
// until the series explodes — the failure looks like a slow ramp and takes
// hours to attribute.

import { BOOK_REBUILD_MS, TICK_QUANTUM_MS } from '../types'
import type { OrderBook, Px, Qty, Quote, Side, SimTime, TickSink } from '../types'
import { createRng } from '../rng'
import type { Rng, RngState } from '../rng'
import { createBook, decayImbalance } from './book'
import type { BookParams, DepthBook } from './book'

export type { BookParams } from './book'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const YEAR_MS = 365 * DAY_MS
const HALF_HOUR_MS = 1_800_000

/** Per-quantum standard deviation of a process quoted as an annualised vol. */
const VOL_SCALE = Math.sqrt(TICK_QUANTUM_MS / YEAR_MS)

export interface MarketParams {
  symbol: string
  seed: string
  p0: Px
  /** Annualised drift, applied to the slow trend rather than to the price. */
  mu: number
  /** GARCH(1,1) on per-quantum log-returns: s2 = omega + alpha*e2_prev + beta*s2_prev.
   *  alpha + beta must stay below 1 or the variance has no stationary level. */
  garch: { omega: number; alpha: number; beta: number }
  /** Merton jumps. `lambdaPerHour` is the expected count per simulated hour. */
  jump: { lambdaPerHour: number; meanLogSize: number; sdLogSize: number }
  /** OU pull of log-price toward a slow random trend. `kappa` is the fraction of
   *  the gap closed per simulated hour; `trendVol` is the trend's own log-sd per
   *  simulated day. kappa = 0 disables the pull and leaves a pure random walk. */
  reversion: { kappa: number; trendVol: number }
  /** 48 half-hour multipliers for intraday vol/volume seasonality, or null for a
   *  market with no shape to its day. */
  seasonality: Float64Array | null
  /** Expected trades per simulated second, before seasonality. */
  tradesPerSecond: number
  /** Lognormal trade size: median, and the log-sd around it. */
  size: { medianQty: Qty; sigma: number }
  tickSize: Px
  book: BookParams
}

/** Fully serialisable; structured-cloneable; contains NO functions.
 *
 *  Note what is NOT here: the last printed price. It is derived from `logP` on
 *  restore, because the alternative — storing it — adds a field that has to stay
 *  consistent with logP through every code path, and the next tick overwrites it
 *  anyway. The 24h stats ARE stored, because those cannot be rederived. */
export interface MarketState {
  version: 1
  /** Whole quanta advanced since t0. The only measure of how far the sim has run. */
  quanta: number
  t0: SimTime
  logP: number
  trend: number
  sigma2: number
  ePrev: number
  imbalance: number
  o24: Px
  h24: Px
  l24: Px
  v24: number
  rolled24At: SimTime
  rng: RngState
}

export interface MarketEngine {
  readonly symbol: string
  readonly params: MarketParams
  now(): SimTime
  /**
   * Advance to `to`, emitting every generated tick to `sink`.
   *
   * Advances only in whole TICK_QUANTUM_MS steps; a partial trailing quantum is
   * not consumed. No-op (returns 0) when `to <= now()`. Returns ticks emitted.
   */
  advanceTo(to: SimTime, sink: TickSink): number
  /** Zero-alloc: the SAME Quote object every call, mutated. */
  quote(): Quote
  /** Zero-alloc: the SAME OrderBook, level arrays reused. Rebuilt at most once
   *  per BOOK_REBUILD_MS of sim time. */
  book(): OrderBook
  /** Depth-walked average fill price for a market order, incl. impact. */
  fillPrice(side: Side, qty: Qty): Px
  snapshot(): MarketState
  reset(state: MarketState): void
}

// ── Seasonality shapes ───────────────────────────────────────────────────────

/**
 * Build 48 half-hour multipliers from an hour-of-day function, normalised to a
 * mean of 1.
 *
 * Normalising matters: without it every preset's effective volatility would be
 * whatever its seasonality curve happened to average to, so the garch parameters
 * would stop meaning what they say and two presets could not be compared.
 */
function seasonalityFrom(f: (hourUtc: number) => number): Float64Array {
  const a = new Float64Array(48)
  let sum = 0
  for (let i = 0; i < 48; i++) {
    const v = f(i / 2)
    a[i] = v > 0.05 ? v : 0.05
    sum += a[i]
  }
  const k = 48 / sum
  for (let i = 0; i < 48; i++) a[i] *= k
  return a
}

/** Crypto never closes, but it still has a day: quiet through the Asian night,
 *  busiest as the US comes online. */
const CRYPTO_DAY = seasonalityFrom((h) => 1 + 0.45 * Math.cos(((h - 15) / 24) * 2 * Math.PI))

/** US regular trading hours, 13:30–20:00 UTC, with the open and close spikes
 *  that dominate an equity's day. Outside RTH it is thin but not zero — a market
 *  that flatlines for 17 hours makes the chart look broken rather than closed. */
const RTH_DAY = seasonalityFrom((h) => {
  if (h < 13.5 || h >= 20) return 0.2
  if (h < 14.5 || h >= 19.5) return 2.2
  return 1
})

/** Tokyo, London, New York, and the overlap that is most of the day's range. */
const FX_DAY = seasonalityFrom((h) => {
  let v = 0.4
  if (h >= 0 && h < 8) v += 0.5
  if (h >= 7 && h < 16) v += 0.9
  if (h >= 12 && h < 21) v += 0.9
  return v
})

/** Solve omega so the GARCH's unconditional variance matches an annualised vol.
 *  Quoting presets in annual vol is the only way they stay comparable; omega on
 *  its own is an uninterpretable number near 1e-11. */
function garchFor(annualVol: number, alpha: number, beta: number) {
  const sd = annualVol * VOL_SCALE
  return { omega: (1 - alpha - beta) * sd * sd, alpha, beta }
}

export const PRESETS: Readonly<
  Record<'btc' | 'eth' | 'bluechip' | 'meme' | 'forex' | 'index', MarketParams>
> = {
  btc: {
    symbol: 'BTCUSDT',
    seed: 'btc',
    p0: 68_000,
    mu: 0.25,
    garch: garchFor(0.65, 0.06, 0.92),
    jump: { lambdaPerHour: 0.15, meanLogSize: -0.002, sdLogSize: 0.02 },
    reversion: { kappa: 0.02, trendVol: 0.03 },
    seasonality: CRYPTO_DAY,
    tradesPerSecond: 6,
    size: { medianQty: 0.03, sigma: 1.1 },
    tickSize: 0.1,
    book: {
      baseSpreadTicks: 1,
      depth: 20,
      baseSize: 1.2,
      sizeDecay: 0.12,
      imbalanceGain: 0.4,
      imbalanceHalfLifeMs: 20_000,
    },
  },
  eth: {
    symbol: 'ETHUSDT',
    seed: 'eth',
    p0: 3_500,
    mu: 0.2,
    garch: garchFor(0.78, 0.07, 0.91),
    jump: { lambdaPerHour: 0.2, meanLogSize: -0.002, sdLogSize: 0.024 },
    reversion: { kappa: 0.02, trendVol: 0.035 },
    seasonality: CRYPTO_DAY,
    tradesPerSecond: 5,
    size: { medianQty: 0.4, sigma: 1.15 },
    tickSize: 0.01,
    book: {
      baseSpreadTicks: 1,
      depth: 20,
      baseSize: 14,
      sizeDecay: 0.12,
      imbalanceGain: 0.4,
      imbalanceHalfLifeMs: 20_000,
    },
  },
  bluechip: {
    symbol: 'AAPL',
    seed: 'bluechip',
    p0: 190,
    mu: 0.09,
    garch: garchFor(0.26, 0.05, 0.93),
    jump: { lambdaPerHour: 0.02, meanLogSize: -0.004, sdLogSize: 0.03 },
    reversion: { kappa: 0.05, trendVol: 0.012 },
    seasonality: RTH_DAY,
    tradesPerSecond: 3,
    size: { medianQty: 25, sigma: 1.2 },
    tickSize: 0.01,
    book: {
      baseSpreadTicks: 1,
      depth: 15,
      baseSize: 400,
      sizeDecay: 0.14,
      imbalanceGain: 0.35,
      imbalanceHalfLifeMs: 30_000,
    },
  },
  meme: {
    symbol: 'DOGEUSDT',
    seed: 'meme',
    p0: 0.85,
    mu: 0,
    garch: garchFor(1.9, 0.1, 0.87),
    jump: { lambdaPerHour: 0.8, meanLogSize: 0, sdLogSize: 0.05 },
    reversion: { kappa: 0.01, trendVol: 0.09 },
    seasonality: CRYPTO_DAY,
    tradesPerSecond: 9,
    size: { medianQty: 5_000, sigma: 1.4 },
    tickSize: 0.0001,
    book: {
      baseSpreadTicks: 3,
      depth: 25,
      baseSize: 90_000,
      sizeDecay: 0.1,
      imbalanceGain: 0.6,
      imbalanceHalfLifeMs: 12_000,
    },
  },
  forex: {
    symbol: 'EURUSD',
    seed: 'forex',
    p0: 1.085,
    mu: 0,
    garch: garchFor(0.08, 0.04, 0.94),
    jump: { lambdaPerHour: 0.01, meanLogSize: 0, sdLogSize: 0.004 },
    // Strongly mean-reverting with an almost immobile trend — which is exactly
    // what a major pair does, and why carrying an FX position overnight on
    // momentum alone should feel unrewarding.
    reversion: { kappa: 0.4, trendVol: 0.002 },
    seasonality: FX_DAY,
    tradesPerSecond: 10,
    size: { medianQty: 20_000, sigma: 0.9 },
    tickSize: 0.00001,
    book: {
      baseSpreadTicks: 5,
      depth: 12,
      baseSize: 1_500_000,
      sizeDecay: 0.08,
      imbalanceGain: 0.25,
      imbalanceHalfLifeMs: 15_000,
    },
  },
  index: {
    symbol: 'SPX500',
    seed: 'index',
    p0: 5_400,
    mu: 0.07,
    garch: garchFor(0.15, 0.05, 0.93),
    jump: { lambdaPerHour: 0.01, meanLogSize: -0.006, sdLogSize: 0.02 },
    reversion: { kappa: 0.06, trendVol: 0.008 },
    seasonality: RTH_DAY,
    tradesPerSecond: 4,
    size: { medianQty: 2, sigma: 1 },
    tickSize: 0.25,
    book: {
      baseSpreadTicks: 1,
      depth: 15,
      baseSize: 40,
      sizeDecay: 0.13,
      imbalanceGain: 0.3,
      imbalanceHalfLifeMs: 25_000,
    },
  },
}

// ── Guard rails ──────────────────────────────────────────────────────────────

/** Conditional variance is capped at this multiple of its unconditional level.
 *  At alpha+beta ≈ 0.98 a single six-sigma innovation raises sigma2 for days,
 *  and two in a row can ratchet it somewhere it never comes back from. */
const SIGMA2_CAP_MULT = 400
/** A single jump is capped at ±30% in log terms. Merton's normal has no bound,
 *  and one 8-sigma jump on the meme preset would move the price by e^2. */
const MAX_JUMP = 0.3
/** Log-price is confined to p0 * e^±20. Nothing inside that band is a bug, and
 *  outside it exp() is on its way to Infinity, which would silently poison every
 *  downstream number (equity, margin, the chart's autoscale) rather than fail. */
const LOG_BAND = 20
/** How far the mark may sit from the index. Real exchanges clamp exactly like
 *  this so a thin book cannot be pushed through someone's liquidation price. */
const MARK_BAND = 0.005

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

class Market implements MarketEngine {
  readonly symbol: string
  readonly params: MarketParams

  private st: MarketState
  private rng: Rng
  private depth: DepthBook
  private q: Quote
  private lastPx: Px

  private bookAt = -Infinity
  private bookStale = true

  // Everything below is derived from params once, because it is otherwise
  // recomputed a few million times during a catch-up.
  private readonly jumpProb: number
  private readonly pull: number
  private readonly trendDrift: number
  private readonly trendSd: number
  private readonly sigma2Cap: number
  private readonly imbDecay: number
  private readonly refFlow: number
  private readonly halfSpread: Px
  private readonly logLo: number
  private readonly logHi: number
  private readonly midFloor: Px

  constructor(p: MarketParams, restore?: MarketState) {
    this.params = p
    this.symbol = p.symbol
    this.rng = createRng(p.seed)
    this.depth = createBook(p.book, p.tickSize)

    this.jumpProb = p.jump.lambdaPerHour * (TICK_QUANTUM_MS / HOUR_MS)
    this.pull = p.reversion.kappa * (TICK_QUANTUM_MS / HOUR_MS)
    this.trendDrift = p.mu * (TICK_QUANTUM_MS / YEAR_MS)
    this.trendSd = p.reversion.trendVol * Math.sqrt(TICK_QUANTUM_MS / DAY_MS)

    const uncond = p.garch.omega / Math.max(1e-12, 1 - p.garch.alpha - p.garch.beta)
    this.sigma2Cap = uncond * SIGMA2_CAP_MULT
    // One quantum of decay, resolved once through the same law the book exposes,
    // because a Math.pow per quantum per symbol is pure waste during a catch-up.
    this.imbDecay = decayImbalance(1, TICK_QUANTUM_MS, p.book.imbalanceHalfLifeMs)
    // Flow expected to arrive within one half-life, which is the scale that makes
    // imbalanceGain mean the same thing on a 20k-share book and a 1.5M-lot one.
    this.refFlow = Math.max(
      1e-9,
      p.tradesPerSecond * (p.book.imbalanceHalfLifeMs / 1000) * p.size.medianQty,
    )
    this.halfSpread = Math.max(0.5, p.book.baseSpreadTicks / 2) * p.tickSize

    const log0 = Math.log(p.p0)
    this.logLo = log0 - LOG_BAND
    this.logHi = log0 + LOG_BAND
    const spacing = Math.max(1, Math.round(p.book.baseSpreadTicks))
    // Keep mid high enough that the deepest bid still has a positive price.
    this.midFloor = p.tickSize * (p.book.depth * spacing + 4)

    this.st = restore
      ? { ...restore, rng: { ...restore.rng } }
      : {
          version: 1,
          quanta: 0,
          t0: 0,
          logP: log0,
          trend: log0,
          sigma2: uncond,
          ePrev: 0,
          imbalance: 0,
          o24: p.p0,
          h24: p.p0,
          l24: p.p0,
          v24: 0,
          rolled24At: 0,
          rng: createRng(p.seed).state(),
        }
    this.rng.restore(this.st.rng)
    this.lastPx = this.snapTick(Math.exp(this.st.logP))
    this.q = {
      t: this.now(),
      symbol: p.symbol,
      last: this.lastPx,
      bid: this.lastPx,
      ask: this.lastPx,
      markPrice: this.lastPx,
      indexPrice: this.lastPx,
      open24h: this.st.o24,
      high24h: this.st.h24,
      low24h: this.st.l24,
      volume24h: this.st.v24,
    }
  }

  now(): SimTime {
    return this.st.t0 + this.st.quanta * TICK_QUANTUM_MS
  }

  private snapTick(p: Px): Px {
    return Math.round(p / this.params.tickSize) * this.params.tickSize
  }

  private seasonalAt(t: SimTime): number {
    const s = this.params.seasonality
    if (!s) return 1
    const ms = ((t % DAY_MS) + DAY_MS) % DAY_MS
    return s[(ms / HALF_HOUR_MS) | 0]
  }

  advanceTo(to: SimTime, sink: TickSink): number {
    const st = this.st
    const target = Math.floor((to - st.t0) / TICK_QUANTUM_MS)
    let emitted = 0
    // Absolute quantum boundaries, so a thousand ragged calls land on exactly the
    // same set of steps as one big call. This loop is the whole replay guarantee.
    while (st.quanta < target) emitted += this.step(sink)
    if (emitted > 0) this.bookStale = true
    return emitted
  }

  private step(sink: TickSink): number {
    const st = this.st
    const p = this.params
    const t0q = st.t0 + st.quanta * TICK_QUANTUM_MS
    const seas = this.seasonalAt(t0q)

    // The 24h window is a rolling session rather than a true trailing window: the
    // state carries one open/high/low/volume, not a ring of them, and a real
    // exchange's "24h change" is a session figure anyway.
    if (t0q - st.rolled24At >= DAY_MS) {
      st.o24 = this.lastPx
      st.h24 = this.lastPx
      st.l24 = this.lastPx
      st.v24 = 0
      st.rolled24At = t0q
    }

    let s2 = p.garch.omega + p.garch.alpha * st.ePrev * st.ePrev + p.garch.beta * st.sigma2
    if (s2 > this.sigma2Cap) s2 = this.sigma2Cap
    st.sigma2 = s2
    const sd = Math.sqrt(s2)
    const e = sd * this.rng.normal()
    st.ePrev = e

    let shock = e * seas
    if (this.rng.u() < this.jumpProb) {
      shock += clamp(
        p.jump.meanLogSize + p.jump.sdLogSize * this.rng.normal(),
        -MAX_JUMP,
        MAX_JUMP,
      )
    }

    st.trend = clamp(
      st.trend + this.trendDrift + this.trendSd * this.rng.normal(),
      this.logLo,
      this.logHi,
    )
    const logPrev = st.logP
    const logNext = clamp(
      logPrev + this.pull * (st.trend - logPrev) + shock,
      this.logLo,
      this.logHi,
    )
    st.logP = logNext
    st.quanta++

    st.imbalance *= this.imbDecay

    const n = this.rng.poisson(p.tradesPerSecond * (TICK_QUANTUM_MS / 1000) * seas)
    if (n <= 0) return 0

    // Aggressors follow the move: a quantum that went up was mostly buyers
    // lifting offers. Bounded well short of 0/1 so even a violent quantum still
    // prints both sides, which is what keeps the book from looking one-way.
    const drive = shock / (sd * seas + 1e-12)
    const pBuy = 0.5 + 0.35 * Math.tanh(drive * 0.5)

    const dLog = logNext - logPrev
    for (let i = 0; i < n; i++) {
      // One uniform per trade, placing it inside its own slot of the quantum.
      // Order statistics of n uniforms would be more correct and would need a
      // sort to come out monotone; slotted jitter is monotone by construction,
      // and nothing downstream can tell the difference.
      const frac = (i + this.rng.u()) / n
      const s: 1 | -1 = this.rng.u() < pBuy ? 1 : -1
      const qty = p.size.medianQty * Math.exp(p.size.sigma * this.rng.normal())
      const mid = Math.exp(logPrev + dLog * frac)
      const px = this.snapTick(mid + s * this.halfSpread)

      this.lastPx = px
      if (px > st.h24) st.h24 = px
      if (px < st.l24) st.l24 = px
      st.v24 += qty
      st.imbalance += s * qty

      sink.onTick(t0q + Math.floor(frac * TICK_QUANTUM_MS), px, qty, s)
    }
    return n
  }

  private mid(): Px {
    const m = Math.exp(this.st.logP)
    return m < this.midFloor ? this.midFloor : m
  }

  private ensureBook(): OrderBook {
    const t = this.now()
    if (!this.bookStale && t - this.bookAt < BOOK_REBUILD_MS) return this.depth.book
    this.bookAt = t
    this.bookStale = false
    return this.depth.rebuild(
      t,
      this.mid(),
      Math.tanh(this.st.imbalance / this.refFlow),
      this.st.quanta,
    )
  }

  book(): OrderBook {
    return this.ensureBook()
  }

  quote(): Quote {
    const b = this.ensureBook()
    const st = this.st
    const q = this.q
    q.t = this.now()
    q.last = this.lastPx
    q.bid = b.bids[0].p
    q.ask = b.asks[0].p
    const index = this.mid()
    q.indexPrice = index
    // Mark is the book's mid, fenced to a band around the index. Margin and
    // liquidation are computed against this and never against `last`.
    q.markPrice = clamp((q.bid + q.ask) / 2, index * (1 - MARK_BAND), index * (1 + MARK_BAND))
    q.open24h = st.o24
    q.high24h = st.h24
    q.low24h = st.l24
    q.volume24h = st.v24
    return q
  }

  fillPrice(side: Side, qty: Qty): Px {
    this.ensureBook()
    return this.depth.fillPrice(side, qty)
  }

  snapshot(): MarketState {
    return { ...this.st, rng: this.rng.state() }
  }

  reset(state: MarketState): void {
    this.st = { ...state, rng: { ...state.rng } }
    this.rng.restore(state.rng)
    this.lastPx = this.snapTick(Math.exp(this.st.logP))
    this.bookStale = true
    this.bookAt = -Infinity
  }
}

export function createMarket(p: MarketParams, restore?: MarketState): MarketEngine {
  return new Market(p, restore)
}
