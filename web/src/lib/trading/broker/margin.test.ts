import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIERS,
  fundingRate,
  liquidate,
  liquidationPrice,
  LIQ_TARGET_RATIO,
  maintenanceRate,
  marginSummary,
  type MarginTier,
} from './margin'
import { DEFAULT_SETTINGS, type BrokerAccount, type BrokerEvent, type BrokerSettings, type MarketView, type Position } from './types'
import type { Instrument, Quote } from '../types'

// ── The twenty-line fake world ───────────────────────────────────────────────
// This is what the injected-MarketView design is for: the entire market engine,
// replaced by a price map. Nothing here reads a clock or a database.

function world(prices: Record<string, number>) {
  const state = { t: 0, prices, index: { ...prices } }
  const quote = (symbol: string): Quote | undefined => {
    const p = state.prices[symbol]
    if (p === undefined) return undefined
    const i = state.index[symbol] ?? p
    return { t: state.t, symbol, last: p, bid: p, ask: p, markPrice: p, indexPrice: i, open24h: p, high24h: p, low24h: p, volume24h: 0 }
  }
  const view: MarketView = {
    now: () => state.t,
    quote,
    fillPrice: (s) => quote(s)?.markPrice,
    instrument: (s) => (state.prices[s] === undefined ? undefined : perp(s)),
    recentCloses: () => undefined,
  }
  return { view, state }
}

const perp = (symbol: string): Instrument => ({
  kind: 'perp',
  symbol,
  underlying: symbol,
  tickSize: 0.01,
  lotSize: 0,
  pricePrecision: 2,
  qtyPrecision: 8,
  maxLeverage: 100,
  fundingIntervalMs: 28_800_000,
})

/** A flat 1% ladder — the ladder the pinned liquidation numbers were computed on. */
const FLAT_1PCT: readonly MarginTier[] = [{ maxNotional: Infinity, rate: 0.01, deduction: 0 }]

const settings = (over: Partial<BrokerSettings> = {}): BrokerSettings => ({
  ...DEFAULT_SETTINGS,
  liquidationFeeBps: 0, // "no fee", as the pinned cases specify
  ...over,
})

const position = (over: Partial<Position> = {}): Position => ({
  symbol: 'BTC',
  kind: 'perp',
  qty: 1,
  avgCost: 100,
  mark: 100,
  openedAt: 0,
  leverage: 10,
  margin: 10,
  ...over,
})

const account = (over: Partial<BrokerAccount> = {}): BrokerAccount => ({
  id: 'a',
  name: 'Test',
  createdAt: 0,
  currency: 'USD',
  cash: 0,
  startCash: 0,
  contributed: 0,
  realized: 0,
  positions: {},
  orders: [],
  orderSeq: 0,
  watchlist: [],
  settings: settings(),
  lastFundingAt: 0,
  lastStepAt: 0,
  marginDeficit: 0,
  ...over,
})

describe('liquidationPrice — the pinned closed form', () => {
  it('puts a long 1 @ 100 at 10x with 1% maintenance at 90.909090…', () => {
    const L = liquidationPrice(position(), settings(), FLAT_1PCT)
    expect(L).toBeCloseTo(90.9090909090909, 10)
    expect(L).toBe(90 / 0.99) // exact, not merely close
  })

  it('puts the same short at 108.910891…', () => {
    const L = liquidationPrice(position({ qty: -1 }), settings(), FLAT_1PCT)
    expect(L).toBeCloseTo(108.9108910891089, 10)
    expect(L).toBe(110 / 1.01)
  })

  it('gives marginRatio exactly 1 AT the liquidation price', () => {
    // The whole point of the closed form: the price it names is the price the
    // health check independently agrees is the edge. Cash holds the reserved
    // margin, so account equity here IS the position's equity.
    for (const qty of [1, -1]) {
      const pos = position({ qty })
      const L = liquidationPrice(pos, settings(), FLAT_1PCT)!
      const w = world({ BTC: L })
      const a = account({ cash: 10, positions: { BTC: { ...pos, mark: L } } })
      expect(marginSummary(a, w.view, FLAT_1PCT).marginRatio).toBeCloseTo(1, 9)
    }
  })

  it('folds the liquidation fee in as a RATE, moving L adversely', () => {
    // As a lump the fee would depend on L, which depends on the fee — the
    // equation stops being solvable without iteration, and the preview stops
    // agreeing with the fill.
    const withFee = liquidationPrice(position(), settings({ liquidationFeeBps: 50 }), FLAT_1PCT)!
    expect(withFee).toBe(90 / (1 - 0.015))
    expect(withFee).toBeGreaterThan(90 / 0.99) // a long is liquidated sooner
  })

  it('raises L for a long and lowers it for a short as leverage rises', () => {
    const long10 = liquidationPrice(position({ leverage: 10, margin: 10 }), settings(), FLAT_1PCT)!
    const long20 = liquidationPrice(position({ leverage: 20, margin: 5 }), settings(), FLAT_1PCT)!
    expect(long20).toBeGreaterThan(long10)

    const short10 = liquidationPrice(position({ qty: -1, leverage: 10, margin: 10 }), settings(), FLAT_1PCT)!
    const short20 = liquidationPrice(position({ qty: -1, leverage: 20, margin: 5 }), settings(), FLAT_1PCT)!
    expect(short20).toBeLessThan(short10)
  })

  it('lowers L for a long when margin is added', () => {
    const L = liquidationPrice(position({ margin: 30 }), settings(), FLAT_1PCT)!
    expect(L).toBeLessThan(90 / 0.99)
  })

  it('moves L monotonically adverse as funding is paid', () => {
    const long = liquidationPrice(position({ fundingPaid: 2 }), settings(), FLAT_1PCT)!
    expect(long).toBeGreaterThan(90 / 0.99) // liquidated sooner
    const short = liquidationPrice(position({ qty: -1, fundingPaid: 2 }), settings(), FLAT_1PCT)!
    expect(short).toBeLessThan(110 / 1.01) // also sooner
  })

  it('has no liquidation price for a fully-paid spot or option position', () => {
    expect(liquidationPrice(position({ kind: 'spot' }), settings(), FLAT_1PCT)).toBeNull()
    expect(liquidationPrice(position({ kind: 'option' }), settings(), FLAT_1PCT)).toBeNull()
  })

  it('has none for a long whose combined rate reaches 1', () => {
    const impossible: readonly MarginTier[] = [{ maxNotional: Infinity, rate: 1, deduction: 0 }]
    expect(liquidationPrice(position(), settings(), impossible)).toBeNull()
  })
})

