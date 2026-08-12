// The live crypto adapter — the same MarketFeed seam, driven by a websocket.
//
// Everything downstream (chart, broker, UI) holds a `MarketFeed` and must not be
// able to tell which engine it got. That is why this file writes into the very
// same `CandleAggregator`s the sim writes into, and emits the same
// onTick/onBook/onBarClose/onStatus events: a bug that only appears in live mode
// would otherwise be a bug in code nobody can unit-test.
//
// Three things are genuinely different here, and each one is a deliberate choice
// rather than an omission:
//
//   time     Sim time in live mode IS exchange event time. The clock adopts the
//            first timestamp off the wire and never goes backwards after that, so
//            a laptop whose system clock is four minutes fast cannot shift a
//            single bar. `speed` is forced to 1 and `paused` is ignored — you
//            cannot fast-forward or pause reality, and pretending otherwise would
//            let the UI ask for a state the venue can never deliver.
//   driving  `pump()` emits nothing; the socket drives the world. It still moves
//            the clock and fills flat bars, because a market that goes quiet for
//            a minute must still gain a minute of bars (candles.ts rule 1) and
//            the broker's per-second step must keep firing between trades.
//   replay   There is none. `snapshot()` is seed-less with no markets — see the
//            comment on it.
//
// NO WALL CLOCK IS READ IN THIS FILE. `Date.now()` is banned tree-wide by
// purity.test.ts, and a live feed needs wall time for exactly two things —
// deciding a stream has gone silent, and spacing reconnect attempts. Both come in
// through `wallMs`, exactly as createSimFeed takes it, which is also what makes
// the reconnect ladder testable without waiting a real minute for it.

import { TF_CAPACITY, TF_MS } from '../types'
import type {
  BookLevel,
  Candle,
  Instrument,
  OrderBook,
  Px,
  Qty,
  Quote,
  Side,
  SimTime,
  SpotInstrument,
  Timeframe,
} from '../types'
import { createAggregator } from './candles'
import type { CandleAggregator, CandleSeries } from './candles'
import type { ClockState, SimClock } from './clock'
import type { FeedListener, FeedStatus, MarketFeed, WorldSnapshot } from './feed'

export type LiveVenue = 'binance' | 'coinbase'

/**
 * The slice of WebSocket this adapter uses.
 *
 * Structural, not `WebSocket`, so a test can drive the whole state machine with a
 * plain object. A test that opened a real socket would be slow, flaky, offline-
 * broken and would rate-limit the venue — which is to say, it would be deleted.
 */
export interface LiveSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev?: unknown) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onerror: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
}

export type SocketFactory = (url: string) => LiveSocket

export interface HttpResponse {
  ok: boolean
  status?: number
  json(): Promise<unknown>
}

export type FetchLike = (url: string) => Promise<HttpResponse>

export interface LiveFeedOptions {
  /** Venue-native tickers, e.g. ['BTCUSDT', 'ETHUSDT']. */
  symbols: string[]
  /** Where to start. The other venue is tried when this one never connects. */
  venue?: LiveVenue
  /** Overrides for the STARTING venue only — a base url for Binance would be
   *  nonsense once we have fallen back to Coinbase. */
  restBase?: string
  wsBase?: string
  /** Which timeframes get an aggregator. All nine by default. */
  timeframes?: readonly Timeframe[]
  /**
   * Monotonic milliseconds. Used ONLY for silence detection and reconnect
   * spacing, never for a bar time — bar times come off the wire.
   *
   * Injected rather than read, because nothing under lib/trading/ may touch the
   * wall clock (purity.test.ts), and because a reconnect ladder you cannot
   * fast-forward is a reconnect ladder nobody ever tests. Defaulting is the
   * caller's job: pass `Date.now` or `performance.now` from the React runtime.
   * Without it the feed falls back to counting its own heartbeats, which is
   * honest but wrong in a backgrounded tab, where timers are throttled to about
   * one a minute and ten sleeping minutes would look like ten seconds.
   */
  wallMs?: () => number
  /** Epoch milliseconds, used only to place the clock before the first message
   *  arrives. After that the exchange's own timestamps take over. */
  now?: () => number
  fetchImpl?: FetchLike
  socketImpl?: SocketFactory
  /**
   * Reconnect jitter in [-1, 1], scaled by JITTER_FRAC. Injected because
   * `Math.random()` is banned in this tree and because a test cannot pin a
   * backoff ladder it cannot predict. The default is a fixed sequence: it spaces
   * one client's own retries, but every client jitters identically, so a caller
   * that cares about thundering herds should pass a real random source.
   */
  jitter?: () => number
  onError?(e: Error): void
}

const ALL_TIMEFRAMES: readonly Timeframe[] = ['1s', '5s', '15s', '1m', '5m', '15m', '1h', '4h', '1d']

const BASES: Readonly<Record<LiveVenue, { ws: string; rest: string }>> = {
  binance: { ws: 'wss://stream.binance.com:9443', rest: 'https://api.binance.com' },
  coinbase: { ws: 'wss://ws-feed.exchange.coinbase.com', rest: 'https://api.exchange.coinbase.com' },
}

/** The reconnect ladder, in milliseconds. Past the end it stays at 30s: a venue
 *  that has been down for three minutes is having an outage, and hammering it
 *  every 30s costs nothing while backing off further would leave the user staring
 *  at a dead chart long after the venue came back. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const
const JITTER_FRAC = 0.2
/** A connection that has streamed this long is considered healthy, and the ladder
 *  resets. Without the reset, an eight-hour session with one blip in hour two
 *  would still be waiting 30s to reconnect in hour seven. */
