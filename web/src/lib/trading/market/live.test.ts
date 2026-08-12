import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLiveFeed } from './live'
import type { FetchLike, LiveFeedOptions, LiveSocket } from './live'
import type { FeedStatus, MarketFeed } from './feed'
import type { Px, Qty, SimTime } from '../types'

// No network, ever. The whole adapter is driven through two injected seams — a
// socket and a fetch — because a test that opened a real one would be slow,
// offline-broken, rate-limited by the venue, and deleted within a week.

const SYM = 'BTCUSDT'
const T0 = 1_700_000_000_000

class FakeSocket implements LiveSocket {
  readonly url: string
  readonly sent: string[] = []
  closed = false
  closeCode?: number
  onopen: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null

  constructor(url: string) {
    this.url = url
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number): void {
    this.closed = true
    this.closeCode = code
  }

  // ── what the venue does to us ────────────────────────────────────────────
  open(): void {
    this.onopen?.()
  }
  /** A raw frame: tests pass a string when they want to prove malformed input is
   *  survivable, and an object when they mean well-formed JSON. */
  deliver(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) })
  }
  fail(): void {
    this.onerror?.()
  }
}

interface Tick {
  symbol: string
  t: SimTime
  p: Px
  q: Qty
  s: 1 | -1
}

function harness(over: Partial<LiveFeedOptions> = {}) {
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  let wall = 0

  const feed = createLiveFeed({
    symbols: [SYM],
    // One timeframe unless a test asks for more: nine aggregators per symbol is
    // about 1.3 MB of Float64Array and none of these tests reads the other eight.
    timeframes: ['1m'],
    wallMs: () => wall,
    now: () => T0,
    jitter: () => 0,
    socketImpl: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      urls.push(url)
      return s
    },
    fetchImpl: () => Promise.reject(new Error('no fetch stubbed for this test')),
    ...over,
  })

  const ticks: Tick[] = []
  const books: string[] = []
  const statuses: FeedStatus[] = []
  feed.subscribe({
    onTick: (symbol, t, p, q, s) => ticks.push({ symbol, t, p, q, s }),
    onBook: (symbol) => books.push(symbol),
    onStatus: (s) => statuses.push(s),
  })

  /** Move wall time and timers together, in small steps, so a heartbeat never
   *  fires against a wall clock that jumped past it in one go. */
  const advance = (ms: number) => {
    for (let left = ms; left > 0; ) {
      const d = Math.min(100, left)
      wall += d
      vi.advanceTimersByTime(d)
      left -= d
    }
  }

  return { feed, sockets, urls, ticks, books, statuses, advance, wallOf: () => wall }
}

const aggTrade = (over: Record<string, unknown> = {}) => ({
  stream: 'btcusdt@aggTrade',
  data: {
    e: 'aggTrade',
    s: SYM,
    p: '100.50',
    q: '0.25',
    T: T0,
    m: true,
    ...over,
  },
})

const depth20 = (bids: [string, string][], asks: [string, string][]) => ({
  stream: 'btcusdt@depth20@100ms',
  data: { lastUpdateId: 1, bids, asks },
})

const jsonOnce = (body: unknown, seen?: string[]): FetchLike => {
  return (url: string) => {
    seen?.push(url)
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the live feed as a MarketFeed', () => {
  it('is a drop-in substitute for the sim feed', () => {
    // The whole point of the workstream: if this ever stops compiling, something
    // downstream has started depending on which engine it was handed.
    const h = harness()
    const f: MarketFeed = h.feed
    expect(f.mode).toBe('live')
    expect(f.symbols()).toEqual([SYM])
    expect(f.instrument(SYM)?.symbol).toBe(SYM)
    f.dispose()
  })

  it('connects to Binance for every subscribed symbol on construction', () => {
    const h = harness({ symbols: [SYM, 'ETHUSDT'] })
    expect(h.sockets).toHaveLength(1)
    expect(h.urls[0]).toContain('wss://stream.binance.com:9443/stream?streams=')
    expect(h.urls[0]).toContain('btcusdt@aggTrade')
    expect(h.urls[0]).toContain('btcusdt@depth20@100ms')
    expect(h.urls[0]).toContain('ethusdt@aggTrade')
    expect(h.feed.status).toBe('connecting')
    h.sockets[0].open()
    expect(h.feed.status).toBe('live')
    h.feed.dispose()
  })

  it('runs at 1x and refuses to be paused, because reality does', () => {
    const h = harness()
    h.feed.clock.speed = 60
    h.feed.clock.paused = true
    expect(h.feed.clock.speed).toBe(1)
    expect(h.feed.clock.paused).toBe(false)
    h.feed.dispose()
  })

  it('has nothing to catch up', async () => {
    const h = harness()
    const seen: [number, number][] = []
    await h.feed.catchUp(86_400_000, 8, (d, t) => seen.push([d, t]))
    // (0, 0), never (0, total): a progress bar handed a total it can never reach
    // sits at 0% forever.
    expect(seen).toEqual([[0, 0]])
    h.feed.dispose()
  })

  it('snapshots the clock and nothing else', () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade())
    const snap = h.feed.snapshot()
    expect(snap.seed).toBe('')
    expect(snap.markets).toEqual({})
    expect(snap.clock.simNow).toBe(T0)
    h.feed.dispose()
  })
})

