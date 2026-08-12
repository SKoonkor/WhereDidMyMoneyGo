// The living simulation: one world, one loop, one place that decides when
// anything is written down.
//
// Three rules shape every line of this file.
//
// 1. IT IS A SINGLETON, REFCOUNTED, AND ITS TEARDOWN IS DEFERRED BY A MACROTASK.
//    React 19 StrictMode mounts, unmounts and remounts every component in dev.
//    A naive `useEffect(() => { build(); return destroy })` therefore builds the
//    market, throws it away and builds it again — with a fresh RNG — on every hot
//    reload, which shows up as a price that jumps for no reason and gets
//    diagnosed as an engine bug for days. `releaseRuntime` schedules the teardown
//    instead of performing it, and an `acquireRuntime` inside that window cancels
//    it, so 1 → 0 → 1 never tears the world down.
//
// 2. TWO LOOPS, DECOUPLED. The feed pumps on a `setInterval` at 20 Hz, NOT on
//    rAF: rAF is throttled to a crawl in a background tab and the market would
//    quietly stop. React is notified at 8 Hz — fast enough that a number never
//    looks stuck, slow enough that a 60-line positions table is not re-rendered
//    sixty times a second. Anything that genuinely needs 60fps (the chart) reads
//    this object inside its OWN rAF and does not subscribe at all.
//
// 3. THE TICK LOOP WRITES NOTHING. Every write goes through `store.flush(reason)`,
//    which is called when the tab hides, when the app goes idle, when the user
//    does something, and on unmount. An IndexedDB commit lands on the main thread
//    in Safari; a write per tick would stutter the very chart it exists to draw.

import { createSimFeed, type FeedStatus, type MarketFeed, type WorldSnapshot } from '../../lib/trading/market/feed'
import { createLiveFeed, type FetchLike, type SocketFactory } from '../../lib/trading/market/live'
import { PRESETS, type MarketParams } from '../../lib/trading/market/model'
import type { CandleSeries } from '../../lib/trading/market/candles'
import {
  cancelOrder, createAccount, deposit, placeOrder, previewOrder, step, withdraw,
  type OrderPreview, type OrderRequest, type PlaceResult,
} from '../../lib/trading/broker/engine'
import type { BrokerAccount, BrokerEvent, Trade, TradeError } from '../../lib/trading/broker/types'
import { pushEquity, type EquityPoint } from '../../lib/trading/broker/analytics'
import { uuid } from '../../lib/trading/ids'
import { MAX_CATCHUP_SIM_MS, TF_MS, type OrderBook, type Quote, type SimTime, type Timeframe } from '../../lib/trading/types'
import { createChartBars, type ChartBars } from './chartData'
import { createMarketView, type TradingMarketView } from './marketView'
import * as store from './store'
import { DEFAULT_TRADING, type TradingCfg } from '../../data/defaults'

// ── Tuning ───────────────────────────────────────────────────────────────────

/** How often React is told something changed. Deliberately far below frame rate. */
export const NOTIFY_HZ = 8
/** How often the world is driven. 20 Hz keeps a 1× chart smooth without asking
 *  the market to generate ticks it will never draw. */
export const PUMP_HZ = 20

const NOTIFY_MS = 1000 / NOTIFY_HZ
const PUMP_MS = 1000 / PUMP_HZ

/**
 * The most real time one pump may consume.
 *
 * A tab that was throttled rather than hidden (an inactive window, a phone in a
 * pocket) can deliver an interval callback minutes late. Handing that whole gap
 * to `pump` would generate minutes of ticks inside one frame and freeze the UI;
 * anything larger than this is the resume path's business, where it gets a
 * progress bar and is sliced.
 */
const MAX_PUMP_MS = 2_000

/** Below this, a gap is not worth a progress bar — it is just a slow frame. */
const MIN_CATCHUP_MS = 5_000

/** Opportunistic write-out, so a session that is left open overnight is not one
 *  crash away from having recorded nothing. */
const IDLE_FLUSH_MS = 20_000

/** Trades and equity points held in memory for the UI. The blotter shows the tail
 *  and the curve is capped at MAX_CURVE by the store anyway. */
const RECENT_TRADES = 400

/** Prune stored candles older than this much sim time (D.5). */
const BAR_RETENTION_MS = 30 * 86_400_000

/** The starting watchlist: one of each personality the market model can wear, so
 *  the sandbox has something calm and something violent in it from the first run. */
const WATCHLIST: MarketParams[] = [PRESETS.btc, PRESETS.eth, PRESETS.bluechip, PRESETS.meme, PRESETS.forex, PRESETS.index]

