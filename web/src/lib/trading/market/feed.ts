// The world: a clock, one market per symbol, one aggregator per (symbol, timeframe).
//
// This is the seam the live crypto adapter also satisfies, so nothing downstream
// — chart, broker, UI — can tell which engine it was handed. That is why `pump`
// exists at all: the sim needs driving, the live feed is driven by its socket,
// and both answer the same call.
//
// Per-symbol determinism comes from the seed: each market runs on `${seed}|${symbol}`,
// so adding BTC to a watchlist that already has ETH cannot shift a single ETH
// print. Sharing one stream across symbols would make the whole world's history
// depend on the order the user happened to add things, and the resulting bug
// report ("my chart changed when I added a symbol") is unfalsifiable.

import { MAX_CATCHUP_SIM_MS, TF_CAPACITY, TF_MS } from '../types'
import type {
  Candle,
  Instrument,
  OrderBook,
  Px,
  Qty,
  Quote,
  Side,
  SimTime,
  SpotInstrument,
  TickSink,
  Timeframe,
} from '../types'
import { createRng, hashSeed } from '../rng'
import { createClock } from './clock'
import type { ClockState, SimClock } from './clock'
import { createAggregator } from './candles'
import type { CandleAggregator, CandleSeries } from './candles'
import { createMarket, PRESETS } from './model'
import type { MarketEngine, MarketParams, MarketState } from './model'

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
  /** Drive the world by `wallDeltaMs` of real time. Returns ticks emitted. */
  pump(wallDeltaMs: number): number
  /** Chunked fast-forward. Reports progress between slices and yields to the
   *  event loop; each slice is sized to land near `budgetMs`. */
  catchUp(
    simDeltaMs: number,
    budgetMs: number,
    onProgress: (doneMs: number, totalMs: number) => void,
  ): Promise<void>
  snapshot(): WorldSnapshot
  dispose(): void
}

export interface WorldSnapshot {
  version: 1
  seed: string
  clock: ClockState
  /**
   * Epoch milliseconds at which this was persisted, used to size the catch-up on
   * resume. Left 0 here and stamped by the persistence layer: nothing under
   * lib/trading/ may read the wall clock, and a sim that could would stop
   * behaving the same at 1x and at 60x.
   */
  savedAtWall: number
  markets: Record<string, MarketState>
}

export interface SimFeedOptions {
  seed: string
  symbols: MarketParams[]
  restore?: WorldSnapshot
  /**
   * Which timeframes get an aggregator. All nine by default, which costs about
   * 1.3 MB of Float64Array per symbol — trim it on a memory-tight surface.
   */
  timeframes?: readonly Timeframe[]
  /**
   * Any monotonic millisecond source, used ONLY to size catch-up slices.
   *
   * Injected rather than read, because reading the wall clock inside the engine
   * is exactly the coupling that makes 1x and 60x diverge. Slice sizes cannot
   * change the tick stream — advanceTo only ever consumes whole quanta — so this
   * is scheduling, not physics, and catch-up works without it (cost is then
   * estimated from the tick count, which is the dominant term anyway).
   */
  wallMs?: () => number
}

const ALL_TIMEFRAMES: readonly Timeframe[] = ['1s', '5s', '15s', '1m', '5m', '15m', '1h', '4h', '1d']

/** Nominal cost of one tick and one empty quantum, in milliseconds. Only used to
 *  size slices when no wall clock was injected; the numbers need to be the right
 *  order of magnitude, nothing more, because the loop rescales from there. */
const COST_PER_TICK_MS = 1 / 2000
const COST_PER_QUANTUM_MS = 1 / 6000
/** Opening guess: sim-milliseconds of work per millisecond of budget. */
const INITIAL_THROUGHPUT = 200_000
/** No slice covers more than an hour of sim time, so progress stays legible even
 *  when the machine turns out to be very fast. */
const MAX_SLICE_MS = 3_600_000

const QUOTE_CCY = ['USDT', 'USDC', 'USD', 'EUR', 'THB', 'JPY', 'BTC']