describe('the live feed reading the wire', () => {
  it('turns an aggTrade into one tick, on the aggressor’s side', () => {
    const h = harness()
    h.sockets[0].open()
    // m:true means the BUYER was the maker, so a seller crossed the spread.
    h.sockets[0].deliver(aggTrade({ m: true }))

    expect(h.ticks).toEqual([{ symbol: SYM, t: T0, p: 100.5, q: 0.25, s: -1 }])
    const q = h.feed.quote(SYM)!
    expect(q.last).toBe(100.5)
    expect(q.t).toBe(T0)
    expect(h.feed.clock.now()).toBe(T0)

    h.sockets[0].deliver(aggTrade({ m: false, p: '101.00', T: T0 + 10 }))
    expect(h.ticks[1].s).toBe(1)
    expect(h.feed.quote(SYM)!.last).toBe(101)
    h.feed.dispose()
  })

  it('takes the venue’s own price precision from the price it quotes', () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade({ p: '100.50', q: '0.25' }))
    const i = h.feed.instrument(SYM)!
    expect(i.kind).toBe('spot')
    expect(i.pricePrecision).toBe(2)
    expect(i.tickSize).toBeCloseTo(0.01, 12)
    // 8, not the 2 the `q: '0.25'` string suggests. Price and quantity follow the
    // same widen-only rule, and quantity's provisional is already the venue
    // maximum — so this branch is a deliberate no-op. Narrowing here would let a
    // padded `0.25000000` set lotSize 0.01 and have the broker reject an order
    // for 0.005 BTC: a real rejection traded for a cosmetic display fix.
    expect(i.kind === 'spot' && i.qtyPrecision).toBe(8)
    expect(i.kind === 'spot' && i.base).toBe('BTC')
    expect(i.kind === 'spot' && i.quote).toBe('USDT')
    h.feed.dispose()
  })

  it('reads through Binance’s 8-decimal padding instead of believing it', () => {
    // The shipped bug: Binance pads to the QUOTE asset's decimals, not to its own
    // tick, so this print used to be read as a 1e-8 tick and rendered as
    // "68,123.45000000".
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade({ p: '68123.45000000', q: '0.25000000' }))
    const i = h.feed.instrument(SYM)!
    expect(i.pricePrecision).toBe(2)
    expect(i.tickSize).toBeCloseTo(0.01, 12)
    // Same print, the quantity half: still the provisional 8.
    expect(i.kind === 'spot' && i.qtyPrecision).toBe(8)
    expect(i.kind === 'spot' && i.lotSize).toBeCloseTo(1e-8, 15)
    h.feed.dispose()
  })

  it('never narrows precision, so a round price cannot make the tick flicker', () => {
    // The guard a naive trailing-zero strip fails: stripping alone reads
    // "68123.00000000" as ZERO decimals, and the old `!==` rewrote on every
    // mismatch — so the tick would churn trade to trade, taking the chart's
    // grid and every formatted price with it.
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade({ p: '68123.45000000' }))
    h.sockets[0].deliver(aggTrade({ p: '68123.00000000', T: T0 + 10 }))
    const i = h.feed.instrument(SYM)!
    expect(i.pricePrecision).toBe(2)
    expect(i.tickSize).toBeCloseTo(0.01, 12)
    h.feed.dispose()
  })

  it('widens for a genuinely finer price', () => {
    // A sub-cent symbol has real digits out at 1e-8; the point of widen-only is
    // that it still gets them.
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade({ p: '0.00001234' }))
    const i = h.feed.instrument(SYM)!
    expect(i.pricePrecision).toBe(8)
    expect(i.tickSize).toBeCloseTo(1e-8, 15)
    // And having widened, it stays widened.
    h.sockets[0].deliver(aggTrade({ p: '0.00001200', T: T0 + 10 }))
    expect(h.feed.instrument(SYM)!.pricePrecision).toBe(8)
    h.feed.dispose()
  })

  it('builds a book with bids descending and asks ascending', () => {
    const h = harness()
    h.sockets[0].open()
    // Deliberately out of order: an unsorted side would make fillPrice walk the
    // book from the wrong end and quote better than the top of book.
    h.sockets[0].deliver(
      depth20(
        [
          ['99.00', '1'],
          ['100.00', '2'],
        ],
        [
          ['102.00', '3'],
          ['101.00', '4'],
        ],
      ),
    )

    const b = h.feed.book(SYM)!
    expect(b.bids.map((l) => l.p)).toEqual([100, 99])
    expect(b.asks.map((l) => l.p)).toEqual([101, 102])
    expect(h.books).toEqual([SYM])

    const q = h.feed.quote(SYM)!
    expect(q.bid).toBe(100)
    expect(q.ask).toBe(101)
    expect(q.markPrice).toBe(100.5)
    expect(q.indexPrice).toBe(100.5)

    // Four units of buying clears the 101 level (4) exactly.
    expect(h.feed.fillPrice(SYM, 'buy', 4)).toBeCloseTo(101, 9)
    // Past it, the next level has to cost more.
    expect(h.feed.fillPrice(SYM, 'buy', 6)!).toBeGreaterThan(101)
    h.feed.dispose()
  })

  it('drops a zero-size level rather than resting a phantom bid on it', () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(
      depth20(
        [
          ['100.00', '0'],
          ['99.00', '1'],
        ],
        [['101.00', '1']],
      ),
    )
    expect(h.feed.book(SYM)!.bids.map((l) => l.p)).toEqual([99])
    h.feed.dispose()
  })

  it('degrades rather than crashes on malformed or partial frames', () => {
    const h = harness()
    const ws = h.sockets[0]
    ws.open()
    for (const bad of [
      'not json at all',
      '{"stream":"btcusdt@aggTrade","data":',
      '[]',
      'null',
      JSON.stringify({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade' } }),
      JSON.stringify({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', s: SYM, p: 'abc' } }),
      JSON.stringify({ stream: 'nope@aggTrade', data: { e: 'aggTrade', s: 'NOPE', p: '1', q: '1' } }),
      JSON.stringify(depth20([], [])),
      JSON.stringify({ stream: 'btcusdt@depth20@100ms', data: { bids: 'wat', asks: null } }),
    ]) {
      expect(() => ws.deliver(bad)).not.toThrow()
    }
    expect(h.ticks).toHaveLength(0)

    // And the stream still works afterwards — a bad frame is dropped, not fatal.
    ws.deliver(aggTrade())
    expect(h.ticks).toHaveLength(1)
    h.feed.dispose()
  })

  it('answers reads for an unknown symbol with undefined rather than throwing', () => {
    const h = harness()
    expect(h.feed.quote('NOPE')).toBeUndefined()
    expect(h.feed.book('NOPE')).toBeUndefined()
    expect(h.feed.series('NOPE', '1m')).toBeUndefined()
    expect(h.feed.fillPrice('NOPE', 'buy', 1)).toBeUndefined()
    h.feed.dispose()
  })
})

describe('the live feed and the candle aggregators', () => {
  it('loads REST klines into the aggregator with the right OHLCV and bar times', async () => {
    const seen: string[] = []
    const rows = [
      [60_000, '10.0', '12.0', '9.0', '11.0', '5', 119_999, '0', 7],
      [120_000, '11.0', '15.0', '11.0', '14.0', '6', 179_999, '0', 9],
    ]
    const h = harness({ fetchImpl: jsonOnce(rows, seen) })

    const bars = await h.feed.history(SYM, '1m', 10)
    expect(seen[0]).toBe(
      'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=10',
    )
    expect(bars).toEqual([
      { t: 60_000, o: 10, h: 12, l: 9, c: 11, v: 5, n: 7 },
      { t: 120_000, o: 11, h: 15, l: 11, c: 14, v: 6, n: 9 },
    ])

    // The same bars are IN the aggregator, not beside it: the chart must see one
    // continuous series, not a bootstrap array joined to a live one.
    const s = h.feed.series(SYM, '1m')!
    expect(s.length).toBe(2)
    expect([s.t[s.at(0)], s.o[s.at(0)], s.h[s.at(0)], s.l[s.at(0)], s.c[s.at(0)]]).toEqual([
      60_000, 10, 12, 9, 11,
    ])
    expect(s.n[s.at(1)]).toBe(9)
    h.feed.dispose()
  })

  it('builds the timeframes Binance has no kline for out of 1s bars', async () => {
    const seen: string[] = []
    const rows = [
      [0, '10', '11', '9', '10.5', '1', 999, '0', 1],
      [1000, '10.5', '13', '10', '12', '2', 1999, '0', 2],
      [2000, '12', '12', '8', '9', '3', 2999, '0', 3],
      [3000, '9', '9', '9', '9', '4', 3999, '0', 4],
      [4000, '9', '9', '9', '9', '5', 4999, '0', 5],
      [5000, '9', '20', '9', '19', '6', 5999, '0', 6],
    ]
    const h = harness({ timeframes: ['5s'], fetchImpl: jsonOnce(rows, seen) })

    const bars = await h.feed.history(SYM, '5s', 2)
    expect(seen[0]).toContain('interval=1s')
    expect(seen[0]).toContain('limit=10')
    expect(bars[0]).toEqual({ t: 0, o: 10, h: 13, l: 8, c: 9, v: 15, n: 15 })
    expect(bars[1]).toEqual({ t: 5000, o: 9, h: 20, l: 9, c: 19, v: 6, n: 6 })
    h.feed.dispose()
  })

  it('keeps only history older than the bars it already watched arrive', async () => {
    const rows = [
      [0, '1', '1', '1', '1', '1', 59_999, '0', 1],
      // Overlaps the forming bar below. Taking it would overwrite trades we saw
      // with the venue's snapshot of the same bucket, and the bar would jump.
      [60_000, '99', '99', '99', '99', '99', 119_999, '0', 99],
    ]
    const h = harness({ fetchImpl: jsonOnce(rows) })
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade({ p: '50', q: '2', T: 60_500 }))

    const bars = await h.feed.history(SYM, '1m', 10)
    expect(bars.map((b) => b.t)).toEqual([0, 60_000])
    expect(bars[1].c).toBe(50)
    h.feed.dispose()
  })

  it('returns no bars, and does not throw, when history fails', async () => {
    const errors: Error[] = []
    const h = harness({
      onError: (e) => errors.push(e),
      fetchImpl: () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve(null) }),
    })
    await expect(h.feed.history(SYM, '1m', 10)).resolves.toEqual([])
    expect(errors).toHaveLength(1)
    h.feed.dispose()
  })

  it('pumps no ticks but still advances time so quiet minutes gain bars', () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade({ T: 60_000, p: '100' }))
    expect(h.feed.series(SYM, '1m')!.length).toBe(1)

    expect(h.feed.pump(120_000)).toBe(0)
    // Capped two seconds past the newest print. Free-running the clock would put
    // the forming bar ahead of the venue and the aggregator would then DROP the
    // next real trade for being in a bucket it had already closed.
    expect(h.feed.clock.now()).toBe(62_000)
    expect(h.ticks).toHaveLength(1)

    h.sockets[0].deliver(aggTrade({ T: 200_000, p: '100' }))
    h.feed.pump(1)
    // 60s, 120s, 180s: never a gap, because the chart maps x to a bar index and a
    // missing bucket bends the time axis for everything to its left.
    const s = h.feed.series(SYM, '1m')!
    expect([s.t[s.at(0)], s.t[s.at(1)], s.t[s.at(2)]]).toEqual([60_000, 120_000, 180_000])
    expect(s.length).toBe(3)
    h.feed.dispose()
  })
})