/**
 * The live watchlist. Binance pairs ONLY, and deliberately shorter than the sim's.
 *
 * The simulated watchlist carries AAPL, SPX500 and EURUSD — markets the model
 * invents and no crypto venue has ever heard of. Subscribing to them would be
 * three streams that never deliver a message and three REST calls that 404, and
 * the user would be told the feed had stalled when in truth the symbols do not
 * exist there. Restricting the list is the honest answer; live equities are a
 * different venue and a different piece of work.
 */
const LIVE_SYMBOLS: readonly string[] = ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT']

/**
 * How long live mode gets to produce its first message before the sandbox gives
 * up and goes back to the simulation.
 *
 * The whole app works offline; live mode is the single thing in it that cannot,
 * so it is the single thing that has to fail quickly and say why. Without this a
 * plane, a captive portal or a corporate proxy that blocks websockets leaves the
 * user on an empty chart watching a reconnect ladder they have no way to read.
 */
const LIVE_CONNECT_MS = 15_000

/** What a paper account opens with. Round, and large enough that a 25% quick-size
 *  on a BTC ticket is not a dust order. */
export const START_CASH = 100_000

/** Old configs (and anyone typing a ticker) name the asset, not the pair. Mapping
 *  rather than rejecting: `feed.add` would happily invent a market called "BTC" at
 *  a hash-derived price, and two different BTCs in one watchlist is a bug report
 *  nobody can make sense of. */
const ALIASES: Readonly<Record<string, string>> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', DOGE: 'DOGEUSDT', AAPL: 'AAPL', SPX: 'SPX500', EUR: 'EURUSD',
}

export interface CatchUpState {
  active: boolean
  /** Sim milliseconds already made up, and the total being made up. */
  done: number
  total: number
}

/**
 * Why live mode is not on, when the user asked for it.
 *
 * A code rather than a sentence, exactly as `TradeErrorCode` is: the components
 * own the words and `errors.ts` owns the mapping, so nothing here ships an
 * English string that a translator cannot reach.
 *
 *   offline      the browser says there is no network, so the socket was never
 *                opened — there is nothing to wait for
 *   unreachable  the socket was opened and had LIVE_CONNECT_MS to deliver a first
 *                message; it did not
 */
export type LiveNotice = 'offline' | 'unreachable' | null

export interface TradingRuntime {
  readonly feed: MarketFeed
  readonly market: TradingMarketView
  readonly account: BrokerAccount | undefined
  readonly accounts: readonly BrokerAccount[]
  readonly cfg: TradingCfg
  /** The chart's columns for the selected symbol and timeframe. Kept in step by
   *  the loop; the chart reads it inside its own rAF. */
  readonly bars: ChartBars
  readonly symbol: string
  readonly timeframe: Timeframe
  readonly status: FeedStatus
  readonly catchUp: CatchUpState
  readonly trades: readonly Trade[]
  readonly equity: readonly EquityPoint[]
  /** Which engine is actually running. `cfg.mode` is what the user ASKED for; the
   *  two differ for as long as it takes a refused live mode to be noticed. */
  readonly mode: 'sim' | 'live'
  readonly liveNotice: LiveNotice

  series(symbol: string, tf: Timeframe): CandleSeries | undefined
  quote(symbol: string): Quote | undefined
  book(symbol: string): OrderBook | undefined

  /** Fires at ≤ NOTIFY_HZ. */
  subscribe(cb: () => void): () => void
  /** Every broker event, unthrottled — for toasts and sounds, which must not miss
   *  a fill just because two landed inside one notify window. */
  events(cb: (e: BrokerEvent) => void): () => void
  getVersion(): number

  preview(r: OrderRequest): OrderPreview | { error: TradeError }
  place(r: OrderRequest): PlaceResult
  cancel(id: string): boolean
  deposit(amount: number): PlaceResult
  withdraw(amount: number): PlaceResult

  setSpeed(v: number): void
  setPaused(p: boolean): void
  setSymbol(s: string): void
  setTimeframe(tf: Timeframe): void
  patchCfg(p: Partial<TradingCfg>): void
  addSymbol(s: string): void
  /** Swap the engine under the whole app: dispose the feed, build the other one,
   *  re-point the market view and the chart, and persist the choice. */
  switchMode(m: 'sim' | 'live'): Promise<void>

  newAccount(name: string, startCash: number): Promise<void>
  selectAccount(id: string): Promise<void>
  dropAccount(id: string): Promise<void>

