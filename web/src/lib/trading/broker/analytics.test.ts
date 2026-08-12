import { describe, expect, it } from 'vitest'
import { drawdown, positionRows, principalSeries, pushEquity, stats, summarize, type EquityPoint } from './analytics'
import { DEFAULT_SETTINGS, type BrokerAccount, type MarketView, type Position, type Trade } from './types'
import { MAX_CURVE, SNAPSHOT_MIN_GAP_MS, type Instrument, type Quote } from '../types'
import type { MarginTier } from './margin'

// ── The twenty-line fake world ───────────────────────────────────────────────

function world(prices: Record<string, number>, opens: Record<string, number> = {}) {
  const state = { t: 0, prices, opens }
  const quote = (symbol: string): Quote | undefined => {
    const p = state.prices[symbol]
    if (p === undefined) return undefined
    const o = state.opens[symbol] ?? p
    return { t: state.t, symbol, last: p, bid: p, ask: p, markPrice: p, indexPrice: p, open24h: o, high24h: p, low24h: p, volume24h: 0 }
  }
  const view: MarketView = {
    now: () => state.t,
    quote,
    fillPrice: (s) => quote(s)?.markPrice,
    instrument: (s) => (state.prices[s] === undefined ? undefined : spot(s)),
    recentCloses: () => undefined,
  }
  return { view, state }
}

const spot = (symbol: string): Instrument => ({
  kind: 'spot',
  symbol,
  base: symbol,
  quote: 'USD',
  tickSize: 0.01,
  lotSize: 0,
  pricePrecision: 2,
  qtyPrecision: 8,
})

const FLAT_1PCT: readonly MarginTier[] = [{ maxNotional: Infinity, rate: 0.01, deduction: 0 }]

const pos = (over: Partial<Position> & { symbol: string }): Position => ({
  kind: 'spot',
  qty: 1,
  avgCost: 100,
  mark: 100,
  openedAt: 0,
  ...over,
})

const account = (over: Partial<BrokerAccount> = {}): BrokerAccount => ({
  id: 'a',
  name: 'Test',
  createdAt: 0,
  currency: 'USD',
  cash: 100_000,
  startCash: 100_000,
  contributed: 100_000,
  realized: 0,
  positions: {},
  orders: [],
  orderSeq: 0,
  watchlist: [],
  settings: { ...DEFAULT_SETTINGS },
  lastFundingAt: 0,
  lastStepAt: 0,
  marginDeficit: 0,
  ...over,
})

const trade = (over: Partial<Trade> = {}): Trade => ({
  id: 't',
  t: 0,
  accountId: 'a',
  symbol: 'AAPL',
  label: 'AAPL',
  kind: 'spot',
  side: 'buy',
  qty: 1,
  price: 100,
  value: 100,
  fee: 0,
  realized: 0,
  note: '',
  ...over,
})

describe('positionRows', () => {
  it('sorts by exposure, biggest first, with a stable tie-break', () => {
    // The table repaints on every tick; an unstable sort would reorder rows
    // under the user's thumb mid-tap.
    const w = world({ A: 100, B: 100, C: 100 })
    const a = account({
      positions: {
        A: pos({ symbol: 'A', qty: 1 }),
        B: pos({ symbol: 'B', qty: 5 }),
        C: pos({ symbol: 'C', qty: 1 }),
      },
    })
    expect(positionRows(a, w.view, undefined, FLAT_1PCT).map((r) => r.symbol)).toEqual(['B', 'A', 'C'])
  })

  it('ranks a big SHORT by its size, not by its sign', () => {
    const w = world({ A: 100, B: 100 })
    const a = account({ positions: { A: pos({ symbol: 'A', qty: 1 }), B: pos({ symbol: 'B', qty: -5 }) } })
    expect(positionRows(a, w.view, undefined, FLAT_1PCT)[0].symbol).toBe('B')
  })

  it('reports a winning short as a GAIN in percent', () => {
    // Against |cost|. Dividing by the signed cost inverts the percentage on
    // every short, which reads as a loss while the money goes up.
    const w = world({ A: 90 })
    const a = account({ positions: { A: pos({ symbol: 'A', qty: -10, avgCost: 100 }) } })
    const row = positionRows(a, w.view, undefined, FLAT_1PCT)[0]
    expect(row.unreal).toBeCloseTo(100, 9)
    expect(row.unrealPct).toBeCloseTo(10, 9)
  })

  it('carries a perp position’s leverage and liquidation price', () => {
    const w = world({ BTC: 100 })
    const a = account({
      settings: { ...DEFAULT_SETTINGS, liquidationFeeBps: 0 },
      positions: { BTC: pos({ symbol: 'BTC', kind: 'perp', qty: 1, leverage: 10, margin: 10 }) },
    })
    const row = positionRows(a, w.view, undefined, FLAT_1PCT)[0]
    expect(row.leverage).toBe(10)
    expect(row.liqPrice).toBeCloseTo(90.9090909090909, 9)
  })

  it('takes greeks from the caller and never imports a pricer', () => {
    // broker/ must not depend on options/ — the two are built in parallel, and
    // an import would make one workstream's compile failure the other's.
    const w = world({ A: 100 })
    const a = account({ positions: { A: pos({ symbol: 'A', kind: 'option', multiplier: 100 }) } })
    const g = { price: 5, delta: 0.5, gamma: 0.01, vega: 0.2, theta: -0.03, rho: 0.1 }
    const row = positionRows(a, w.view, () => g, FLAT_1PCT)[0]
    expect(row.greeks).toEqual(g)
    expect(row.value).toBe(100 * 100) // multiplier applied
  })

  it('leaves greeks off when no pricer is supplied', () => {
    const w = world({ A: 100 })
    const a = account({ positions: { A: pos({ symbol: 'A' }) } })
    expect(positionRows(a, w.view, undefined, FLAT_1PCT)[0].greeks).toBeUndefined()
  })
})