function decimalsOf(x: number): number {
  const s = String(x)
  const dot = s.indexOf('.')
  if (dot >= 0 && s.indexOf('e') < 0) return s.length - dot - 1
  const d = Math.ceil(-Math.log10(x))
  return d > 0 ? d : 0
}

/** A spot instrument inferred from the market's parameters.
 *
 *  Inferred rather than declared because MarketParams already carries everything
 *  that actually matters (tick size, typical size) and a second, hand-written
 *  copy of the same facts is a copy that goes stale. */
function instrumentFor(p: MarketParams): SpotInstrument {
  const sym = p.symbol
  const quote = QUOTE_CCY.find((q) => sym.length > q.length && sym.endsWith(q))
  const qtyPrecision = Math.min(8, Math.max(0, 6 - Math.floor(Math.log10(p.size.medianQty))))
  return {
    kind: 'spot',
    symbol: sym,
    base: quote ? sym.slice(0, sym.length - quote.length) : sym,
    quote: quote ?? 'USD',
    tickSize: p.tickSize,
    lotSize: Math.pow(10, -qtyPrecision),
    pricePrecision: decimalsOf(p.tickSize),
    qtyPrecision,
  }
}

/**
 * The per-symbol tick sink.
 *
 * One long-lived object per symbol, holding the aggregator array flat, because
 * this is the hot path: at 1000x catch-up it is called tens of thousands of
 * times a second and anything allocated here — a tick object, a closure, an
 * iterator over a Map — shows up as a stutter.
 */
class SymbolSink implements TickSink {
  readonly symbol: string
  readonly aggs: CandleAggregator[] = []
  private readonly listeners: FeedListener[]

  constructor(symbol: string, listeners: FeedListener[]) {
    this.symbol = symbol
    this.listeners = listeners
  }

  onTick(t: SimTime, p: Px, q: Qty, s: 1 | -1): void {
    const a = this.aggs
    for (let i = 0; i < a.length; i++) a[i].onTick(t, p, q, s)
    const ls = this.listeners
    for (let i = 0; i < ls.length; i++) ls[i].onTick?.(this.symbol, t, p, q, s)
  }
}

class SimFeed implements MarketFeed {
  readonly mode = 'sim'
  readonly clock: SimClock

  private readonly seed: string
  private readonly tfs: readonly Timeframe[]
  private readonly wallMs?: () => number
  private readonly catalog = new Map<string, MarketParams>()
  private readonly markets = new Map<string, MarketEngine>()
  private readonly aggs = new Map<string, Map<Timeframe, CandleAggregator>>()
  private readonly sinks = new Map<string, SymbolSink>()
  private readonly instruments = new Map<string, Instrument>()
  private readonly unsubs = new Map<string, (() => void)[]>()
  private readonly listeners: FeedListener[] = []
  private st: FeedStatus = 'idle'
  private disposed = false

  constructor(o: SimFeedOptions) {
    this.seed = o.seed
    this.tfs = o.timeframes ?? ALL_TIMEFRAMES
    this.wallMs = o.wallMs
    this.clock = createClock(o.restore?.clock)

    for (const p of o.symbols) this.catalog.set(p.symbol, p)
    for (const p of o.symbols) this.spawn(p, o.restore?.markets[p.symbol])
  }

  // ── symbols ────────────────────────────────────────────────────────────────

  private spawn(p: MarketParams, restore?: MarketState): void {
    // Per-symbol seed. The params' own seed is deliberately ignored so that two
    // watchlists built from the same presets in a different order still produce
    // the same prices for the symbols they share.
    const m = createMarket({ ...p, seed: `${this.seed}|${p.symbol}` }, restore)
    if (!restore) {
      // A symbol added mid-session starts HERE, not at sim zero — otherwise its
      // first advanceTo would have to replay every quantum since the world began.
      const s = m.snapshot()
      s.t0 = this.clock.now()
      s.rolled24At = s.t0
      m.reset(s)
    }
    this.markets.set(p.symbol, m)
    this.instruments.set(p.symbol, instrumentFor(p))

    const sink = new SymbolSink(p.symbol, this.listeners)
    const byTf = new Map<Timeframe, CandleAggregator>()
    const offs: (() => void)[] = []
    for (const tf of this.tfs) {
      const agg = createAggregator(tf, TF_CAPACITY[tf])
      offs.push(agg.onClose((t) => this.emitBarClose(p.symbol, tf, t)))
      byTf.set(tf, agg)
      sink.aggs.push(agg)
    }
    this.aggs.set(p.symbol, byTf)
    this.sinks.set(p.symbol, sink)
    this.unsubs.set(p.symbol, offs)
  }