  /** Erase the sandbox and rebuild an empty one, in place. */
  reset(): Promise<void>
  flushNow(reason: store.FlushReason): Promise<void>
}

// ── Wall clock ───────────────────────────────────────────────────────────────
// The engine is forbidden from reading it (purity.test.ts). The runtime is the
// layer that is allowed to know what time it is, so every read lives here.

const nowMs = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()

/**
 * The browser's own answer, and it is only ever worth trusting when it says NO.
 *
 * `navigator.onLine === true` means "there is an interface up", which a captive
 * portal also satisfies — that case is the connect watchdog's job. `false` is the
 * one reliable signal, and acting on it saves opening a socket that can only fail.
 */
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

/**
 * The snapshot a BRAND-NEW sim world starts from.
 *
 * `SimTime` is milliseconds since the epoch, and `createClock()` with nothing to
 * restore starts at zero — so an unseeded sandbox stamps every trade, equity point
 * and candle 1 Jan 1970. It is invisible on an intraday time axis and glaring the
 * moment the blotter formats a date.
 *
 * Seeding it here rather than in the clock is the same division of labour as
 * `WorldSnapshot.savedAtWall`: nothing under lib/trading/ may read the wall clock
 * (purity.test.ts), so the caller supplies the instant.
 *
 * It has to go in through `restore` rather than `clock.restore()` after the fact,
 * and that is the whole subtlety. `SimFeed` stamps each fresh market's `t0` with
 * `clock.now()` as it spawns it, and `advanceTo` walks `(now - t0) / quantum`
 * quanta — so a clock moved to 2026 over markets left at t0 = 0 would ask the
 * model for fifty-six years of ticks in one frame and hang the page. Handing the
 * clock over at construction means the markets are born at the same instant.
 */
function freshWorld(seed: string, startedAt: number): WorldSnapshot {
  return {
    version: 1,
    seed,
    clock: { simNow: startedAt, speed: 1, residual: 0, paused: false },
    savedAtWall: 0,
    // Empty on purpose: every symbol spawns fresh, at the clock above.
    markets: {},
  }
}

function normalise(symbol: string, known: readonly string[]): string {
  if (known.includes(symbol)) return symbol
  const alias = ALIASES[symbol.toUpperCase()]
  return alias && known.includes(alias) ? alias : known[0]
}

/**
 * Test seam for live mode. Never set by the app.
 *
 * A live feed built with the real transport opens a websocket to Binance the
 * instant it is constructed, so a test of mode switching would either hit the
 * network — slow, flaky, offline-broken, rate-limited — or not exist. Injecting
 * the socket and fetch is what `live.ts` already offers for its own suite; this
 * passes the same two through from one layer up.
 */
export interface LiveTransport {
  socketImpl?: SocketFactory
  fetchImpl?: FetchLike
  /** Overrides LIVE_CONNECT_MS, so the give-up path is testable in milliseconds
   *  rather than in fifteen real seconds. */
  connectMs?: number
}

let liveTransport: LiveTransport = {}

/** Test seam. Never called by the app. */
export function _setLiveTransport(t: LiveTransport): void {
  liveTransport = t
}

// ── The instance ─────────────────────────────────────────────────────────────

class Runtime implements TradingRuntime {
  feed!: MarketFeed
  market!: TradingMarketView
  accounts: BrokerAccount[] = []
  cfg: TradingCfg = { ...DEFAULT_TRADING }
  bars: ChartBars = createChartBars()
  trades: Trade[] = []
  equity: EquityPoint[] = []
  catchUp: CatchUpState = { active: false, done: 0, total: 0 }
  liveNotice: LiveNotice = null

  private accountId: string | null = null
  private version = 0
  private subs = new Set<() => void>()
  private evSubs = new Set<(e: BrokerEvent) => void>()

  private pump: ReturnType<typeof setInterval> | null = null
  private idle: ReturnType<typeof setInterval> | null = null
  private lastWall = 0
  private lastNotify = 0
  /** Reused across ticks: `step` fills an out-parameter, and allocating an array
   *  twenty times a second for the ninety-nine ticks in a hundred that produce
   *  nothing is pure garbage. */
  private events_: BrokerEvent[] = []
  private hiddenAt = 0
  private disposed = false
  private onVisible?: () => void
  private onHide?: () => void
  private liveWatchdog: ReturnType<typeof setTimeout> | null = null
  /** One mode change at a time. The toggle is two taps apart from itself and the
   *  swap is asynchronous; re-entering it would dispose a feed twice. */
  private switching = false

