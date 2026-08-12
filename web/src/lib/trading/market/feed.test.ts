import { describe, it, expect } from 'vitest'
import { createSimFeed } from './feed'
import type { FeedStatus, MarketFeed, WorldSnapshot } from './feed'
import { PRESETS } from './model'
import type { MarketParams } from './model'
import { MAX_CATCHUP_SIM_MS, TF_MS } from '../types'
import type { Candle, Px, SimTime, Timeframe } from '../types'

const BTC = PRESETS.btc
const ETH = PRESETS.eth
const HOUR = 3_600_000
const DAY = 24 * HOUR

/** One timeframe unless a test needs more: nine aggregators per symbol is about
 *  1.3 MB of Float64Array, and a day of catch-up through all of them is most of
 *  what this file would otherwise spend its time doing. */
function feed(symbols: MarketParams[] = [BTC], restore?: WorldSnapshot, seed = 'world') {
  return createSimFeed({ seed, symbols, restore, timeframes: ['1m'] })
}

/** Prices only — enough to prove two runs are the same world. */
function taps(f: MarketFeed, symbol: string): Px[] {
  const out: Px[] = []
  f.subscribe({
    onTick(s, _t, p) {
      if (s === symbol) out.push(p)
    },
  })
  return out
}

function barsOf(f: MarketFeed, symbol: string, tf: Timeframe): Candle[] {
  const s = f.series(symbol, tf)
  if (!s) return []
  const out: Candle[] = []
  for (let k = 0; k < s.length; k++) {
    const i = s.at(k)
    out.push({ t: s.t[i], o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i], v: s.v[i], n: s.n[i] })
  }
  return out
}

describe('the sim feed', () => {
  it('starts idle and goes live on the first pump', () => {
    const f = feed()
    expect(f.mode).toBe('sim')
    expect(f.status).toBe('idle')
    expect(f.symbols()).toEqual([BTC.symbol])
    f.pump(1_000)
    expect(f.status).toBe('live')
  })

  it('drives the clock at the clock’s speed', () => {
    const f = feed()
    f.clock.speed = 60
    f.pump(1_000)
    expect(f.clock.now()).toBe(60_000)
    expect(f.quote(BTC.symbol)!.t).toBe(60_000)
  })

  it('emits ticks and fills the candle series while it pumps', () => {
    const f = feed()
    const n = f.pump(10 * 60_000)
    expect(n).toBeGreaterThan(0)

    const bars = barsOf(f, BTC.symbol, '1m')
    expect(bars.length).toBeGreaterThan(5)
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].t - bars[i - 1].t).toBe(TF_MS['1m'])
    }
    // The forming bar has to reach the clock even if the last minute was quiet.
    expect(bars[bars.length - 1].t).toBe(Math.floor(f.clock.now() / TF_MS['1m']) * TF_MS['1m'])
  })

  it('builds every timeframe by default and only the asked-for ones otherwise', () => {
    const all = createSimFeed({ seed: 'w', symbols: [BTC] })
    all.pump(60_000)
    for (const tf of ['1s', '5s', '15s', '1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]) {
      expect(all.series(BTC.symbol, tf), tf).toBeDefined()
    }
    const one = feed()
    expect(one.series(BTC.symbol, '1m')).toBeDefined()
    expect(one.series(BTC.symbol, '1h')).toBeUndefined()
  })

  it('answers reads for an unknown symbol with undefined rather than throwing', () => {
    const f = feed()
    expect(f.quote('NOPE')).toBeUndefined()
    expect(f.book('NOPE')).toBeUndefined()
    expect(f.series('NOPE', '1m')).toBeUndefined()
    expect(f.fillPrice('NOPE', 'buy', 1)).toBeUndefined()
    expect(f.instrument('NOPE')).toBeUndefined()
  })

  it('infers an instrument from the market’s parameters', () => {
    const f = feed([BTC, PRESETS.forex, PRESETS.bluechip])
    expect(f.instrument(BTC.symbol)).toMatchObject({
      kind: 'spot',
      symbol: 'BTCUSDT',
      base: 'BTC',
      quote: 'USDT',
      tickSize: 0.1,
      pricePrecision: 1,
    })
    expect(f.instrument('EURUSD')).toMatchObject({ base: 'EUR', quote: 'USD', pricePrecision: 5 })
    // Nothing to split on, so it is priced in dollars and named after itself.
    expect(f.instrument('AAPL')).toMatchObject({ base: 'AAPL', quote: 'USD', pricePrecision: 2 })
  })
})

