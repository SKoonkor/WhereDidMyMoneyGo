import { describe, it, expect, afterEach } from 'vitest'
import { acquireRuntime, releaseRuntime, _runtimeRefs, _setLiveTransport } from './runtime'
import { flush, resetSandbox, saveWorld } from './store'
import type { LiveSocket } from '../../lib/trading/market/live'
import type { OrderRequest } from '../../lib/trading/broker/engine'

// The refcount, and nothing else.
//
// This is D.1's mitigation and it is the single hardest failure in the feature to
// diagnose from a bug report: React 19 StrictMode mounts, unmounts and remounts
// every component in dev, so a runtime that tore itself down on the first unmount
// would rebuild the market with a fresh RNG and produce a visible price jump on
// every hot reload — which reads as an engine bug, not as a lifecycle bug, and
// costs days.
//
// Deliberately NOT tested here: the loop, the chart, the broker. Those need a real
// canvas, a real clock or a real market, and all three already have their own
// suites at the layer they belong to. There are no component-render tests in this
// repo and this is not the file to start that convention in.

// ── Live-mode doubles ────────────────────────────────────────────────────────
//
// No network, ever — for the same reasons live.test.ts gives: a test that opened
// a real socket would be slow, flaky, broken offline and rate-limited by the
// venue. `_setLiveTransport` is the runtime's seam for exactly this, and the
// socket below is deliberately dumb: it opens only when a test tells it to, so
// "the exchange never answers" is the default rather than a special case.

class FakeSocket implements LiveSocket {
  closed = false
  onopen: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null

  send(): void {}
  close(): void { this.closed = true }
}

/** Every REST call refused. History is a chart with fewer bars, never a failure
 *  the runtime has to handle differently, so one answer covers all of them. */
const deadFetch = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(null) })

function setOnline(v: boolean): void {
  Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => v })
}

afterEach(async () => {
  // Drain any refs a failed assertion left behind, then let the deferred teardown
  // actually run before the next test builds a world.
  while (_runtimeRefs() > 0) releaseRuntime()
  await new Promise((r) => setTimeout(r, 0))
  _setLiveTransport({})
  // Drop the own property so `navigator.onLine` falls back to jsdom's own getter.
  Reflect.deleteProperty(globalThis.navigator, 'onLine')
  await resetSandbox()
})

describe('runtime refcount', () => {
  it('hands the same world to concurrent holders', async () => {
    const [a, b] = await Promise.all([acquireRuntime(), acquireRuntime()])
    expect(a).toBe(b)
    expect(_runtimeRefs()).toBe(2)
    releaseRuntime()
    releaseRuntime()
  })

  it('survives StrictMode: mount, unmount, remount keeps the SAME world', async () => {
    const first = await acquireRuntime()
    const seed = first.feed.snapshot().seed
    const clock = first.feed.clock.now()

    // The exact sequence React 19 performs in dev, synchronously.
    releaseRuntime()
    const second = await acquireRuntime()

    expect(second).toBe(first)
    expect(second.feed.snapshot().seed).toBe(seed)
    // The clock may have advanced — the loop is running — but it must never have
    // gone BACKWARDS, which is what a rebuilt market would do.
    expect(second.feed.clock.now()).toBeGreaterThanOrEqual(clock)
    releaseRuntime()
  })

  it('defers teardown by a macrotask rather than performing it inline', async () => {
    const first = await acquireRuntime()
    releaseRuntime()
    expect(_runtimeRefs()).toBe(0)
    // Still the same instance: the teardown is only SCHEDULED.
    expect(await acquireRuntime()).toBe(first)
    releaseRuntime()
  })

  it('actually does tear down once the window passes', async () => {
    const first = await acquireRuntime()
    releaseRuntime()
    await new Promise((r) => setTimeout(r, 0))
    const second = await acquireRuntime()
    // A fresh object — the world was disposed and rebuilt, which is what should
    // happen when the user genuinely leaves the page.
    expect(second).not.toBe(first)
    releaseRuntime()
  })

  it('never lets the refcount go negative', async () => {
    await acquireRuntime()
    releaseRuntime()
    releaseRuntime()
    releaseRuntime()
    expect(_runtimeRefs()).toBe(0)
  })
})