  get account(): BrokerAccount | undefined {
    return this.accounts.find((a) => a.id === this.accountId) ?? this.accounts[0]
  }

  get symbol(): string {
    return this.cfg.symbol
  }

  get timeframe(): Timeframe {
    return this.cfg.timeframe
  }

  get status(): FeedStatus {
    return this.catchUp.active ? 'catching-up' : this.feed.status
  }

  get mode(): 'sim' | 'live' {
    return this.feed.mode
  }

  // ── Construction ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    this.cfg = await store.getTrading()
    // A config that asks for live mode on a device with no network gets the
    // simulation and is told why, rather than an empty chart on a reconnect
    // ladder. The choice is rewritten rather than remembered: `cfg.mode` must
    // never claim an engine that is not the one running.
    if (this.cfg.mode === 'live' && !isOnline()) {
      this.cfg = { ...this.cfg, mode: 'sim' }
      this.liveNotice = 'offline'
      void store.saveTrading(this.cfg)
    }
    const saved = this.cfg.mode === 'sim' ? await store.loadWorld() : null

    this.feed = this.cfg.mode === 'live' ? this.makeLiveFeed() : this.makeSimFeed(saved)
    this.market = createMarketView(this.feed)
    this.cfg.symbol = normalise(this.cfg.symbol, this.feed.symbols())

    const rows = (await store.listAccounts()) as unknown as BrokerAccount[]
    // Validated, not merged: a row without positions or settings is not an account,
    // and quietly patching one into shape would hide a corrupt write forever.
    this.accounts = rows.filter((a) => a && typeof a.id === 'string' && a.positions && a.settings)
    if (this.accounts.length === 0) {
      this.accounts = [createAccount({
        id: uuid(), name: 'Paper account', currency: 'USDT', startCash: START_CASH, now: this.feed.clock.now(),
      })]
      await store.saveAccount(this.accounts[0])
    }
    this.accountId = this.cfg.selectedAccountId ?? this.accounts[0].id
    if (!this.accounts.some((a) => a.id === this.accountId)) this.accountId = this.accounts[0].id

    this.feed.clock.speed = this.cfg.speed
    await this.loadHistory()
    await this.loadLedger()

    this.attachLifecycle()
    this.start()
    if (this.feed.mode === 'live') this.armLiveWatchdog()