const CLEAN_RESET_MS = 30_000
/** No message for this long and the stream is reported `stalled`. Both venues push
 *  depth at 100ms, so twelve seconds of nothing is never a quiet market. */
const STALL_MS = 12_000
/** How often silence and health are checked. */
const HEARTBEAT_MS = 1_000

/**
 * How far the clock may run ahead of the newest exchange timestamp.
 *
 * It has to run ahead at all, or a quiet minute freezes the chart and stops the
 * broker's per-second step. It must not run far ahead, because an aggregator
 * drops a tick whose bucket is older than the forming bar — so a clock two bars
 * in front of reality would silently discard late trades. Two seconds keeps the
 * chart alive through a lull and can only ever cost a stray print at a 1s bar
 * boundary, which is the cheaper of the two failures.
 */
const MAX_EXTRAPOLATE_MS = 2_000

/** Levels kept per side. Binance's partial-depth stream sends exactly 20. */
const BOOK_DEPTH = 20

/** Matches book.ts's TAIL_IMPACT: what walking off the end of the book costs, as a
 *  fraction of the last level's price per unit of overflow. Duplicated rather than
 *  imported because that constant is private to the sim's synthetic book, and the
 *  two would not be free to diverge if this file reached into it. */
const TAIL_IMPACT = 0.02

const QUOTE_CCY = ['USDT', 'USDC', 'USD', 'EUR', 'THB', 'JPY', 'BTC']

// ── wire helpers ─────────────────────────────────────────────────────────────
//
// Everything below treats the payload as hostile. A venue can ship a field as a
// string one week and a number the next, can send a `null` mid-outage, and can
// truncate a frame; none of that may throw, because an exception inside a socket
// handler takes the whole page's error boundary with it and the user loses their
// chart because someone's proxy mangled one JSON blob.

function obj(x: unknown): Record<string, unknown> | undefined {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : undefined
}

function arr(x: unknown): unknown[] | undefined {
  return Array.isArray(x) ? x : undefined
}