describe('per-symbol independence', () => {
  it('does not move one symbol’s prices by adding another', () => {
    const alone = feed([BTC])
    const solo = taps(alone, BTC.symbol)
    alone.pump(30 * 60_000)

    const together = feed([BTC, ETH])
    const pair = taps(together, BTC.symbol)
    together.pump(30 * 60_000)

    expect(solo.length).toBeGreaterThan(100)
    expect(pair).toEqual(solo)
  })

  it('does not move them by adding a symbol mid-session either', () => {
    const a = feed([BTC])
    const ra = taps(a, BTC.symbol)
    const b = feed([BTC])
    const rb = taps(b, BTC.symbol)

    a.pump(10 * 60_000)
    b.pump(10 * 60_000)
    b.add(ETH.symbol)
    a.pump(10 * 60_000)
    b.pump(10 * 60_000)

    expect(rb).toEqual(ra)
    expect(b.symbols()).toEqual([BTC.symbol, ETH.symbol])
  })

  it('starts a late symbol at the current sim time, not at the beginning of the world', () => {
    const f = feed([BTC])
    f.pump(6 * HOUR)
    f.add(ETH.symbol)
    const snap = f.snapshot()
    expect(snap.markets[ETH.symbol].t0).toBe(f.clock.now())
    expect(snap.markets[ETH.symbol].quanta).toBe(0)
    // And it does not then have to replay six hours to catch up.
    f.pump(60_000)
    expect(f.quote(ETH.symbol)!.last).toBeGreaterThan(0)
  })

  it('invents a market for a symbol nobody described', () => {
    const f = feed([BTC])
    f.add('WEIRDCOIN')
    f.pump(60_000)
    const q = f.quote('WEIRDCOIN')!
    expect(q.last).toBeGreaterThan(0)

    // The same ticker has to be the same instrument on every device, or a shared
    // seed stops describing a shared world.
    const g = feed([BTC])
    g.add('WEIRDCOIN')
    g.pump(60_000)
    expect(g.quote('WEIRDCOIN')!.last).toBe(q.last)
  })

  it('stops driving a symbol once it is removed', () => {
    const f = feed([BTC, ETH])
    f.pump(60_000)
    f.remove(ETH.symbol)
    f.pump(60_000)
    expect(f.symbols()).toEqual([BTC.symbol])
    expect(f.quote(ETH.symbol)).toBeUndefined()
  })

  it('gives different worlds to different world seeds', () => {
    const a = feed([BTC], undefined, 'alpha')
    const b = feed([BTC], undefined, 'beta')
    const ra = taps(a, BTC.symbol)
    const rb = taps(b, BTC.symbol)
    a.pump(10 * 60_000)
    b.pump(10 * 60_000)
    expect(rb).not.toEqual(ra)
  })
})