describe('runtime world', () => {
  it('opens with a funded account and a live symbol', async () => {
    const rt = await acquireRuntime()
    expect(rt.account).toBeDefined()
    expect(rt.account!.cash).toBeGreaterThan(0)
    // The default config names "BTC"; the feed's markets are pairs. The alias map
    // has to resolve that, or the chart opens on a symbol that does not exist.
    expect(rt.feed.symbols()).toContain(rt.symbol)
    expect(rt.quote(rt.symbol)).toBeDefined()
    releaseRuntime()
  })

  // `SimTime` is milliseconds since the epoch and `createClock()` starts at zero,
  // so an unseeded sandbox stamps every trade, equity point and candle 1 Jan 1970.
  // It hides on an intraday time axis and is glaring the moment the blotter
  // formats a date, which is exactly the kind of bug that ships.
  it('starts a fresh world on the wall clock, not on the epoch', async () => {
    const rt = await acquireRuntime()
    expect(Math.abs(rt.feed.clock.now() - Date.now())).toBeLessThan(60_000)
    // And the MARKETS were born at the same instant. If their `t0` were left at 0
    // while the clock moved to now, the first `advanceTo` would ask the model for
    // fifty-six years of quanta and the page would never paint — so this is the
    // assertion that would catch the fix being half-applied.
    expect(Math.abs(rt.quote(rt.symbol)!.t - Date.now())).toBeLessThan(60_000)
    releaseRuntime()
  })

  it('leaves a restored world on the clock it was saved with', async () => {
    const AT = 1_700_000_000_000
    await saveWorld({
      version: 1,
      seed: 'restored-world',
      clock: { simNow: AT, speed: 1, residual: 0, paused: false },
      savedAtWall: 0,
      markets: {},
    })
    await flush('action')

    const rt = await acquireRuntime()
    // Forward from where it was left — never re-seeded to now, which would jump
    // the sim and trigger a catch-up over the gap.
    expect(rt.feed.clock.now()).toBeGreaterThanOrEqual(AT)
    expect(rt.feed.clock.now()).toBeLessThan(AT + 60_000)
    releaseRuntime()
  })

  it('prices a perpetual against its own spot market', async () => {
    const rt = await acquireRuntime()
    const spot = rt.quote(rt.symbol)
    const perp = rt.quote(`${rt.symbol}.P`)
    expect(perp).toBeDefined()
    expect(perp!.markPrice).toBe(spot!.markPrice)
    // And it must be a perp, or `leverageFor` clamps every order to 1x and the
    // leverage slider is decoration.
    expect(rt.market.instrument(`${rt.symbol}.P`)?.kind).toBe('perp')
    releaseRuntime()
  })

  // The ticket can now build one, so the path from ticket to engine is worth
  // pinning: `trail` is a PERCENT (paper.py's convention), and an order without
  // one is refused rather than placed and never triggered.
  it('takes a trailing order with a trail percent, and refuses one without', async () => {
    const rt = await acquireRuntime()
    const base: OrderRequest = {
      symbol: rt.symbol, side: 'buy', type: 'trailing', mode: 'shares', qty: 0.01, tif: 'gtc',
    }

    const bare = rt.preview(base)
    expect('error' in bare && bare.error.code).toBe('missing-trail')

    const ok = rt.preview({ ...base, trail: 5 })
    expect('error' in ok).toBe(false)

    const placed = rt.place({ ...base, trail: 5 })
    expect(placed.ok).toBe(true)
    releaseRuntime()
  })
})