describe('the live feed losing its connection', () => {
  /** Bring a socket up, let it stream, then kill it — so the venue counts as
   *  "worked once" and the adapter stays where it is instead of failing over. */
  const cycle = (ws: FakeSocket) => {
    ws.open()
    ws.deliver(aggTrade())
    ws.fail()
  }

  it('reconnects on the 1/2/4/8/16/30 second ladder', () => {
    const h = harness()
    const expected = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]

    for (let i = 0; i < expected.length; i++) {
      expect(h.sockets).toHaveLength(i + 1)
      cycle(h.sockets[i])
      expect(h.feed.status).toBe('error')

      h.advance(expected[i] - 100)
      expect(h.sockets, `must not reconnect before ${expected[i]}ms`).toHaveLength(i + 1)
      h.advance(100)
      expect(h.sockets, `must reconnect at ${expected[i]}ms`).toHaveLength(i + 2)
    }
    h.feed.dispose()
  })

  it('spreads the ladder by up to ±20% of injected jitter', () => {
    const h = harness({ jitter: () => 1 })
    cycle(h.sockets[0])
    h.advance(1_100)
    expect(h.sockets).toHaveLength(1)
    h.advance(100)
    expect(h.sockets).toHaveLength(2)
    h.feed.dispose()
  })

  it('resets the ladder after thirty seconds of clean stream', () => {
    const h = harness()
    cycle(h.sockets[0]) // -> 1s
    h.advance(1_000)
    cycle(h.sockets[1]) // -> 2s
    h.advance(2_000)

    // The third connection behaves for half a minute, so the next failure is a
    // blip in a healthy session, not the seventh rung of an outage.
    h.sockets[2].open()
    h.sockets[2].deliver(aggTrade())
    h.advance(31_000)
    h.sockets[2].fail()

    h.advance(900)
    expect(h.sockets).toHaveLength(3)
    h.advance(100)
    expect(h.sockets).toHaveLength(4)
    h.feed.dispose()
  })

  it('reports stalled after twelve silent seconds and recovers on the next message', () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade())

    h.advance(11_000)
    expect(h.feed.status).toBe('live')
    h.advance(1_000)
    expect(h.feed.status).toBe('stalled')
    // Reported, not acted on: the socket is still open and a thin pair must not
    // be reconnected in a loop.
    expect(h.sockets).toHaveLength(1)

    h.sockets[0].deliver(aggTrade({ T: T0 + 1 }))
    expect(h.feed.status).toBe('live')
    expect(h.statuses).toContain('stalled')
    h.feed.dispose()
  })

  it('falls over to Coinbase when Binance never delivers a message', () => {
    const h = harness()
    h.sockets[0].fail()
    h.advance(1_000)

    expect(h.sockets).toHaveLength(2)
    expect(h.urls[1]).toBe('wss://ws-feed.exchange.coinbase.com')

    h.sockets[1].open()
    // Coinbase carries no subscription in the url, so it must be sent on open or
    // the socket sits there silent forever.
    expect(JSON.parse(h.sockets[1].sent[0])).toEqual({
      type: 'subscribe',
      product_ids: ['BTC-USDT'],
      channels: ['matches', 'level2_batch'],
    })
    h.feed.dispose()
  })

  it('stays on a venue that streamed and then dropped', () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade())
    h.sockets[0].fail()
    h.advance(1_000)
    expect(h.urls[1]).toContain('binance')
    h.feed.dispose()
  })

  it('ignores a socket it has already walked away from', () => {
    // A real WebSocket fires error AND close. Without the identity guard the
    // second one schedules a second reconnect, and two live sockets print every
    // trade twice.
    const h = harness()
    const ws = h.sockets[0]
    ws.open()
    ws.fail()
    ws.onclose?.()
    h.advance(1_000)
    expect(h.sockets).toHaveLength(2)
    h.feed.dispose()
  })
})