describe('listeners', () => {
  it('reports ticks, closed bars and status, and stops on unsubscribe', () => {
    const f = feed()
    let ticks = 0
    const closes: [string, Timeframe, SimTime][] = []
    const statuses: FeedStatus[] = []
    const off = f.subscribe({
      onTick: () => ticks++,
      onBarClose: (s, tf, t) => closes.push([s, tf, t]),
      onStatus: (s) => statuses.push(s),
    })

    f.pump(5 * 60_000)
    expect(ticks).toBeGreaterThan(0)
    expect(closes.length).toBeGreaterThanOrEqual(4)
    expect(closes[0][1]).toBe('1m')
    expect(closes[0][2]).toBe(0)
    expect(statuses).toEqual(['live'])

    const seen = ticks
    off()
    f.pump(5 * 60_000)
    expect(ticks).toBe(seen)
  })

  it('tells subscribers the book moved, once per pump rather than once per tick', () => {
    const f = feed()
    let books = 0
    let ticks = 0
    f.subscribe({ onBook: () => books++, onTick: () => ticks++ })
    f.pump(60_000)
    expect(books).toBe(1)
    expect(ticks).toBeGreaterThan(books)
  })
})

describe('catch-up', () => {
  it(
    'covers a day, reports monotonic progress, and lands where pumping would',
    { timeout: 120_000 },
    async () => {
      const caught = feed()
      const pumped = feed()

      const progress: number[] = []
      let slices = 0
      await caught.catchUp(DAY, 6, (done, total) => {
        progress.push(done)
        slices++
        expect(total).toBe(DAY)
      })
      pumped.pump(DAY)

      expect(slices).toBeGreaterThan(3)
      expect(progress[0]).toBe(0)
      expect(progress[progress.length - 1]).toBe(DAY)
      for (let i = 1; i < progress.length; i++) {
        expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1])
      }

      expect(caught.clock.now()).toBe(pumped.clock.now())
      expect(caught.snapshot()).toEqual(pumped.snapshot())
      // Same bars too: slicing must not disturb the aggregators either.
      expect(barsOf(caught, BTC.symbol, '1m')).toEqual(barsOf(pumped, BTC.symbol, '1m'))
    },
  )

  it('adapts its slice size to a measured cost', async () => {
    // A fake wall clock that charges a flat 3ms per slice: the loop should widen
    // the slices until each one is worth about the budget.
    let wall = 0
    const f = createSimFeed({
      seed: 'w',
      symbols: [BTC],
      timeframes: ['1m'],
      wallMs: () => (wall += 1.5),
    })
    const sizes: number[] = []
    let prev = 0
    await f.catchUp(6 * HOUR, 6, (done) => {
      if (done > 0) sizes.push(done - prev)
      prev = done
    })
    expect(sizes.length).toBeGreaterThan(1)
    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[0])
    expect(f.clock.now()).toBe(6 * HOUR)
  })

  it('caps at the maximum catch-up rather than replaying a week', async () => {
    const f = feed()
    let total = 0
    await f.catchUp(7 * DAY, 6, (_d, t) => {
      total = t
    })
    expect(total).toBe(MAX_CATCHUP_SIM_MS)
    expect(f.clock.now()).toBe(MAX_CATCHUP_SIM_MS)
  })

  it('does nothing, quietly, when there is nothing to catch up', async () => {
    const f = feed()
    const seen: number[][] = []
    await f.catchUp(0, 6, (d, t) => seen.push([d, t]))
    expect(seen).toEqual([[0, 0]])
    expect(f.clock.now()).toBe(0)
  })

  it('runs even while paused, because the world moved whether or not it was watched', async () => {
    const f = feed()
    f.clock.paused = true
    await f.catchUp(HOUR, 6, () => {})
    expect(f.clock.now()).toBe(HOUR)
  })

  it('leaves the status where it found it', async () => {
    const f = feed()
    f.pump(1_000)
    const during: FeedStatus[] = []
    f.subscribe({ onStatus: (s) => during.push(s) })
    await f.catchUp(HOUR, 6, () => {})
    expect(during).toEqual(['catching-up', 'live'])
    expect(f.status).toBe('live')
  })
})