describe('summarize', () => {
  it('measures total P/L against contributed capital, so a deposit is not a gain', () => {
    // The single choice that makes the headline number trustworthy.
    const w = world({})
    const a = account({ cash: 105_000, contributed: 105_000 })
    const s = summarize(a, w.view, FLAT_1PCT)
    expect(s.totalChange).toBe(0)
    expect(s.totalPct).toBe(0)
  })

  it('adds an open position’s market value to equity', () => {
    const w = world({ AAPL: 110 })
    // 10 bought at 100: cash went down by 1000, the position is worth 1100.
    const a = account({ cash: 99_000, positions: { AAPL: pos({ symbol: 'AAPL', qty: 10, avgCost: 100 }) } })
    const s = summarize(a, w.view, FLAT_1PCT)
    expect(s.equity).toBeCloseTo(100_100, 9)
    expect(s.invested).toBeCloseTo(1100, 9)
    expect(s.totalChange).toBeCloseTo(100, 9)
  })

  it('splits realized and unrealized BY CONSTRUCTION', () => {
    // Computed as totalChange − realized rather than summed independently: two
    // independent sums can disagree, and a blotter that does not add up to the
    // headline is worse than no blotter at all.
    const w = world({ AAPL: 110 })
    const a = account({ cash: 99_250, realized: 250, positions: { AAPL: pos({ symbol: 'AAPL', qty: 10, avgCost: 100 }) } })
    const s = summarize(a, w.view, FLAT_1PCT)
    expect(s.realized + s.unrealized).toBeCloseTo(s.totalChange, 9)
  })

  it('measures the day change from the 24h open', () => {
    const w = world({ AAPL: 110 }, { AAPL: 100 })
    const a = account({ cash: 99_000, positions: { AAPL: pos({ symbol: 'AAPL', qty: 10, avgCost: 100 }) } })
    const s = summarize(a, w.view, FLAT_1PCT)
    expect(s.dayChange).toBeCloseTo(100, 9)
    expect(s.dayPct).toBeCloseTo((100 / 100_000) * 100, 9)
  })

  it('leaves options out of the day change', () => {
    // paper.py excluded them too: a contract's own 24h open is the option price,
    // and mixing that into an equity day-change reads as noise.
    const w = world({ OPT: 6 }, { OPT: 5 })
    const a = account({ positions: { OPT: pos({ symbol: 'OPT', kind: 'option', multiplier: 100 }) } })
    expect(summarize(a, w.view, FLAT_1PCT).dayChange).toBe(0)
  })

  it('reports 0% rather than NaN on an unfunded account', () => {
    const w = world({})
    const a = account({ cash: 0, startCash: 0, contributed: 0 })
    const s = summarize(a, w.view, FLAT_1PCT)
    expect(s.totalPct).toBe(0)
    expect(s.dayPct).toBe(0)
  })
})