describe('the live feed on Coinbase', () => {
  /** Start on Coinbase directly rather than failing Binance over, so the venue's
   *  own message shapes are what is under test. */
  const coinbase = (over: Partial<LiveFeedOptions> = {}) => {
    const h = harness({ venue: 'coinbase', ...over })
    h.sockets[0].open()
    return h
  }

  it('reads a match as the TAKER’s side, not the maker’s', () => {
    const h = coinbase()
    h.sockets[0].deliver({
      type: 'match',
      product_id: 'BTC-USDT',
      price: '100.50',
      size: '2',
      side: 'sell',
      time: '2023-11-14T22:13:20.000Z',
    })
    // `side` is the resting order's side, so a resting sell means the taker BOUGHT.
    expect(h.ticks[0].s).toBe(1)
    expect(h.ticks[0].p).toBe(100.5)
    expect(h.ticks[0].t).toBe(Date.parse('2023-11-14T22:13:20.000Z'))
    h.feed.dispose()
  })

  it('keeps an incremental L2 book sorted and free of removed levels', () => {
    const h = coinbase()
    h.sockets[0].deliver({
      type: 'snapshot',
      product_id: 'BTC-USDT',
      bids: [
        ['99.00', '1'],
        ['100.00', '2'],
      ],
      asks: [
        ['102.00', '3'],
        ['101.00', '4'],
      ],
    })
    expect(h.feed.book(SYM)!.bids.map((l) => l.p)).toEqual([100, 99])
    expect(h.feed.book(SYM)!.asks.map((l) => l.p)).toEqual([101, 102])

    h.sockets[0].deliver({
      type: 'l2update',
      product_id: 'BTC-USDT',
      changes: [
        ['buy', '100.00', '0'],
        ['buy', '99.50', '7'],
        ['sell', '101.00', '0'],
        ['bogus', 'row'],
      ],
    })
    const b = h.feed.book(SYM)!
    expect(b.bids.map((l) => l.p)).toEqual([99.5, 99])
    expect(b.bids[0].q).toBe(7)
    expect(b.asks.map((l) => l.p)).toEqual([102])
    h.feed.dispose()
  })

  it('serves history from the granularities Coinbase actually has', async () => {
    const seen: string[] = []
    // [ time(s), low, high, open, close, volume ], newest first.
    const rows = [
      [120, '11', '15', '11', '14', '6'],
      [60, '9', '12', '10', '11', '5'],
    ]
    const h = coinbase({ fetchImpl: jsonOnce(rows, seen) })
    const bars = await h.feed.history(SYM, '1m', 10)
    expect(seen[0]).toBe(
      'https://api.exchange.coinbase.com/products/BTC-USDT/candles?granularity=60',
    )
    expect(bars).toEqual([
      { t: 60_000, o: 10, h: 12, l: 9, c: 11, v: 5, n: 0 },
      { t: 120_000, o: 11, h: 15, l: 11, c: 14, v: 6, n: 0 },
    ])

    // Sub-minute candles have no source at all there. An empty chart the UI can
    // explain beats bars we invented.
    const h2 = coinbase({ timeframes: ['5s'], fetchImpl: jsonOnce(rows) })
    await expect(h2.feed.history(SYM, '5s', 10)).resolves.toEqual([])
    h.feed.dispose()
    h2.feed.dispose()
  })

  it('surfaces a venue error frame without dropping the stream', () => {
    const errors: Error[] = []
    const h = coinbase({ onError: (e) => errors.push(e) })
    h.sockets[0].deliver({ type: 'error', message: 'unknown product' })
    expect(errors[0].message).toBe('unknown product')
    expect(h.feed.status).toBe('live')
    h.feed.dispose()
  })
})