describe('the world snapshot', () => {
  it('round-trips through JSON and resumes the same world', () => {
    const a = feed()
    a.clock.speed = 4
    a.pump(90_000)

    const saved = JSON.parse(JSON.stringify(a.snapshot())) as WorldSnapshot
    expect(saved.version).toBe(1)
    expect(saved.seed).toBe('world')

    const b = feed([BTC], saved)
    const ra = taps(a, BTC.symbol)
    const rb = taps(b, BTC.symbol)
    expect(b.clock.now()).toBe(a.clock.now())
    expect(b.clock.speed).toBe(4)

    a.pump(60_000)
    b.pump(60_000)
    expect(rb).toEqual(ra)
    expect(b.snapshot()).toEqual(a.snapshot())
  })

  it('leaves savedAtWall for the persistence layer to stamp', () => {
    // Nothing under lib/trading may read the wall clock; a sim that could would
    // stop behaving the same at 1x and at 60x.
    expect(feed().snapshot().savedAtWall).toBe(0)
  })

  it('restores a many-symbol world by symbol', () => {
    const a = feed([BTC, ETH])
    a.pump(120_000)
    const b = feed([BTC, ETH], JSON.parse(JSON.stringify(a.snapshot())))
    expect(b.snapshot().markets).toEqual(a.snapshot().markets)
  })
})

describe('history', () => {
  it('returns exactly the count asked for, contiguous, before the live series', async () => {
    const f = feed()
    f.pump(20 * 60_000)
    const h = await f.history(BTC.symbol, '1m', 300)

    expect(h).toHaveLength(300)
    for (let i = 1; i < h.length; i++) {
      expect(h[i].t - h[i - 1].t).toBe(TF_MS['1m'])
      expect(h[i].o).toBeGreaterThan(0)
      expect(h[i].h).toBeGreaterThanOrEqual(Math.max(h[i].o, h[i].c))
      expect(h[i].l).toBeLessThanOrEqual(Math.min(h[i].o, h[i].c))
    }
    // It has to end on the live series, not merely near it.
    const live = barsOf(f, BTC.symbol, '1m')
    expect(h.slice(h.length - live.length)).toEqual(live)
  })

  it('joins the invented past to the live series without a step', async () => {
    const f = feed()
    f.pump(20 * 60_000)
    const live = barsOf(f, BTC.symbol, '1m')
    const h = await f.history(BTC.symbol, '1m', 300)
    const joinIdx = h.length - live.length
    expect(h[joinIdx].t).toBe(live[0].t)
    expect(h[joinIdx - 1].c).toBe(live[0].o)
  })

  it('answers the same way twice at the same state', async () => {
    const f = feed()
    f.pump(20 * 60_000)
    expect(await f.history(BTC.symbol, '1m', 200)).toEqual(
      await f.history(BTC.symbol, '1m', 200),
    )
  })

  it('works before anything has been pumped at all', async () => {
    const f = feed()
    const h = await f.history(BTC.symbol, '1m', 120)
    expect(h).toHaveLength(120)
    expect(h[h.length - 1].c).toBeGreaterThan(0)
  })

  it('trims to the newest bars when the live series is already longer', async () => {
    const f = feed()
    f.pump(60 * 60_000)
    const h = await f.history(BTC.symbol, '1m', 10)
    const live = barsOf(f, BTC.symbol, '1m')
    expect(h).toEqual(live.slice(live.length - 10))
  })

  it('has nothing to say about a symbol it does not have', async () => {
    const f = feed()
    expect(await f.history('NOPE', '1m', 10)).toEqual([])
    expect(await f.history(BTC.symbol, '1m', 0)).toEqual([])
  })
})

describe('dispose', () => {
  it('stops the world and is safe to call twice', async () => {
    const f = feed()
    f.pump(60_000)
    const at = f.clock.now()
    f.dispose()
    f.dispose()

    expect(f.pump(60_000)).toBe(0)
    expect(f.symbols()).toEqual([])
    await f.catchUp(HOUR, 6, () => {})
    // The clock is not the feed's to unwind, but nothing was generated past it.
    expect(f.clock.now()).toBeGreaterThanOrEqual(at)
    expect(f.status).toBe('idle')
  })
})
