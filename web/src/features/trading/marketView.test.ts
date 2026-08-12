import { describe, it, expect } from 'vitest'
import { createMarketView, perpOf } from './marketView'
import { createClock } from '../../lib/trading/market/clock'
import type { FeedStatus, MarketFeed, WorldSnapshot } from '../../lib/trading/market/feed'
import type { SpotInstrument } from '../../lib/trading/types'

const SPOT = 'BTCUSDT'

/**
 * The smallest thing that is a `MarketFeed`.
 *
 * Everything the view reads about an instrument comes through `instrument()`,
 * so that is the only member with a body worth writing — the rest exist because
 * the interface says so. Handing `createMarketView` a real feed would work too,
 * and would make the one thing under test (a spot precision that CHANGES after
 * first ask) a matter of waiting for a socket instead of assigning a field.
 */
class StubFeed implements MarketFeed {
  readonly mode = 'live' as const
  readonly clock = createClock()
  readonly status: FeedStatus = 'live'
  /** The live adapter replaces this object as it learns the venue's precision,
   *  so the test does the same rather than mutating in place. */
  spot: SpotInstrument = {
    kind: 'spot',
    symbol: SPOT,
    base: 'BTC',
    quote: 'USDT',
    tickSize: 0.01,
    lotSize: 1e-8,
    pricePrecision: 2,
    qtyPrecision: 8,
  }

  symbols() {
    return [SPOT]
  }
  instrument(symbol: string) {
    return symbol === SPOT ? this.spot : undefined
  }
  add() {}
  remove() {}
  subscribe() {
    return () => {}
  }
  quote() {
    return undefined
  }
  book() {
    return undefined
  }
  series() {
    return undefined
  }
  fillPrice() {
    return undefined
  }
  history() {
    return Promise.resolve([])
  }
  pump() {
    return 0
  }
  catchUp() {
    return Promise.resolve()
  }
  snapshot(): WorldSnapshot {
    return { version: 1, seed: '', clock: this.clock.snapshot(), savedAtWall: 0, markets: {} }
  }
  dispose() {}
}

describe('the perp view of a spot instrument', () => {
  it('derives itself from the spot it wraps', () => {
    const feed = new StubFeed()
    const view = createMarketView(feed)
    const p = view.instrument(perpOf(SPOT))!
    expect(p.kind).toBe('perp')
    expect(p.kind === 'perp' && p.underlying).toBe(SPOT)
    expect(p.tickSize).toBe(0.01)
    expect(p.pricePrecision).toBe(2)
  })

  it('tracks a spot precision that changed after the first ask', () => {
    // The shipped defect: perps were memoised on first build, so one asked for
    // before the live feed's first print stayed pinned to the provisional tick
    // for the session while spot walked on without it. The two then disagreed
    // about the same market — the perp priced on 0.01 while spot was on 1e-8.
    const feed = new StubFeed()
    const view = createMarketView(feed)

    expect(view.instrument(perpOf(SPOT))!.tickSize).toBe(0.01)

    feed.spot = { ...feed.spot, tickSize: 1e-8, pricePrecision: 8 }

    const after = view.instrument(perpOf(SPOT))!
    expect(after.pricePrecision).toBe(8)
    expect(after.tickSize).toBe(1e-8)
  })

  it('is undefined when the underlying is not a symbol the feed has', () => {
    const view = createMarketView(new StubFeed())
    expect(view.instrument(perpOf('ETHUSDT'))).toBeUndefined()
  })
})