/** NaN for anything that is not a finite number, so one guard covers every field. */
function num(x: unknown): number {
  if (typeof x === 'number') return Number.isFinite(x) ? x : NaN
  if (typeof x === 'string' && x.length > 0) {
    const n = Number(x)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

/**
 * Decimals a wire price actually carries, ignoring padding.
 *
 * The tempting reading — "venues pad to their own tick size, so `43210.10` IS a
 * 0.01 tick" — is true of Coinbase and FALSE of Binance, which pads every price
 * to the quote asset's 8 decimals and is our default venue. Counting characters
 * there reads `68123.45000000` as a 1e-8 tick, and `fmt.price` (which uses
 * `minimumFractionDigits`) then prints eight decimals with six always zero.
 *
 * Stripping the padding first makes the answer the venue's real resolution on
 * both, and keeps it free: no exchangeInfo round trip, no second network
 * dependency on a screen whose whole brief is working offline.
 *
 * One sample can only UNDER-state precision — `68123.00000000` looks like zero
 * decimals — and never over-state it. That asymmetry is why `refine` widens and
 * never narrows; without that half this function is worse than the bug it fixes.
 */
function decimalsOfString(x: unknown): number {
  if (typeof x !== 'string') return -1
  const dot = x.indexOf('.')
  if (dot < 0) return 0
  let end = x.length
  while (end > dot + 1 && x.charCodeAt(end - 1) === 0x30) end--
  return end - dot - 1
}

function splitSymbol(sym: string): { base: string; quote: string } {
  const q = QUOTE_CCY.find((c) => sym.length > c.length && sym.endsWith(c))
  return q ? { base: sym.slice(0, sym.length - q.length), quote: q } : { base: sym, quote: 'USD' }
}

/** Coarsen bars to `tfMs`. Needed because neither venue serves every timeframe:
 *  Binance has no 5s or 15s kline and Coinbase has no 4h candle, and inventing the
 *  bar from a finer one is the only alternative to an empty chart. */
function bucketize(bars: Candle[], tfMs: number): Candle[] {
  const out: Candle[] = []
  let cur: Candle | undefined
  for (const b of bars) {
    const t = Math.floor(b.t / tfMs) * tfMs
    if (!cur || t !== cur.t) {
      cur = { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n }
      out.push(cur)
      continue
    }
    if (b.h > cur.h) cur.h = b.h
    if (b.l < cur.l) cur.l = b.l
    cur.c = b.c
    cur.v += b.v
    cur.n += b.n
  }
  return out
}

const defaultSocket: SocketFactory = (url) => {
  const ctor = (globalThis as { WebSocket?: new (u: string) => unknown }).WebSocket
  if (!ctor) throw new Error('no WebSocket in this environment')
  return new ctor(url) as unknown as LiveSocket
}

const defaultFetch: FetchLike = (url) => {
  const f = (globalThis as { fetch?: FetchLike }).fetch
  if (!f) return Promise.reject(new Error('no fetch in this environment'))
  return f(url)
}

/** Fixed, deterministic, and non-repeating enough to spread six retries. */
const JITTER_SEQ = [0.31, -0.72, 0.58, -0.19, 0.86, -0.45]

// ── the clock ────────────────────────────────────────────────────────────────

/**
 * A SimClock whose time is the exchange's.
 *
 * `speed` and `paused` are accepted and ignored rather than removed, because the
 * seam is shared with the sim and a UI that sets `feed.clock.speed = 60` must not
 * crash in live mode — it must simply keep running at 1x, which is the only speed
 * reality offers.
 */
class LiveClock implements SimClock {
  private st: ClockState
  private lastEvent = -1

  constructor(t0: SimTime) {
    this.st = { simNow: t0, speed: 1, residual: 0, paused: false }
  }

  now(): SimTime {
    return this.st.simNow
  }

  get speed(): number {
    return 1
  }

  set speed(_v: number) {
    // Ignored: reality runs at 1x.
  }

  get paused(): boolean {
    return false
  }

  set paused(_v: boolean) {
    // Ignored: the socket keeps arriving whether or not the UI wants it to.
  }

  advance(wallDeltaMs: number): SimTime {
    return this.advanceSim(wallDeltaMs)
  }

  advanceSim(simDeltaMs: number): SimTime {
    if (!(simDeltaMs > 0)) return this.st.simNow
    const want = this.st.simNow + simDeltaMs
    const cap = this.lastEvent < 0 ? want : this.lastEvent + MAX_EXTRAPOLATE_MS
    this.st.simNow = want < cap ? want : cap
    return this.st.simNow
  }

  /** Take an exchange timestamp. The FIRST one is adopted outright, later ones only
   *  ever move time forward: adopting it snaps away any local clock skew, and the
   *  monotonicity after that is what the aggregators rely on. */
  stamp(t: SimTime): void {
    if (!(t > 0)) return
    if (this.lastEvent < 0) this.st.simNow = t
    else if (t > this.st.simNow) this.st.simNow = t
    if (t > this.lastEvent) this.lastEvent = t
  }

  snapshot(): ClockState {
    return { ...this.st }
  }

  restore(s: ClockState): void {
    this.st = { simNow: s.simNow, speed: 1, residual: 0, paused: false }
    this.lastEvent = -1
  }
}

// ── per-symbol state ─────────────────────────────────────────────────────────

class LiveSymbol {
  readonly symbol: string
  readonly product: string
  readonly aggs: CandleAggregator[] = []
  readonly byTf = new Map<Timeframe, CandleAggregator>()
  readonly offs: (() => void)[] = []
  readonly q: Quote
  readonly bk: OrderBook = { t: 0, bids: [], asks: [] }
  inst: SpotInstrument
  bidQty = 0
  askQty = 0
  seen = false
  rolled24At = 0
  /** Coinbase only: the full L2 side, price -> size. Binance re-sends the top 20
   *  every 100ms, so it needs no state at all. */
  l2?: { bids: Map<number, number>; asks: Map<number, number> }

  constructor(symbol: string) {
    const { base, quote } = splitSymbol(symbol)
    this.symbol = symbol
    this.product = `${base}-${quote}`
    this.inst = {
      kind: 'spot',
      symbol,
      base,
      quote,
      // Provisional. Refined from the first price and size strings off the wire,
      // which is where the venue states its real precision.
      tickSize: 0.01,
      lotSize: 1e-8,
      pricePrecision: 2,
      qtyPrecision: 8,
    }
    this.q = {
      t: 0,
      symbol,
      last: 0,
      bid: 0,
      ask: 0,
      markPrice: 0,
      indexPrice: 0,
      open24h: 0,
      high24h: 0,
      low24h: 0,
      volume24h: 0,
    }
  }
}

// ── the feed ─────────────────────────────────────────────────────────────────

class LiveFeed implements MarketFeed {
  readonly mode = 'live'
  readonly clock: LiveClock

  private readonly tfs: readonly Timeframe[]
  private readonly wallMs?: () => number
  private readonly fetchImpl: FetchLike
  private readonly socketImpl: SocketFactory
  private readonly jitter: () => number
  private readonly onError?: (e: Error) => void
  private readonly homeVenue: LiveVenue
  private readonly overrideWs?: string
  private readonly overrideRest?: string

  private readonly syms = new Map<string, LiveSymbol>()
  /** Lowercased ticker -> our key, for Binance's stream names. */
  private readonly byWire = new Map<string, string>()
  /** Coinbase product id -> our key. */
  private readonly byProduct = new Map<string, string>()
  private readonly listeners: FeedListener[] = []

  private venue: LiveVenue
  private st: FeedStatus = 'idle'
  private sock: LiveSocket | null = null
  private attempt = 0
  private beats = 0
  // -1, not 0: `performance.now()` starts AT zero, and a 0 sentinel would make the
  // first seconds of every session look like "no message yet" forever.
  private lastMsgWall = -1
  private connectedAtWall = -1
  private everMessaged = false
  private jitterIdx = 0
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(o: LiveFeedOptions) {
    this.tfs = o.timeframes ?? ALL_TIMEFRAMES
    this.wallMs = o.wallMs
    this.fetchImpl = o.fetchImpl ?? defaultFetch
    this.socketImpl = o.socketImpl ?? defaultSocket
    this.onError = o.onError
    this.homeVenue = o.venue ?? 'binance'
    this.venue = this.homeVenue
    this.overrideWs = o.wsBase
    this.overrideRest = o.restBase
    this.jitter =
      o.jitter ??
      (() => {
        const v = JITTER_SEQ[this.jitterIdx % JITTER_SEQ.length]
        this.jitterIdx++
        return v
      })
    this.clock = new LiveClock(o.now?.() ?? 0)

    for (const s of o.symbols) this.track(s)
    if (this.syms.size > 0) this.connect()
  }

  // ── symbols ────────────────────────────────────────────────────────────────

  private track(symbol: string): LiveSymbol | undefined {
    if (!symbol || this.syms.has(symbol)) return undefined
    const s = new LiveSymbol(symbol)
    for (const tf of this.tfs) {
      const agg = createAggregator(tf, TF_CAPACITY[tf])
      s.offs.push(agg.onClose((t) => this.emitBarClose(symbol, tf, t)))
      s.byTf.set(tf, agg)
      s.aggs.push(agg)
    }
    this.syms.set(symbol, s)
    this.byWire.set(symbol.toLowerCase(), symbol)
    this.byProduct.set(s.product, symbol)
    return s
  }

  symbols(): readonly string[] {
    return [...this.syms.keys()]
  }

  instrument(symbol: string): Instrument | undefined {
    return this.syms.get(symbol)?.inst
  }

  add(symbol: string): void {
    if (this.disposed) return
    const s = this.track(symbol)
    if (!s) return
    // An open socket is told about the new symbol; a closed one picks it up from
    // the url on its next connect, so there is no path where a symbol is silently
    // never subscribed.
    if (this.sock && this.st !== 'idle') this.sendSub(true, [symbol])
    else if (!this.sock) this.connect()
  }

  remove(symbol: string): void {
    const s = this.syms.get(symbol)
    if (!s) return
    for (const off of s.offs) off()
    this.syms.delete(symbol)
    this.byWire.delete(symbol.toLowerCase())
    this.byProduct.delete(s.product)
    if (this.sock) this.sendSub(false, [symbol])
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
    if (this.st === s || this.disposed) return
    this.st = s
    for (const l of this.listeners) l.onStatus?.(s, detail)
  }

  private fail(e: unknown, detail?: string): void {
    const err = e instanceof Error ? e : new Error(String(e))
    this.onError?.(err)
    if (detail) this.setStatus('error', detail)
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  quote(symbol: string): Quote | undefined {
    const s = this.syms.get(symbol)
    return s && s.seen ? s.q : undefined
  }

  book(symbol: string): OrderBook | undefined {
    const s = this.syms.get(symbol)
    return s && s.bk.bids.length > 0 ? s.bk : undefined
  }

  series(symbol: string, tf: Timeframe): CandleSeries | undefined {
    return this.syms.get(symbol)?.byTf.get(tf)?.series
  }

  fillPrice(symbol: string, side: Side, qty: Qty): Px | undefined {
    const s = this.syms.get(symbol)
    if (!s) return undefined
    const buy = side === 'buy'
    const levels = buy ? s.bk.asks : s.bk.bids
    if (levels.length === 0) return s.seen ? s.q.last : undefined
    if (!(qty > 0)) return levels[0].p

    let rem = qty
    let cost = 0
    for (let i = 0; i < levels.length; i++) {
      const lv = levels[i]
      const take = rem < lv.q ? rem : lv.q
      cost += take * lv.p
      rem -= take
      if (rem <= 0) return cost / qty
    }
    // Past the visible depth. Same rule as the sim's book: charge the residual at
    // a linearly worsening price, so ten times the depth cannot cost the same as a
    // size that just cleared it.
    const last = levels[levels.length - 1].p
    const resting = buy ? s.askQty : s.bidQty
    const push = TAIL_IMPACT * (rem / (resting > 0 ? resting : rem))
    const tail = buy ? last * (1 + push / 2) : last / (1 + push / 2)
    return (cost + rem * tail) / qty
  }

  // ── driving ────────────────────────────────────────────────────────────────

  /**
   * Emits nothing — the socket does that. It still advances the clock (capped, see
   * MAX_EXTRAPOLATE_MS) and fills flat bars, because candles.ts must never skip a
   * bucket: the chart maps x to a bar index, so a quiet minute that produced no
   * bar would bend the time axis for every bar to its left.
   */
  pump(wallDeltaMs: number): number {
    if (this.disposed) return 0
    const now = this.clock.advance(wallDeltaMs)
    for (const s of this.syms.values()) for (const a of s.aggs) a.fillTo(now)
    return 0
  }

  /**
   * Immediate. There is no catching up to do: the feed is exactly as far along as
   * the venue is, and the gap a returning tab wants to close is filled by REST
   * history, not by replay. Reporting (0, 0) rather than (0, total) matters —
   * a progress bar handed a non-zero total it will never reach sits at 0% forever.
   */
  async catchUp(
    _simDeltaMs: number,
    _budgetMs: number,
    onProgress: (doneMs: number, totalMs: number) => void,
  ): Promise<void> {
    onProgress(0, 0)
  }

  // ── connection ─────────────────────────────────────────────────────────────

  private wall(): number {
    // Never Date.now(): see the file header. The heartbeat count is the degraded
    // fallback when the caller injected nothing.
    return this.wallMs ? this.wallMs() : this.beats * HEARTBEAT_MS
  }

  private base(kind: 'ws' | 'rest'): string {
    const o = kind === 'ws' ? this.overrideWs : this.overrideRest
    // Overrides belong to the venue the caller named. Handing a Binance base to
    // the Coinbase fallback would turn one outage into two.
    return (this.venue === this.homeVenue && o) || BASES[this.venue][kind]
  }

  private wsUrl(): string {
    const keys = [...this.syms.keys()]
    // Coinbase carries no subscription in the url; it is sent on open instead.
    if (this.venue === 'coinbase') return this.base('ws')
    const streams = keys
      .flatMap((s) => [`${s.toLowerCase()}@aggTrade`, `${s.toLowerCase()}@depth20@100ms`])
      .join('/')
    return `${this.base('ws')}/stream?streams=${streams}`
  }

  private connect(): void {
    if (this.disposed || this.syms.size === 0) return
    this.setStatus('connecting', this.venue)
    this.everMessaged = false
    this.connectedAtWall = -1
    this.lastMsgWall = -1

    let ws: LiveSocket
    try {
      ws = this.socketImpl(this.wsUrl())
    } catch (e) {
      this.fail(e, 'socket construction failed')
      this.scheduleReconnect()
      return
    }
    this.sock = ws
    // Every handler checks it is still the CURRENT socket. A socket we have
    // already walked away from can still fire a close event, and without this
    // guard that late event schedules a second reconnect — which is how you get
    // two live sockets and a chart printing every trade twice.
    ws.onopen = () => {
      if (this.sock !== ws || this.disposed) return
      this.connectedAtWall = this.wall()
      this.lastMsgWall = this.connectedAtWall
      this.setStatus('live', this.venue)
      if (this.venue === 'coinbase') this.sendSub(true, [...this.syms.keys()])
    }
    ws.onmessage = (ev) => {
      if (this.sock !== ws || this.disposed) return
      this.onMessage(ev?.data)
    }
    ws.onerror = () => {
      if (this.sock !== ws || this.disposed) return
      this.down('socket error')
    }
    ws.onclose = () => {
      if (this.sock !== ws || this.disposed) return
      this.down('socket closed')
    }
    this.startHeartbeat()
  }

  private down(detail: string): void {
    const ws = this.sock
    this.sock = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      try {
        ws.close()
      } catch {
        // A socket that throws on close is already gone; there is nothing to do
        // about it and letting it escape would abort the reconnect.
      }
    }
    this.setStatus('error', detail)
    // Fall over to the other venue only when this connection never delivered a
    // single message. A venue that streamed and then dropped is working — moving
    // off it would swap a momentary blip for a whole different set of symbols and
    // a coarser history.
    if (!this.everMessaged) this.venue = this.venue === 'binance' ? 'coinbase' : 'binance'
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.disposed) return
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]
    this.attempt++
    const j = this.jitter()
    const delay = Math.max(0, Math.round(base * (1 + JITTER_FRAC * (j > 1 ? 1 : j < -1 ? -1 : j))))
    const h = setTimeout(() => {
      this.timers.delete(h)
      this.connect()
    }, delay)
    this.timers.add(h)
  }

  private startHeartbeat(): void {
    if (this.heartbeat !== null) return
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS)
  }

  private beat(): void {
    if (this.disposed) return
    this.beats++
    const w = this.wall()
    if (
      this.sock &&
      this.everMessaged &&
      this.connectedAtWall >= 0 &&
      w - this.connectedAtWall >= CLEAN_RESET_MS
    ) {
      this.attempt = 0
    }
    if (this.st === 'live' && this.lastMsgWall >= 0 && w - this.lastMsgWall >= STALL_MS) {
      // Reported, not acted on. The socket is still open as far as the browser is
      // concerned, and tearing down a connection that is merely quiet would loop
      // forever on a genuinely thin pair; a truly dead socket surfaces as a close
      // event, which is what the reconnect ladder is for.
      this.setStatus('stalled', `no data for ${Math.round((w - this.lastMsgWall) / 1000)}s`)
    }
  }

  private sendSub(on: boolean, symbols: string[]): void {
    const ws = this.sock
    if (!ws || symbols.length === 0) return
    const msg =
      this.venue === 'coinbase'
        ? {
            type: on ? 'subscribe' : 'unsubscribe',
            product_ids: symbols.map((s) => this.syms.get(s)?.product ?? s),
            channels: ['matches', 'level2_batch'],
          }
        : {
            method: on ? 'SUBSCRIBE' : 'UNSUBSCRIBE',
            params: symbols.flatMap((s) => [
              `${s.toLowerCase()}@aggTrade`,
              `${s.toLowerCase()}@depth20@100ms`,
            ]),
            id: this.beats + 1,
          }
    try {
      ws.send(JSON.stringify(msg))
    } catch (e) {
      this.fail(e)
    }
  }

  // ── messages ───────────────────────────────────────────────────────────────

  private onMessage(raw: unknown): void {
    this.lastMsgWall = this.wall()
    this.everMessaged = true
    // Data before `onopen` is possible with a polyfilled socket; the health window
    // has to start somewhere or the ladder would reset on the first heartbeat.
    if (this.connectedAtWall < 0) this.connectedAtWall = this.lastMsgWall
    if (this.st === 'stalled' || this.st === 'connecting') this.setStatus('live', this.venue)

    let msg: unknown
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw))
    } catch {
      // Truncated or non-JSON frame. Dropping it is the whole point: a live feed
      // degrades, it does not take the page down with it.
      return
    }
    try {
      if (this.venue === 'coinbase') this.onCoinbase(msg)
      else this.onBinance(msg)
    } catch (e) {
      this.fail(e)
    }
  }

  private onBinance(msg: unknown): void {
    const top = obj(msg)
    if (!top) return
    // Combined-stream frames wrap the payload; a single-stream endpoint does not.
    const data = obj(top.data) ?? top
    const stream = typeof top.stream === 'string' ? top.stream : ''

    if (data.e === 'aggTrade') {
      const sym = this.byWire.get(String(data.s ?? '').toLowerCase())
      const s = sym ? this.syms.get(sym) : undefined
      if (!s) return
      const p = num(data.p)
      const q = num(data.q)
      const t = num(data.T)
      if (!(p > 0) || !(q >= 0) || !Number.isFinite(t)) return
      // `m` is "was the BUYER the maker". True means a seller crossed the spread,
      // so the aggressor was a sell. Reading it the other way round paints every
      // trade the wrong colour and inverts every flow-based indicator downstream.
      this.refine(s, data.p, data.q)
      this.applyTrade(s, t, p, q, data.m === true ? -1 : 1)
      return
    }

    const bids = arr(data.bids ?? data.b)
    const asks = arr(data.asks ?? data.a)
    if (!bids || !asks) return
    const sym = this.byWire.get(stream.split('@')[0])
    const s = sym ? this.syms.get(sym) : undefined
    if (!s) return
    this.setLevels(s, bids, asks)
  }

  private onCoinbase(msg: unknown): void {
    const m = obj(msg)
    if (!m) return
    const type = m.type

    if (type === 'error') {
      this.fail(new Error(String(m.message ?? 'coinbase error')))
      return
    }

    if (type === 'match' || type === 'last_match') {
      const s = this.syms.get(this.byProduct.get(String(m.product_id ?? '')) ?? '')
      if (!s) return
      const p = num(m.price)
      const q = num(m.size)
      if (!(p > 0) || !(q >= 0)) return
      // ISO-8601 off the wire. Date.parse of a given string is a pure function of
      // that string — it is `Date.now()` and `new Date()` that read the machine's
      // clock, and neither appears anywhere in this file.
      const t = typeof m.time === 'string' ? Date.parse(m.time) : this.clock.now()
      // `side` is the MAKER's side, so the aggressor is the opposite one. Coinbase
      // documents this and everybody gets it backwards at least once.
      this.refine(s, m.price, m.size)
      this.applyTrade(s, Number.isFinite(t) ? t : this.clock.now(), p, q, m.side === 'sell' ? 1 : -1)
      return
    }

    if (type === 'snapshot') {
      const s = this.syms.get(this.byProduct.get(String(m.product_id ?? '')) ?? '')
      if (!s) return
      s.l2 = { bids: new Map(), asks: new Map() }
      this.loadL2(s.l2.bids, arr(m.bids))
      this.loadL2(s.l2.asks, arr(m.asks))
      this.rebuildL2(s)
      return
    }

    if (type === 'l2update') {
      const s = this.syms.get(this.byProduct.get(String(m.product_id ?? '')) ?? '')
      if (!s || !s.l2) return
      for (const c of arr(m.changes) ?? []) {
        const row = arr(c)
        if (!row || row.length < 3) continue
        const side = row[0] === 'buy' ? s.l2.bids : row[0] === 'sell' ? s.l2.asks : undefined
        const p = num(row[1])
        const q = num(row[2])
        if (!side || !(p > 0) || !Number.isFinite(q)) continue
        // Size 0 is a removal, not a level resting at nothing. Keeping it would
        // leave a phantom best bid that fillPrice would happily quote against.
        if (q > 0) side.set(p, q)
        else side.delete(p)
      }
      this.rebuildL2(s)
    }
  }

  private loadL2(into: Map<number, number>, rows: unknown[] | undefined): void {
    for (const r of rows ?? []) {
      const row = arr(r)
      if (!row) continue
      const p = num(row[0])
      const q = num(row[1])
      if (p > 0 && q > 0) into.set(p, q)
    }
  }

  /** Top BOOK_DEPTH of each side, taken in one pass. A full sort of a Coinbase
   *  snapshot (thousands of levels) every batched update would cost more than the
   *  rest of the adapter put together. */
  private rebuildL2(s: LiveSymbol): void {
    if (!s.l2) return
    s.bidQty = takeTop(s.l2.bids, s.bk.bids, true)
    s.askQty = takeTop(s.l2.asks, s.bk.asks, false)
    this.afterBook(s)
  }

  /** Binance re-sends the whole top of book, so the arrays are simply refilled. */
  private setLevels(s: LiveSymbol, bids: unknown[], asks: unknown[]): void {
    s.bidQty = fillSide(s.bk.bids, bids, true)
    s.askQty = fillSide(s.bk.asks, asks, false)
    this.afterBook(s)
  }

  private afterBook(s: LiveSymbol): void {
    if (s.bk.bids.length === 0 || s.bk.asks.length === 0) return
    s.bk.t = this.clock.now()
    s.q.bid = s.bk.bids[0].p
    s.q.ask = s.bk.asks[0].p
    // Live has no index feed on these streams, so mark and index are both the
    // book's mid. Honest rather than clever: the sandbox never liquidates against
    // a venue's real index, and inventing one would be a number with no source.
    const mid = (s.q.bid + s.q.ask) / 2
    s.q.markPrice = mid
    s.q.indexPrice = mid
    if (!s.seen) {
      s.seen = true
      s.q.last = s.q.last > 0 ? s.q.last : mid
    }
    s.q.t = s.bk.t
    for (const l of this.listeners) l.onBook?.(s.symbol)
  }

  /**
   * Widen the instrument's precision to fit what the wire just showed us. Never
   * narrow it.
   *
   * `decimalsOfString` can only under-state (a round price looks coarse), so a
   * `!==` here would let the tick churn print to print — `68123.45` then
   * `68123.00` would flip 0.01 → 1 → 0.01 — and drag every consumer with it.
   * Widening only, seeded from the constructor's provisional, makes precision
   * monotonic and bounded: at most a handful of changes per symbol per session,
   * and in practice none for BTCUSDT, whose 2 the provisional already has.
   *
   * The two halves are deliberately asymmetric. Price starts at 2 and may grow,
   * because too-fine a price is a DISPLAY bug and too-coarse a one is unreadable.
   * Quantity starts at the venue maximum of 8, so this branch is a no-op by
   * construction — that is the point. A too-fine lot size is merely permissive,
   * whereas letting a first `q: "0.25000000"` set `lotSize: 0.01` would have the
   * broker REJECT an order for 0.005 BTC: a functional regression traded for a
   * cosmetic non-issue. Leave the branch in so the rule stays one rule.
   */
  private refine(s: LiveSymbol, price: unknown, size: unknown): void {
    const pd = decimalsOfString(price)
    if (pd > s.inst.pricePrecision) {
      s.inst = { ...s.inst, pricePrecision: pd, tickSize: Math.pow(10, -pd) }
    }
    const qd = decimalsOfString(size)
    if (qd > s.inst.qtyPrecision) {
      s.inst = { ...s.inst, qtyPrecision: qd, lotSize: Math.pow(10, -qd) }
    }
  }

  private applyTrade(s: LiveSymbol, t: SimTime, p: Px, q: Qty, side: 1 | -1): void {
    this.clock.stamp(t)
    s.q.t = t
    s.q.last = p
    if (!s.seen) {
      s.seen = true
      // A book may have arrived first and already set these; a trade-first symbol
      // has to quote something, and its own print is the only price there is.
      if (!(s.q.bid > 0)) {
        s.q.bid = p
        s.q.ask = p
        s.q.markPrice = p
        s.q.indexPrice = p
      }
    }
    // The 24h window is measured from the first PRINT we saw — tracked separately
    // from `seen`, which a depth message can set — and not from the venue's own
    // rolling window, because these streams carry no ticker. It is right within a
    // session and understated before the session is a day old, which is why the
    // UI must label it as such rather than claim it came from the exchange.
    if (s.rolled24At === 0) {
      s.rolled24At = t
      s.q.open24h = p
      s.q.high24h = p
      s.q.low24h = p
      s.q.volume24h = 0
    }
    if (t - s.rolled24At >= 86_400_000) {
      s.rolled24At = t
      s.q.open24h = p
      s.q.high24h = p
      s.q.low24h = p
      s.q.volume24h = 0
    }
    if (p > s.q.high24h) s.q.high24h = p
    if (p < s.q.low24h || !(s.q.low24h > 0)) s.q.low24h = p
    s.q.volume24h += q

    for (let i = 0; i < s.aggs.length; i++) s.aggs[i].onTick(t, p, q, side)
    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i].onTick?.(s.symbol, t, p, q, side)
    }
  }

  // ── history ────────────────────────────────────────────────────────────────

  /**
   * REST klines, merged into the aggregator so the chart sees one continuous
   * series rather than a bootstrap array beside a live one.
   *
   * Only bars OLDER than what the aggregator already holds are taken. A REST bar
   * that overlaps the forming one would overwrite trades we watched arrive with
   * the venue's snapshot of the same bucket, and the bar would visibly jump back.
   */
  async history(symbol: string, tf: Timeframe, count: number): Promise<Candle[]> {
    const s = this.syms.get(symbol)
    if (!s || count <= 0) return []
    const fetched = await this.fetchBars(symbol, tf, count)
    const agg = s.byTf.get(tf)
    if (!agg) return fetched.slice(Math.max(0, fetched.length - count))

    const live = agg.toArray()
    if (live.length === 0) {
      if (fetched.length > 0) agg.loadArray(fetched)
      return fetched.slice(Math.max(0, fetched.length - count))
    }
    const older = fetched.filter((b) => b.t < live[0].t)
    if (older.length === 0) return live.slice(Math.max(0, live.length - count))
    const merged = older.concat(live)
    agg.loadArray(merged)
    return merged.slice(Math.max(0, merged.length - count))
  }

  private async getJson(url: string): Promise<unknown> {
    try {
      const r = await this.fetchImpl(url)
      if (!r || !r.ok) {
        this.fail(new Error(`GET ${url} -> ${r ? (r.status ?? 'not ok') : 'no response'}`))
        return undefined
      }
      return await r.json()
    } catch (e) {
      // A failed history fetch is a chart with fewer bars, never a broken page.
      this.fail(e)
      return undefined
    }
  }

  private async fetchBars(symbol: string, tf: Timeframe, count: number): Promise<Candle[]> {
    return this.venue === 'coinbase'
      ? this.fetchCoinbaseBars(symbol, tf, count)
      : this.fetchBinanceBars(symbol, tf, count)
  }

  private async fetchBinanceBars(symbol: string, tf: Timeframe, count: number): Promise<Candle[]> {
    // Binance has no 5s or 15s kline, so those are built from 1s bars.
    const src: Timeframe = tf === '5s' || tf === '15s' ? '1s' : tf
    const mult = TF_MS[tf] / TF_MS[src]
    const limit = Math.min(1000, Math.max(1, Math.ceil(count * mult)))
    const url = `${this.base('rest')}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${src}&limit=${limit}`
    const rows = arr(await this.getJson(url))
    if (!rows) return []

    const out: Candle[] = []
    for (const r of rows) {
      const row = arr(r)
      if (!row || row.length < 6) continue
      const t = num(row[0])
      const o = num(row[1])
      const h = num(row[2])
      const l = num(row[3])
      const c = num(row[4])
      const v = num(row[5])
      if (!Number.isFinite(t) || !(o > 0) || !(h > 0) || !(l > 0) || !(c > 0)) continue
      out.push({ t, o, h, l, c, v: Number.isFinite(v) ? v : 0, n: Math.max(0, num(row[8]) || 0) })
    }
    return mult > 1 ? bucketize(out, TF_MS[tf]) : out
  }

  /** Coinbase granularities are a fixed set: 60/300/900/3600/21600/86400 seconds.
   *  Anything under a minute has no source at all and returns nothing — an empty
   *  chart the UI can explain beats bars we made up. 4h is built from 1h. */
  private async fetchCoinbaseBars(symbol: string, tf: Timeframe, count: number): Promise<Candle[]> {
    const GRAN: Partial<Record<Timeframe, number>> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1h': 3600,
      '4h': 3600,
      '1d': 86400,
    }
    const g = GRAN[tf]
    const s = this.syms.get(symbol)
    if (!g || !s) return []
    const url = `${this.base('rest')}/products/${encodeURIComponent(s.product)}/candles?granularity=${g}`
    const rows = arr(await this.getJson(url))
    if (!rows) return []

    const out: Candle[] = []
    for (const r of rows) {
      const row = arr(r)
      if (!row || row.length < 6) continue
      // [ time, low, high, open, close, volume ] — seconds, and NEWEST FIRST.
      const t = num(row[0])
      const l = num(row[1])
      const h = num(row[2])
      const o = num(row[3])
      const c = num(row[4])
      const v = num(row[5])
      if (!Number.isFinite(t) || !(o > 0) || !(h > 0) || !(l > 0) || !(c > 0)) continue
      // No trade count in this endpoint; 0 is truthful, a guess would not be.
      out.push({ t: t * 1000, o, h, l, c, v: Number.isFinite(v) ? v : 0, n: 0 })
    }
    out.sort((a, b) => a.t - b.t)
    const bars = g * 1000 === TF_MS[tf] ? out : bucketize(out, TF_MS[tf])
    return bars.slice(Math.max(0, bars.length - count))
  }

  // ── persistence ────────────────────────────────────────────────────────────

  /**
   * Seed-less, with no markets — and that is the honest answer, not a stub.
   *
   * A WorldSnapshot exists so a sim can be rebuilt exactly where it stopped. Live
   * prices came from an exchange; nothing in this process can reproduce them, and
   * a snapshot carrying a seed or a MarketState would be inviting the persistence
   * layer to restore a world that never existed. What IS worth saving is where sim
   * time had reached, so the resume path can size its REST backfill — so the clock
   * travels and nothing else does. Handing this to `createSimFeed` as `restore`
   * yields an empty sim, which is exactly right: there is no live world to rebuild.
   */
  snapshot(): WorldSnapshot {
    return {
      version: 1,
      seed: '',
      clock: this.clock.snapshot(),
      savedAtWall: 0,
      markets: {},
    }
  }

  /** Idempotent: the runtime is refcounted and StrictMode double-unmounts, so a
   *  second call must be silent rather than throwing on an already-closed socket. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const h of this.timers) clearTimeout(h)
    this.timers.clear()
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    const ws = this.sock
    this.sock = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      try {
        ws.close(1000, 'disposed')
      } catch {
        // Already gone.
      }
    }
    for (const s of this.syms.values()) for (const off of s.offs) off()
    this.syms.clear()
    this.byWire.clear()
    this.byProduct.clear()
    this.listeners.length = 0
    this.st = 'idle'
  }
}

// ── level helpers ────────────────────────────────────────────────────────────

/**
 * Refill one side in place from wire rows, sorted the way OrderBook promises:
 * bids descending, asks ascending.
 *
 * Sorted defensively even though both venues already send them in order — an
 * out-of-order side makes fillPrice walk the book from the wrong end and quote a
 * fill BETTER than the top of book, which looks like free money in the P&L and
 * like nothing at all in the code.
 *
 * The level objects are reused across updates (the OrderBook contract), so a
 * caller keeping one past the next message is holding a moving number.
 */