    // The market kept running while the app was closed. Sized off the WALL gap,
    // 1:1 with sim time rather than scaled by `speed` — the user's intuition is
    // "I was away three hours", not "I was away three hours at sixty times".
    if (saved && saved.savedAtWall > 0) {
      const elapsed = Date.now() - saved.savedAtWall
      if (elapsed > MIN_CATCHUP_MS) void this.runCatchUp(elapsed)
    }
  }

  private makeSimFeed(saved: Awaited<ReturnType<typeof store.loadWorld>>): MarketFeed {
    // Rows are stored WHOLE (store.ts), so a saved world still carries every
    // MarketState the feed put in it — `SimWorld` simply does not NAME them,
    // because persistence was built before the market engine existed. The cast
    // asserts what the store guarantees and nothing more; a world without
    // `markets` is a backup restore, which starts fresh from the seed instead.
    const seed = saved?.seed || uuid()
    return createSimFeed({
      seed,
      symbols: WATCHLIST,
      restore: saved && saved.markets ? (saved as WorldSnapshot) : freshWorld(seed, Date.now()),
      wallMs: nowMs,
    })
  }

  /**
   * The live crypto feed.
   *
   * `wallMs` and `now` are injected because nothing under lib/trading/ may read
   * the wall clock — the feed needs one for silence detection and reconnect
   * spacing, and the other only to place its clock before the first exchange
   * timestamp arrives, after which the venue's own stamps take over.
   *
   * `onError` is deliberately swallowed. Every failure that matters is already on
   * `feed.status`, which the chart's pill reads; a REST call that 404s while the
   * socket streams happily is a chart with fewer history bars, not an incident.
   */
  private makeLiveFeed(): MarketFeed {
    return createLiveFeed({
      symbols: [...LIVE_SYMBOLS],
      wallMs: nowMs,
      now: () => Date.now(),
      onError: () => {},
      socketImpl: liveTransport.socketImpl,
      fetchImpl: liveTransport.fetchImpl,
    })
  }

  /** Seed the chart: persisted bars first, topped up with the feed's invented
   *  history where the sandbox has not actually run that far back. A chart that
   *  opens on six visible candles reads as broken even though it is honest. */
  private async loadHistory(): Promise<void> {
    const { symbol, timeframe } = this.cfg
    const want = 400
    const stored = await this.storedBars(symbol, timeframe, want)
    if (stored.length >= want) {
      this.bars.seed(stored)
      return
    }
    const invented = await this.feed.history(symbol, timeframe, want - stored.length)
    const oldest = stored.length ? stored[0].t : Infinity
    this.bars.seed([...invented.filter((b) => b.t < oldest), ...stored])
  }

  /**
   * Persisted candles, filtered to the ones that belong to the world now running.
   *
   * Two ways a stored bar can be someone else's:
   *
   *   • It is the SIM's, and we are live. Both worlds call the market BTCUSDT and
   *     one of them made its prices up; splicing them would draw a modelled candle
   *     beside a real one on the same axis. Live bootstraps from REST alone.
   *   • It predates the clock this world runs on — a sandbox written before the
   *     clock was seeded from the wall (see `freshWorld`) holds 1970 bars, and
   *     seeding the chart with them would leave a fifty-six-year gap.
   *
   * The retention window is the same one `pruneBars` enforces, so the filter never
   * discards a bar the store would have kept.
   */
  private async storedBars(symbol: string, tf: Timeframe, want: number) {
    if (this.feed.mode === 'live') return []
    const now = this.feed.clock.now()
    const rows = await store.loadBars(symbol, tf, want)
    return rows.filter((b) => b.t <= now && now - b.t <= BAR_RETENTION_MS)
  }

  private async loadLedger(): Promise<void> {
    const a = this.account
    if (!a) return
    this.trades = (await store.listTrades(a.id, RECENT_TRADES)) as unknown as Trade[]
    this.equity = await store.listEquity(a.id)
  }

  // ── The loop ───────────────────────────────────────────────────────────────

  private start(): void {
    if (this.pump !== null) {
      // D.1's dev-only assertion. Two pumps would advance the clock at double
      // speed, which looks exactly like a mis-tuned market model.
      if (import.meta.env?.DEV) console.warn('[trading] pump already running')
      return
    }
    this.lastWall = nowMs()
    this.pump = setInterval(() => this.tick(), PUMP_MS)
    this.idle = setInterval(() => { void this.flushNow('idle') }, IDLE_FLUSH_MS)
  }

  private stop(): void {
    if (this.pump !== null) clearInterval(this.pump)
    if (this.idle !== null) clearInterval(this.idle)
    this.pump = null
    this.idle = null
  }

  private tick(): void {
    if (this.disposed || this.catchUp.active) return
    const wall = nowMs()
    const dt = Math.min(wall - this.lastWall, MAX_PUMP_MS)
    this.lastWall = wall
    if (!(dt > 0)) return

    this.feed.pump(dt)
    this.runBroker()
    this.syncBars()

    if (wall - this.lastNotify >= NOTIFY_MS) {
      this.lastNotify = wall
      this.notify()
    }
  }

  private runBroker(): void {
    const a = this.account
    if (!a) return
    const out = this.events_
    out.length = 0
    step(a, this.market, out, { settle: (p, m, t) => this.market.settle(p, m, t) })
    if (out.length) this.drain(a, out)
  }

  /**
   * Turn engine events into user-visible state.
   *
   * Trades are the only thing here that reaches the database immediately —
   * `appendTrades` stages AND flushes, because losing the record of a fill the
   * user watched happen is the one failure that would make the sandbox feel
   * broken rather than merely slow. Everything else waits for a gate.
   */
  private drain(a: BrokerAccount, out: BrokerEvent[]): void {
    const fresh: Trade[] = []
    for (const e of out) {
      if (e.type === 'fill') fresh.push(e.trade)
      else if (e.type === 'equity') {
        // `pushEquity` applies SNAPSHOT_MIN_GAP itself and reports whether the
        // point was kept, so only the kept ones are staged.
        if (pushEquity(this.equity, { t: e.t, v: e.v }, false)) {
          void store.appendEquity(a.id, [{ t: e.t, v: e.v }])
        }
      }
      for (const cb of this.evSubs) cb(e)
    }
    if (fresh.length) {
      this.trades.push(...fresh)
      if (this.trades.length > RECENT_TRADES) this.trades.splice(0, this.trades.length - RECENT_TRADES)
      void store.appendTrades(fresh)
    }
  }

  private syncBars(): void {
    const s = this.feed.series(this.cfg.symbol, this.cfg.timeframe)
    if (!s) return
    const { symbol, timeframe } = this.cfg
    // Live bars are never persisted: they are the exchange's, they would collide
    // with the sim's under the same symbol, and the exchange will serve them again
    // over REST for free. See `storedBars`.
    if (this.feed.mode === 'live') this.bars.sync(s)
    else this.bars.sync(s, (b) => { void store.saveBars(symbol, timeframe, [b]) })
  }

  // ── Notification ───────────────────────────────────────────────────────────

  private notify(): void {
    this.version++
    for (const cb of this.subs) cb()
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb)
    return () => { this.subs.delete(cb) }
  }

  events(cb: (e: BrokerEvent) => void): () => void {
    this.evSubs.add(cb)
    return () => { this.evSubs.delete(cb) }
  }

  getVersion(): number {
    return this.version
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  series(symbol: string, tf: Timeframe) { return this.feed.series(symbol, tf) }
  quote(symbol: string) { return this.market.quote(symbol) }
  book(symbol: string) { return this.feed.book(symbol) }

  // ── Orders ─────────────────────────────────────────────────────────────────

  preview(r: OrderRequest): OrderPreview | { error: TradeError } {
    const a = this.account
    if (!a) return { error: { code: 'no-symbol' } }
    return previewOrder(a, this.market, r)
  }

  place(r: OrderRequest): PlaceResult {
    const a = this.account
    if (!a) return { ok: false, error: { code: 'no-symbol' } }
    const res = placeOrder(a, this.market, r)
    if (res.ok) {
      if (res.outcome === 'filled') {
        this.trades.push(res.trade)
        void store.appendTrades([res.trade])
      }
      void this.flushNow('action')
    }
    this.notify()
    return res
  }

  cancel(id: string): boolean {
    const a = this.account
    if (!a) return false
    const ok = cancelOrder(a, id)
    if (ok) void this.flushNow('action')
    this.notify()
    return ok
  }

  deposit(amount: number): PlaceResult {
    return this.cash(amount, true)
  }

  withdraw(amount: number): PlaceResult {
    return this.cash(amount, false)
  }

  private cash(amount: number, isDeposit: boolean): PlaceResult {
    const a = this.account
    if (!a) return { ok: false, error: { code: 'bad-amount' } }
    const res = isDeposit ? deposit(a, this.market, amount) : withdraw(a, this.market, amount)
    if (res.ok && res.outcome === 'filled') {
      this.trades.push(res.trade)
      void store.appendTrades([res.trade])
      void this.flushNow('action')
    }
    this.notify()
    return res
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  patchCfg(p: Partial<TradingCfg>): void {
    this.cfg = { ...this.cfg, ...p }
    void store.saveTrading(this.cfg)
    this.notify()
  }

  setSpeed(v: number): void {
    this.feed.clock.speed = v
    // Read back rather than stored as typed: the clock clamps to [1, 1000], and a
    // slider showing 5000 next to a market moving at 1000 is a lie.
    this.patchCfg({ speed: this.feed.clock.speed })
  }

  setPaused(p: boolean): void {
    this.feed.clock.paused = p
    this.notify()
  }

  setSymbol(s: string): void {
    if (s === this.cfg.symbol) return
    this.cfg = { ...this.cfg, symbol: s }
    this.bars.clear()
    void store.saveTrading(this.cfg)
    void this.loadHistory().then(() => this.notify())
    this.notify()
  }

  setTimeframe(tf: Timeframe): void {
    if (tf === this.cfg.timeframe) return
    this.cfg = { ...this.cfg, timeframe: tf }
    this.bars.clear()
    void store.saveTrading(this.cfg)
    void this.loadHistory().then(() => this.notify())
    this.notify()
  }

  addSymbol(s: string): void {
    const sym = s.trim().toUpperCase()
    if (!sym) return
    this.feed.add(sym)
    this.setSymbol(sym)
  }

  // ── Mode ───────────────────────────────────────────────────────────────────

  /**
   * Swap the engine under the running app.
   *
   * Everything downstream holds a `MarketFeed` and cannot tell the two apart, so
   * the swap is mechanical — dispose, build, re-point, reload the chart — with
   * three things that are not:
   *
   *   • The sim world is flushed FIRST and then re-loaded on the way back, so a
   *     detour through live mode returns to the same market, at the price it was
   *     left at, rather than to a fresh one.
   *   • The symbol is re-normalised. Live has three crypto pairs; a user sitting
   *     on AAPL would otherwise be pointed at a market the venue does not have.
   *   • `speed` is only pushed into a sim clock. `LiveClock` accepts and ignores
   *     it (reality runs at 1×), which is why the speed control hides itself.
   */
  async switchMode(m: 'sim' | 'live'): Promise<void> {
    if (this.disposed || this.switching || m === this.feed.mode) return
    if (m === 'live' && !isOnline()) {
      // Refused before a socket is opened: there is nothing to wait for, and a
      // fifteen-second watchdog would only delay the same answer.
      this.liveNotice = 'offline'
      this.notify()
      return
    }
    this.switching = true
    try {
      await this.flushNow('action')
      this.stop()
      this.clearLiveWatchdog()
      this.feed.dispose()
      this.liveNotice = null

      this.cfg = { ...this.cfg, mode: m }
      const saved = m === 'sim' ? await store.loadWorld() : null
      this.feed = m === 'live' ? this.makeLiveFeed() : this.makeSimFeed(saved)
      this.market = createMarketView(this.feed)
      this.cfg.symbol = normalise(this.cfg.symbol, this.feed.symbols())
      if (m === 'sim') this.feed.clock.speed = this.cfg.speed
      void store.saveTrading(this.cfg)

      this.bars.clear()
      this.catchUp = { active: false, done: 0, total: 0 }
      await this.loadHistory()
      this.start()
      if (m === 'live') this.armLiveWatchdog()
    } finally {
      this.switching = false
    }
    this.notify()
  }

  /**
   * The offline guard.
   *
   * A socket that opens against a captive portal, a proxy that eats websockets or
   * a venue that is simply down never errors — it just never says anything, and
   * `live.ts` will patiently climb its reconnect ladder for as long as the user
   * is willing to stare at an empty chart. This is the thing that decides they
   * are not, drops back to the market that always works, and leaves a code behind
   * saying why.
   *
   * It only ever fires while nothing has arrived. Once the feed reaches `live` a
   * later drop is a blip, not an outage: the chart keeps the data it has and the
   * ladder is the right response.
   */
  private armLiveWatchdog(): void {
    this.clearLiveWatchdog()
    const wait = liveTransport.connectMs ?? LIVE_CONNECT_MS
    this.liveWatchdog = setTimeout(() => {
      this.liveWatchdog = null
      if (this.disposed || this.feed.mode !== 'live' || this.feed.status === 'live') return
      void this.switchMode('sim').then(() => {
        this.liveNotice = 'unreachable'
        this.notify()
      })
    }, wait)
  }

  private clearLiveWatchdog(): void {
    if (this.liveWatchdog !== null) clearTimeout(this.liveWatchdog)
    this.liveWatchdog = null
  }

  // ── Accounts ───────────────────────────────────────────────────────────────

  async newAccount(name: string, startCash: number): Promise<void> {
    const a = createAccount({
      id: uuid(),
      name: name.trim() || 'Paper account',
      currency: 'USDT',
      startCash: Number.isFinite(startCash) && startCash > 0 ? startCash : START_CASH,
      now: this.feed.clock.now(),
    })
    this.accounts = [...this.accounts, a]
    await store.saveAccount(a)
    await this.selectAccount(a.id)
  }

  async selectAccount(id: string): Promise<void> {
    if (!this.accounts.some((a) => a.id === id)) return
    await this.flushNow('action')
    this.accountId = id
    this.patchCfg({ selectedAccountId: id })
    await this.loadLedger()
    this.notify()
  }

  async dropAccount(id: string): Promise<void> {
    if (this.accounts.length <= 1) return
    this.accounts = this.accounts.filter((a) => a.id !== id)
    await store.deleteAccount(id)
    if (this.accountId === id) await this.selectAccount(this.accounts[0].id)
    else this.notify()
  }

  // ── Catch-up ───────────────────────────────────────────────────────────────

  private async runCatchUp(elapsedMs: number): Promise<void> {
    const total = Math.min(elapsedMs, MAX_CATCHUP_SIM_MS)
    this.catchUp = { active: true, done: 0, total }
    this.notify()
    try {
      await this.feed.catchUp(total, 8, (done, of) => {
        this.catchUp = { active: true, done, total: of }
        // The broker has to walk the same ground, one BROKER_STEP_MS at a time,
        // or a stop the price crossed while the app was shut would never trigger.
        this.runBroker()
        this.notify()
      })
    } finally {
      this.catchUp = { active: false, done: total, total }
      this.syncBars()
      // The clock jumped; the next tick must measure from now, or it would hand
      // the whole catch-up duration straight back to `pump`.
      this.lastWall = nowMs()
      this.notify()
      void this.flushNow('action')
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Hidden means STOPPED, not slowed.
   *
   * A background tab that keeps simulating burns battery for pixels nobody is
   * looking at, and the resume path reconstructs the same world from the wall
   * gap anyway — so stopping loses nothing and costs nothing.
   */
  private attachLifecycle(): void {
    if (typeof document === 'undefined') return
    this.onVisible = () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now()
        this.stop()
        void this.flushNow('hidden')
      } else {
        const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0
        this.hiddenAt = 0
        this.start()
        if (away > MIN_CATCHUP_MS) void this.runCatchUp(away)
      }
    }
    this.onHide = () => { void this.flushNow('hidden') }
    document.addEventListener('visibilitychange', this.onVisible)
    window.addEventListener('pagehide', this.onHide)
  }

  private detachLifecycle(): void {
    if (typeof document === 'undefined') return
    if (this.onVisible) document.removeEventListener('visibilitychange', this.onVisible)
    if (this.onHide) window.removeEventListener('pagehide', this.onHide)
    this.onVisible = undefined
    this.onHide = undefined
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async flushNow(reason: store.FlushReason): Promise<void> {
    if (this.disposed) return
    for (const a of this.accounts) await store.saveAccount(a)
    // Only a sim world is written. `LiveFeed.snapshot()` is seed-less with no
    // markets — honestly, since nothing here can reproduce an exchange's prices —
    // and storing it would overwrite the sim world the user left behind, so
    // coming back from live mode would silently start a different market.
    // Retention is skipped for the same reason: it prunes against the feed's
    // clock, and a live clock is epoch time while a sim clock is not.
    if (this.feed.mode === 'sim') {
      // `savedAtWall` is stamped by the store, not here — it is the only layer
      // allowed to read the wall clock on the write path.
      await store.saveWorld(this.feed.snapshot())
    }
    await store.flush(reason)
    if (reason === 'idle' && this.feed.mode === 'sim') {
      // Retention, on the quiet path only: a prune is a range scan and a bulk
      // delete, and doing it on a user action would put that latency in front of
      // a fill.
      void store.pruneBars(BAR_RETENTION_MS, this.feed.clock.now())
    }
  }

  async reset(): Promise<void> {
    this.stop()
    this.clearLiveWatchdog()
    this.liveNotice = null
    this.feed.dispose()
    await store.resetSandbox()
    this.accounts = []
    this.accountId = null
    this.trades = []
    this.equity = []
    this.bars.clear()
    this.catchUp = { active: false, done: 0, total: 0 }
    this.detachLifecycle()
    await this.init()
    this.notify()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.stop()
    this.clearLiveWatchdog()
    this.detachLifecycle()
    await this.flushNow('unmount')
    this.disposed = true
    this.feed.dispose()
    this.subs.clear()
    this.evSubs.clear()
  }
}

// ── The refcount ─────────────────────────────────────────────────────────────

let instance: Runtime | null = null
let building: Promise<TradingRuntime> | null = null
let refs = 0
let teardown: ReturnType<typeof setTimeout> | null = null

/**
 * Get the world, building it if nobody has yet.
 *
 * Every caller must pair this with exactly one `releaseRuntime`.
 */
export function acquireRuntime(): Promise<TradingRuntime> {
  refs++
  if (teardown !== null) {
    // A remount inside the deferral window. This is StrictMode in dev and a route
    // change in production, and both must find the same world they left.
    clearTimeout(teardown)
    teardown = null
  }
  if (!building) {
    const r = new Runtime()
    instance = r
    building = r.init().then(() => r as TradingRuntime)
  }
  return building
}

/**
 * Let go. Disposal is deferred by one macrotask, and cancelled outright if
 * anyone re-acquires inside it — see the note at the top of this file.
 */
export function releaseRuntime(): void {
  refs = Math.max(0, refs - 1)
  if (refs > 0 || teardown !== null) return
  teardown = setTimeout(() => {
    teardown = null
    if (refs > 0) return
    const pending = building
    const r = instance
    building = null
    instance = null
    // Await the build even when nobody wants the result any more: disposing a
    // half-built world would leave its interval running with no handle to it.
    void Promise.resolve(pending).catch(() => {}).then(() => r?.dispose())
  }, 0)
}

/** Test seam. Never called by the app — the refcount is the only lifecycle. */
export function _runtimeRefs(): number {
  return refs
}

export const TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d']
export const barLengthMs = (tf: Timeframe): number => TF_MS[tf]
export type { SimTime }