describe('the maintenance ladder', () => {
  it('is continuous at every tier edge', () => {
    // A discontinuous ladder liquidates people for growing a position by a
    // dollar, which is the kind of bug that only ever shows up in production.
    for (const t of DEFAULT_TIERS) {
      if (!Number.isFinite(t.maxNotional)) continue
      const n = t.maxNotional
      const below = maintenanceRate(n, DEFAULT_TIERS)
      const above = maintenanceRate(n + 1, DEFAULT_TIERS)
      expect(n * below.rate - below.deduction).toBeCloseTo(n * above.rate - above.deduction, 6)
    }
  })

  it('charges more on a bigger position', () => {
    const small = maintenanceRate(10_000)
    const large = maintenanceRate(2_000_000)
    expect(large.rate).toBeGreaterThan(small.rate)
  })
})

describe('marginSummary', () => {
  it('counts a cash-paid position at market value and a perp at unrealised', () => {
    // The distinction that makes equity right: applyFill already took the spot's
    // notional out of cash, and never took the perp's.
    const w = world({ AAPL: 110, BTC: 110 })
    const a = account({
      cash: 500,
      positions: {
        AAPL: position({ symbol: 'AAPL', kind: 'spot', qty: 10, avgCost: 100, leverage: undefined, margin: undefined }),
        BTC: position({ qty: 1, avgCost: 100, margin: 10, leverage: 10 }),
      },
    })
    const s = marginSummary(a, w.view, FLAT_1PCT)
    expect(s.equity).toBeCloseTo(500 + 10 * 110 + 1 * (110 - 100), 9)
    expect(s.used).toBe(10) // only the perp reserves collateral
  })

  it('reports an infinite ratio when nothing is margined', () => {
    const w = world({ AAPL: 100 })
    const a = account({ cash: 100, positions: { AAPL: position({ symbol: 'AAPL', kind: 'spot', margin: undefined }) } })
    const s = marginSummary(a, w.view, FLAT_1PCT)
    expect(s.marginRatio).toBe(Infinity)
    expect(s.marginLevel).toBe(Infinity)
  })

  it('lists liquidatable symbols largest maintenance first', () => {
    const w = world({ BIG: 100, MID: 100, SMALL: 100 })
    const a = account({
      cash: 100,
      positions: {
        SMALL: position({ symbol: 'SMALL', qty: 1 }),
        BIG: position({ symbol: 'BIG', qty: 10 }),
        MID: position({ symbol: 'MID', qty: 5 }),
      },
    })
    expect(marginSummary(a, w.view, FLAT_1PCT).liquidatable).toEqual(['BIG', 'MID', 'SMALL'])
  })
})