// Resuming at 1× is a runtime rule rather than a SpeedControl one, which is what
// makes it testable here at all — and what makes it true for any other way of
// un-pausing that ever gets added.
describe('runtime pause and speed', () => {
  it('resumes at 1×, and persists that through the config', async () => {
    const rt = await acquireRuntime()
    rt.setSpeed(300)
    rt.setPaused(true)
    expect(rt.feed.clock.paused).toBe(true)
    // Still 300× while paused: the reset belongs to the resume, so a paused
    // chart shows the speed it will not be running at until you say go.
    expect(rt.cfg.speed).toBe(300)

    rt.setPaused(false)
    expect(rt.feed.clock.paused).toBe(false)
    // Both halves matter. `cfg.speed` is what the slider reads and what a reload
    // restores; `clock.speed` is what the market actually runs at. Setting one
    // without the other is a slider that lies.
    expect(rt.cfg.speed).toBe(1)
    expect(rt.feed.clock.speed).toBe(1)
    releaseRuntime()
  })

  it('leaves a chosen speed alone when the clock is already running', async () => {
    const rt = await acquireRuntime()
    expect(rt.feed.clock.paused).toBe(false)
    rt.setSpeed(60)

    // A redundant resume. Without the transition guard this would stomp the 60×
    // the user just picked — the failure mode is a slider that snaps back to 1×
    // on an unrelated re-render.
    rt.setPaused(false)
    expect(rt.cfg.speed).toBe(60)
    expect(rt.feed.clock.speed).toBe(60)
    releaseRuntime()
  })
})

describe('runtime mode switching', () => {
  it('swaps in the live feed, and restricts the watchlist to crypto pairs', async () => {
    _setLiveTransport({
      socketImpl: () => {
        const s = new FakeSocket()
        // Opened on the next macrotask, so the handlers `connect()` assigns after
        // this returns are in place before anything fires.
        setTimeout(() => s.onopen?.(), 0)
        return s
      },
      fetchImpl: deadFetch,
      // Long enough that the give-up path is not what this test is measuring.
      connectMs: 60_000,
    })

    const rt = await acquireRuntime()
    const simSymbols = [...rt.feed.symbols()]
    expect(simSymbols).toContain('AAPL')

    await rt.switchMode('live')
    expect(rt.mode).toBe('live')
    expect(rt.cfg.mode).toBe('live')
    // AAPL, SPX500 and EURUSD do not exist on a crypto venue. Asking for them
    // would be three streams that never speak and three REST calls that 404.
    expect(rt.feed.symbols()).toEqual(['BTCUSDT', 'ETHUSDT', 'DOGEUSDT'])
    // And the selected symbol came with it rather than pointing at a market the
    // venue has never heard of.
    expect(rt.feed.symbols()).toContain(rt.symbol)

    await rt.switchMode('sim')
    expect(rt.mode).toBe('sim')
    expect(rt.cfg.mode).toBe('sim')
    expect([...rt.feed.symbols()]).toEqual(simSymbols)
    releaseRuntime()
  })

  it('refuses live mode outright when the browser says it is offline', async () => {
    _setLiveTransport({ socketImpl: () => new FakeSocket(), fetchImpl: deadFetch, connectMs: 60_000 })
    const rt = await acquireRuntime()

    setOnline(false)
    await rt.switchMode('live')

    // No socket was opened and nothing is pending: the answer is available now,
    // so the user gets it now.
    expect(rt.mode).toBe('sim')
    expect(rt.cfg.mode).toBe('sim')
    expect(rt.liveNotice).toBe('offline')
    releaseRuntime()
  })

  // The offline guarantee. A socket that opens against a captive portal or a
  // proxy that eats websockets never errors — it simply never speaks — and the
  // reconnect ladder would keep climbing behind an empty chart forever.
  it('falls back to the simulation when the exchange never answers', async () => {
    _setLiveTransport({
      socketImpl: () => new FakeSocket(), // never opens, never delivers, never errors
      fetchImpl: deadFetch,
      connectMs: 20,
    })

    const rt = await acquireRuntime()
    await rt.switchMode('live')
    expect(rt.mode).toBe('live')

    await new Promise((r) => setTimeout(r, 250))

    expect(rt.mode).toBe('sim')
    expect(rt.cfg.mode).toBe('sim')
    expect(rt.liveNotice).toBe('unreachable')
    // Back on a market that works: a quote, not a blank chart.
    expect(rt.quote(rt.symbol)).toBeDefined()
    releaseRuntime()
  })
})