describe('pushEquity', () => {
  it('throttles to one sample per SNAPSHOT_MIN_GAP_MS', () => {
    const curve: EquityPoint[] = []
    expect(pushEquity(curve, { t: 0, v: 100 }, false)).toBe(true)
    expect(pushEquity(curve, { t: 1000, v: 101 }, false)).toBe(false)
    expect(pushEquity(curve, { t: SNAPSHOT_MIN_GAP_MS, v: 102 }, false)).toBe(true)
    expect(curve).toHaveLength(2)
  })

  it('lets a forced sample through, so a fill is always on the curve', () => {
    const curve: EquityPoint[] = [{ t: 0, v: 100 }]
    expect(pushEquity(curve, { t: 1, v: 101 }, true)).toBe(true)
  })

  it('DOWNSAMPLES on overflow rather than dropping the head', () => {
    // paper.py's `del curve[:n]` silently discards the beginning of the
    // account's history, so a long-running account's chart starts at an
    // arbitrary Tuesday. Halving the resolution keeps the full time range.
    const curve: EquityPoint[] = []
    for (let i = 0; i <= MAX_CURVE; i++) pushEquity(curve, { t: i * SNAPSHOT_MIN_GAP_MS, v: i }, true)

    expect(curve.length).toBeLessThanOrEqual(MAX_CURVE)
    expect(curve[0].t).toBe(0) // the beginning survives
    expect(curve[curve.length - 1].t).toBe(MAX_CURVE * SNAPSHOT_MIN_GAP_MS) // and the newest edge
  })

  it('stays capped over repeated overflows', () => {
    const curve: EquityPoint[] = []
    for (let i = 0; i < MAX_CURVE * 3; i++) pushEquity(curve, { t: i * 1000, v: i }, true)
    expect(curve.length).toBeLessThanOrEqual(MAX_CURVE)
    expect(curve[0].t).toBe(0)
  })
})

describe('principalSeries', () => {
  it('draws net contributed capital as a step line on the curve’s own timestamps', () => {
    const curve: EquityPoint[] = [
      { t: 0, v: 1000 },
      { t: 10, v: 1200 },
      { t: 20, v: 1150 },
    ]
    const trades = [
      trade({ t: 5, side: 'deposit', value: 100 }),
      trade({ t: 15, side: 'withdraw', value: 50 }),
      trade({ t: 8, side: 'buy', value: 500 }), // not a cash flow
    ]
    expect(principalSeries(curve, trades, 1000)).toEqual([1000, 1100, 1050])
  })

  it('handles cash flows arriving out of order', () => {
    const curve: EquityPoint[] = [{ t: 100, v: 0 }]
    const trades = [trade({ t: 50, side: 'withdraw', value: 20 }), trade({ t: 10, side: 'deposit', value: 100 })]
    expect(principalSeries(curve, trades, 0)).toEqual([80])
  })

  it('is empty for an empty curve', () => {
    expect(principalSeries([], [trade({ side: 'deposit', value: 100 })], 0)).toEqual([])
  })
})

describe('drawdown', () => {
  it('measures peak to trough, not first to last', () => {
    const curve: EquityPoint[] = [
      { t: 0, v: 100 },
      { t: 1, v: 150 },
      { t: 2, v: 90 },
      { t: 3, v: 120 },
    ]
    const d = drawdown(curve)
    expect(d.maxDd).toBe(60)
    expect(d.peak).toBe(150)
    expect(d.maxDdPct).toBeCloseTo(40, 9)
  })

  it('reports nothing for a curve that only goes up', () => {
    const d = drawdown([
      { t: 0, v: 100 },
      { t: 1, v: 200 },
    ])
    expect(d.maxDd).toBe(0)
    expect(d.peak).toBe(200)
  })

  it('survives an empty curve', () => {
    expect(drawdown([])).toEqual({ maxDd: 0, maxDdPct: 0, peak: 0 })
  })
})

describe('stats', () => {
  it('counts only trades that booked P/L', () => {
    // An opening buy has realized 0 and is neither a win nor a loss. A naive
    // `realized <= 0` filter calls it a loss and halves the win rate of anyone
    // who holds anything.
    const s = stats([
      trade({ realized: 0 }), // the open
      trade({ realized: 100 }),
      trade({ realized: -50 }),
      trade({ realized: 200 }),
    ])
    expect(s.wins).toBe(2)
    expect(s.losses).toBe(1)
    expect(s.winRate).toBeCloseTo(66.6667, 3)
    expect(s.avgWin).toBe(150)
    expect(s.avgLoss).toBe(50)
    expect(s.profitFactor).toBeCloseTo(300 / 50, 9)
    expect(s.expectancy).toBeCloseTo(250 / 3, 9)
  })

  it('reports an infinite profit factor for a run with no losses', () => {
    expect(stats([trade({ realized: 100 })]).profitFactor).toBe(Infinity)
  })

  it('returns zeroes for a blotter with nothing closed', () => {
    const s = stats([trade({ realized: 0 })])
    expect(s).toEqual({ wins: 0, losses: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, expectancy: 0 })
  })
})