describe('liquidate', () => {
  /** Three perps at a mild loss, on an account that cannot carry them. */
  function stressed() {
    const w = world({ BIG: 99, MID: 99, SMALL: 99 })
    const a = account({
      cash: 20,
      positions: {
        BIG: position({ symbol: 'BIG', qty: 10, avgCost: 100, mark: 99, margin: 100 }),
        MID: position({ symbol: 'MID', qty: 5, avgCost: 100, mark: 99, margin: 50 }),
        SMALL: position({ symbol: 'SMALL', qty: 1, avgCost: 100, mark: 99, margin: 10 }),
      },
    })
    return { w, a }
  }

  it('does nothing to a healthy account', () => {
    const { w } = stressed()
    const a = account({ cash: 10_000, positions: { BIG: position({ symbol: 'BIG', qty: 10, mark: 99 }) } })
    const out: BrokerEvent[] = []
    liquidate(a, w.view, out, FLAT_1PCT)
    expect(out).toEqual([])
    expect(Object.keys(a.positions)).toEqual(['BIG'])
  })

  it('stops at ratio ≥ 1.3 and leaves the SMALLEST positions open', () => {
    // Nuking the account is easier to write and much worse: a user 2% short on
    // one position should lose that position, not everything they hold.
    const { w, a } = stressed()
    const out: BrokerEvent[] = []
    expect(marginSummary(a, w.view, FLAT_1PCT).marginRatio).toBeLessThan(1)

    liquidate(a, w.view, out, FLAT_1PCT)

    expect(Object.keys(a.positions)).toEqual(['SMALL'])
    const after = marginSummary(a, w.view, FLAT_1PCT)
    expect(after.marginRatio).toBeGreaterThanOrEqual(LIQ_TARGET_RATIO)
  })

  it('closes the largest maintenance first, in order', () => {
    const { w, a } = stressed()
    const out: BrokerEvent[] = []
    liquidate(a, w.view, out, FLAT_1PCT)
    const closed = out.filter((e) => e.type === 'liquidation').map((e) => e.symbol)
    expect(closed).toEqual(['BIG', 'MID'])
  })

  it('books each forced close in the blotter', () => {
    const { w, a } = stressed()
    const out: BrokerEvent[] = []
    liquidate(a, w.view, out, FLAT_1PCT)
    const fills = out.filter((e) => e.type === 'fill')
    expect(fills).toHaveLength(2)
    expect(fills[0].trade.side).toBe('liquidation')
    expect(fills[0].trade.realized).toBeCloseTo(10 * (99 - 100), 9)
    expect(a.realized).toBeCloseTo(-15, 9)
  })

  it('never leaves cash below zero, and reports the shortfall as socialised', () => {
    // The account can go to zero but not below: this app cannot collect on a
    // debt, so the gap is recorded and surfaced rather than silently swallowed.
    const w = world({ BIG: 60 })
    const a = account({
      cash: 20,
      positions: { BIG: position({ symbol: 'BIG', qty: 10, avgCost: 100, mark: 60, margin: 100 }) },
    })
    const out: BrokerEvent[] = []
    liquidate(a, w.view, out, FLAT_1PCT)

    expect(a.cash).toBe(0)
    expect(a.cash).toBeGreaterThanOrEqual(0)
    const liq = out.find((e) => e.type === 'liquidation')!
    // Closing 10 @ 60 against a basis of 100 realizes −400 on 20 of cash.
    expect(liq.socialised).toBeCloseTo(380, 9)
  })

  it('terminates even when liquidating everything cannot cure the account', () => {
    const w = world({ A: 10, B: 10 })
    const a = account({
      cash: 0,
      positions: {
        A: position({ symbol: 'A', qty: 10, avgCost: 100, mark: 10, margin: 100 }),
        B: position({ symbol: 'B', qty: 5, avgCost: 100, mark: 10, margin: 50 }),
      },
    })
    liquidate(a, w.view, [], FLAT_1PCT)
    expect(a.positions).toEqual({})
  })
})

describe('fundingRate', () => {
  it('is positive when the perp trades above the index, so longs pay', () => {
    expect(fundingRate(101, 100, DEFAULT_SETTINGS)).toBeGreaterThan(0)
  })

  it('is negative when the perp trades below it', () => {
    expect(fundingRate(99, 100, DEFAULT_SETTINGS)).toBeLessThan(0)
  })

  it('leaves only the interest leg when mark and index agree', () => {
    expect(fundingRate(100, 100, DEFAULT_SETTINGS)).toBeCloseTo(0.0001, 12)
  })

  it('clamps to ±fundingCap in both directions', () => {
    const s = { ...DEFAULT_SETTINGS, fundingCap: 0.0075 }
    expect(fundingRate(200, 100, s)).toBe(0.0075)
    expect(fundingRate(1, 100, s)).toBe(-0.0075)
  })

  it('is deterministic — the same spread always gives the same rate', () => {
    expect(fundingRate(101, 100, DEFAULT_SETTINGS)).toBe(fundingRate(101, 100, DEFAULT_SETTINGS))
  })
})