describe('the live feed shutting down', () => {
  it('closes the socket, leaves no timer behind, and can be disposed twice', () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].deliver(aggTrade())
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    h.feed.dispose()
    expect(h.sockets[0].closed).toBe(true)
    expect(h.sockets[0].closeCode).toBe(1000)
    // A surviving heartbeat would keep a disposed world alive for the rest of the
    // session — the runtime is refcounted and StrictMode disposes twice.
    expect(vi.getTimerCount()).toBe(0)
    expect(h.feed.status).toBe('idle')
    expect(() => h.feed.dispose()).not.toThrow()
  })

  it('does not reconnect after disposal', () => {
    const h = harness()
    h.sockets[0].open()
    h.feed.dispose()
    h.sockets[0].fail()
    h.advance(60_000)
    expect(h.sockets).toHaveLength(1)
  })

  it('emits nothing once disposed', () => {
    const h = harness()
    h.sockets[0].open()
    const before = h.ticks.length
    h.feed.dispose()
    h.sockets[0].deliver(aggTrade())
    expect(h.ticks).toHaveLength(before)
  })
})

describe('the live feed changing its watchlist', () => {
  it('subscribes and unsubscribes on an open socket', () => {
    const h = harness()
    h.sockets[0].open()
    h.feed.add('ETHUSDT')
    expect(h.feed.symbols()).toEqual([SYM, 'ETHUSDT'])
    expect(JSON.parse(h.sockets[0].sent[0]).params).toEqual([
      'ethusdt@aggTrade',
      'ethusdt@depth20@100ms',
    ])

    h.feed.remove('ETHUSDT')
    expect(h.feed.symbols()).toEqual([SYM])
    expect(JSON.parse(h.sockets[0].sent[1]).method).toBe('UNSUBSCRIBE')
    h.feed.dispose()
  })

  it('does not open a socket until it has something to subscribe to', () => {
    const h = harness({ symbols: [] })
    expect(h.sockets).toHaveLength(0)
    expect(h.feed.status).toBe('idle')
    h.feed.add(SYM)
    expect(h.sockets).toHaveLength(1)
    expect(h.urls[0]).toContain('btcusdt@aggTrade')
    h.feed.dispose()
  })
})