function fillSide(out: BookLevel[], rows: unknown[], desc: boolean): Qty {
  let n = 0
  for (const r of rows) {
    const row = arr(r)
    if (!row || row.length < 2) continue
    const p = num(row[0])
    const q = num(row[1])
    if (!(p > 0) || !(q > 0)) continue
    if (n === out.length) out.push({ p: 0, q: 0 })
    out[n].p = p
    out[n].q = q
    n++
  }
  out.length = n
  // Sort BEFORE truncating: taking twenty rows and then ordering them would keep
  // the wrong twenty the day a venue sends a side out of order.
  out.sort(desc ? (a, b) => b.p - a.p : (a, b) => a.p - b.p)
  if (out.length > BOOK_DEPTH) out.length = BOOK_DEPTH
  let total = 0
  for (const lv of out) total += lv.q
  return total
}

/** Best BOOK_DEPTH levels of a full L2 side, by insertion into the output array.
 *  The returned size is the VISIBLE depth, matching fillSide, so fillPrice's tail
 *  is scaled against the same thing on both venues. */
function takeTop(src: Map<number, number>, out: BookLevel[], desc: boolean): Qty {
  out.length = 0
  for (const [p, q] of src) {
    if (!(p > 0) || !(q > 0)) continue
    let i = out.length
    while (i > 0 && (desc ? out[i - 1].p < p : out[i - 1].p > p)) i--
    if (i >= BOOK_DEPTH) continue
    out.splice(i, 0, { p, q })
    if (out.length > BOOK_DEPTH) out.length = BOOK_DEPTH
  }
  let total = 0
  for (const lv of out) total += lv.q
  return total
}

export function createLiveFeed(o: LiveFeedOptions): MarketFeed {
  return new LiveFeed(o)
}