  symbols(): readonly string[] {
    return [...this.markets.keys()]
  }

  instrument(symbol: string): Instrument | undefined {
    return this.instruments.get(symbol)
  }

  add(symbol: string): void {
    if (this.markets.has(symbol)) return
    let p = this.catalog.get(symbol)
    if (!p) {
      // An unknown symbol still has to become something. Pick a preset and a
      // starting price from the name's hash, so the same ticker is always the
      // same kind of instrument at the same price on every device.
      const keys = Object.keys(PRESETS) as (keyof typeof PRESETS)[]
      const h = hashSeed(symbol)
      const base = PRESETS[keys[h % keys.length]]
      p = { ...base, symbol, p0: base.p0 * (0.5 + ((h >>> 8) % 1000) / 1000) }
      this.catalog.set(symbol, p)
    }
    this.spawn(p)
  }

  remove(symbol: string): void {
    for (const off of this.unsubs.get(symbol) ?? []) off()
    this.unsubs.delete(symbol)
    this.markets.delete(symbol)
    this.aggs.delete(symbol)
    this.sinks.delete(symbol)
    this.instruments.delete(symbol)
  }

  // ── listeners ──────────────────────────────────────────────────────────────

  subscribe(l: FeedListener): () => void {
    this.listeners.push(l)
    return () => {
      const i = this.listeners.indexOf(l)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  private emitBarClose(symbol: string, tf: Timeframe, t: SimTime): void {
    for (const l of this.listeners) l.onBarClose?.(symbol, tf, t)
  }

  get status(): FeedStatus {
    return this.st
  }

  private setStatus(s: FeedStatus, detail?: string): void {
    if (this.st === s) return
    this.st = s
    for (const l of this.listeners) l.onStatus?.(s, detail)
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  quote(symbol: string): Quote | undefined {
    return this.markets.get(symbol)?.quote()
  }

  book(symbol: string): OrderBook | undefined {
    return this.markets.get(symbol)?.book()
  }

  series(symbol: string, tf: Timeframe): CandleSeries | undefined {
    return this.aggs.get(symbol)?.get(tf)?.series
  }

  fillPrice(symbol: string, side: Side, qty: Qty): Px | undefined {
    return this.markets.get(symbol)?.fillPrice(side, qty)
  }

  // ── driving ────────────────────────────────────────────────────────────────

  /** Bring every market and aggregator up to the clock. The fillTo is what keeps
   *  a quiet instrument's chart advancing while a busy one prints. */
  private drive(): number {
    const now = this.clock.now()
    let ticks = 0
    for (const [sym, m] of this.markets) {
      const sink = this.sinks.get(sym)
      if (!sink) continue
      const n = m.advanceTo(now, sink)
      ticks += n
      for (let i = 0; i < sink.aggs.length; i++) sink.aggs[i].fillTo(now)
      if (n > 0) for (const l of this.listeners) l.onBook?.(sym)
    }
    return ticks
  }

  pump(wallDeltaMs: number): number {
    if (this.disposed) return 0
    this.clock.advance(wallDeltaMs)
    if (this.st === 'idle') this.setStatus('live')
    return this.drive()
  }

  async catchUp(
    simDeltaMs: number,
    budgetMs: number,
    onProgress: (doneMs: number, totalMs: number) => void,
  ): Promise<void> {
    const total = Math.min(Math.max(0, simDeltaMs), MAX_CATCHUP_SIM_MS)
    onProgress(0, total)
    if (total <= 0 || this.disposed) return

    const before = this.st
    this.setStatus('catching-up')
    const budget = budgetMs > 0 ? budgetMs : 6
    // Sim-milliseconds of work per millisecond of wall time. Re-estimated after
    // every slice, because the honest answer depends on the device, the number of
    // symbols and how busy the market happens to be — none of which is knowable
    // up front, and all of which change while the loop runs.
    let throughput = INITIAL_THROUGHPUT
    let done = 0

    while (done < total && !this.disposed) {
      const want = Math.min(Math.max(throughput * budget, 1000), MAX_SLICE_MS, total - done)
      const take = Math.ceil(want)
      const started = this.wallMs?.() ?? 0
      this.clock.advanceSim(take)
      const ticks = this.drive()
      const cost = this.wallMs
        ? Math.max(0.05, this.wallMs() - started)
        : Math.max(0.05, ticks * COST_PER_TICK_MS + (take / 250) * COST_PER_QUANTUM_MS)
      throughput = 0.6 * throughput + 0.4 * (take / cost)

      done += take
      onProgress(done > total ? total : done, total)
      if (done < total) await new Promise((r) => setTimeout(r, 0))
    }
    this.setStatus(before === 'idle' ? 'live' : before)
  }

  // ── history ────────────────────────────────────────────────────────────────

  /**
   * Bars from before the series starts, generated backwards from the oldest bar
   * the aggregator holds (or from the current price when it holds none).
   *
   * A backward walk rather than a second forward simulation, because the join has
   * to be seamless: the newest generated bar must close exactly where the live
   * series opens, and running a fresh market forward would land somewhere else.
   * The anchor is folded into the seed so repeated calls at the same state agree;
   * once the ring wraps and the anchor moves, the invented past moves with it,
   * which is the right trade for something the chart only reads at bootstrap.
   */
  async history(symbol: string, tf: Timeframe, count: number): Promise<Candle[]> {
    const m = this.markets.get(symbol)
    if (!m || count <= 0) return []
    const agg = this.aggs.get(symbol)?.get(tf)
    const live = agg ? agg.toArray() : []
    const tfMs = TF_MS[tf]

    const anchorT = live.length ? live[0].t : Math.floor(m.now() / tfMs) * tfMs + tfMs
    const anchorPx = live.length ? live[0].o : m.quote().last
    const need = count - live.length
    if (need <= 0) return live.slice(live.length - count)

    const p = m.params
    const rng = createRng(`${this.seed}|${symbol}|${tf}|history|${anchorT}`)
    // One bar's worth of the model's unconditional volatility. Not the GARCH path
    // — invented history only has to be statistically plausible, and a bar-level
    // random walk at the right scale is indistinguishable on a chart.
    const uncond = p.garch.omega / Math.max(1e-12, 1 - p.garch.alpha - p.garch.beta)
    const sd = Math.sqrt(uncond * (tfMs / 250))
    const perBar = p.tradesPerSecond * (tfMs / 1000)

    const back: Candle[] = []
    let c = anchorPx
    for (let k = 1; k <= need; k++) {
      const o = c * Math.exp(-sd * rng.normal())
      const hi = Math.max(o, c) * (1 + sd * Math.abs(rng.normal()) * 0.6)
      const lo = Math.min(o, c) / (1 + sd * Math.abs(rng.normal()) * 0.6)
      const n = Math.max(1, Math.round(perBar * (0.5 + rng.u())))
      back.push({
        t: anchorT - k * tfMs,
        o,
        h: hi,
        l: lo,
        c,
        v: n * p.size.medianQty * Math.exp(p.size.sigma * p.size.sigma * 0.5),
        n,
      })
      c = o
    }
    back.reverse()
    return back.concat(live)
  }

  // ── persistence ────────────────────────────────────────────────────────────

  snapshot(): WorldSnapshot {
    const markets: Record<string, MarketState> = {}
    for (const [sym, m] of this.markets) markets[sym] = m.snapshot()
    return {
      version: 1,
      seed: this.seed,
      clock: this.clock.snapshot(),
      savedAtWall: 0,
      markets,
    }
  }

  dispose(): void {
    this.disposed = true
    for (const offs of this.unsubs.values()) for (const off of offs) off()
    this.unsubs.clear()
    this.markets.clear()
    this.aggs.clear()
    this.sinks.clear()
    this.listeners.length = 0
    this.st = 'idle'
  }
}

export function createSimFeed(o: SimFeedOptions): MarketFeed {
  return new SimFeed(o)
}
