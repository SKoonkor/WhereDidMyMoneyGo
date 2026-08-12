import { describe, expect, it } from 'vitest'
import {
  cancelOrder,
  createAccount,
  deposit,
  placeOrder,
  previewOrder,
  step,
  withdraw,
  type OrderRequest,
} from './engine'
import { DEFAULT_SETTINGS, type BrokerAccount, type BrokerEvent, type MarketView, type Order, type Position } from './types'
import type { Instrument, Quote } from '../types'
import type { MarginTier } from './margin'

// ── The twenty-line fake world ───────────────────────────────────────────────
// The entire market engine, replaced by a mutable price map. This is what the
// injected-MarketView design buys: no clock, no feed, no database in a unit test.

function world(prices: Record<string, number>, insts: Record<string, Instrument> = {}) {
  const state = { t: 0, prices }
  const quote = (symbol: string): Quote | undefined => {
    const p = state.prices[symbol]
    if (p === undefined) return undefined
    return { t: state.t, symbol, last: p, bid: p, ask: p, markPrice: p, indexPrice: p, open24h: p, high24h: p, low24h: p, volume24h: 0 }
  }
  const view: MarketView = {
    now: () => state.t,
    quote,
    fillPrice: (s) => quote(s)?.markPrice,
    instrument: (s) => insts[s] ?? (state.prices[s] === undefined ? undefined : spot(s)),
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

const perp = (symbol: string): Instrument => ({
  kind: 'perp',
  symbol,
  underlying: symbol,
  tickSize: 0.01,
  lotSize: 0,
  pricePrecision: 2,
  qtyPrecision: 8,
  maxLeverage: 20,
  fundingIntervalMs: 60_000,
})

const FLAT_1PCT: readonly MarginTier[] = [{ maxNotional: Infinity, rate: 0.01, deduction: 0 }]

/** ET wall time as an instant. July is EDT, so ET = UTC−4. */
const et = (y: number, mo: number, d: number, hh: number, mm = 0) => Date.UTC(y, mo - 1, d, hh + 4, mm)

const PRICE = 2.76 // paper.py's own fixture price

/** A concrete instant to run the clock from: 09:30 ET on Monday 13 July 2026.
 *  `lastStepAt === 0` means "this account has never been stepped", so a fixture
 *  that starts at the epoch would be synced rather than advanced. */
const T0 = et(2026, 7, 13, 9, 30)

/**
 * An account with paper.py's economics: no fees, no slippage. paper.py had
 * neither, so the ported cases have to run without them or the arithmetic they
 * pin stops matching line for line.
 */
function acct(over: Partial<BrokerAccount> = {}): BrokerAccount {
  const a = createAccount({ id: 'a', name: 'Test', currency: 'USD', startCash: 100_000, now: 0 })
  a.settings = { ...DEFAULT_SETTINGS, takerFeeBps: 0, makerFeeBps: 0, slippageBps: 0, liquidationFeeBps: 0 }
  return Object.assign(a, over)
}

function hold(a: BrokerAccount, symbol: string, qty: number, avgCost = PRICE, over: Partial<Position> = {}) {
  a.positions[symbol] = { symbol, kind: 'spot', qty, avgCost, mark: PRICE, openedAt: 0, ...over }
}

const sell = (a: BrokerAccount, m: MarketView, symbol: string, qty: number) =>
  placeOrder(a, m, { symbol, side: 'sell', type: 'market', mode: 'shares', qty })

// ── The pinned order-level behaviours, ported from tests/test_paper_orders.py ─

describe('the dust snap, through placeOrder', () => {
  it('closes the position when the user sells the quantity the screen showed', () => {
    // PINNED (test_dust_snap_sell_closes_position). A $-mode buy leaves
    // 12280.282631694204 held; without the snap the sell leaves an unclosable
    // crumb, or tips into an accidental micro-short.
    const w = world({ ENGS: PRICE })
    const a = acct()
    hold(a, 'ENGS', 12280.282631694205) // paper.py spells it ...204; same double
    sell(a, w.view, 'ENGS', 12280.2826)
    expect(a.positions.ENGS).toBeUndefined()
  })

  it('covers a micro short exactly', () => {
    // PINNED (test_dust_snap_buy_covers_micro_short).
    const w = world({ ENGS: PRICE })
    const a = acct()
    hold(a, 'ENGS', -3.534005778906818e-5)
    placeOrder(a, w.view, { symbol: 'ENGS', side: 'buy', type: 'market', mode: 'shares', qty: 0.0001 })
    expect(a.positions.ENGS).toBeUndefined()
  })

  it('leaves an intentional partial sell a partial sell', () => {
    // PINNED (test_no_snap_on_material_difference).
    const w = world({ ENGS: PRICE })
    const a = acct()
    hold(a, 'ENGS', 12280.28)
    sell(a, w.view, 'ENGS', 12000)
    expect(a.positions.ENGS.qty).toBeCloseTo(280.28, 9)
  })

  it('never snaps a fresh short', () => {
    // PINNED (test_no_snap_when_not_reducing): selling with no position is a
    // short, and snapping it to |held| = 0 would silently drop the order.
    const w = world({ NEWS: PRICE })
    const a = acct()
    sell(a, w.view, 'NEWS', 5)
    expect(a.positions.NEWS.qty).toBe(-5)
  })
})

describe('previewOrder — the short-warning fields', () => {
  it('reports isShort, held and shortQty when a sell runs past the long', () => {
    // PINNED (test_preview_reports_short_details).
    const w = world({ ENGS: PRICE })
    const a = acct()
    hold(a, 'ENGS', 100)
    const p = previewOrder(a, w.view, { symbol: 'ENGS', side: 'sell', type: 'market', mode: 'shares', qty: 150 })
    expect('error' in p).toBe(false)
    if ('error' in p) return
    expect(p.isShort).toBe(true)
    expect(p.held).toBeCloseTo(100, 9)
    expect(p.shortQty).toBeCloseTo(50, 9)
  })

  it('does not call a full close a short', () => {
    // PINNED (test_preview_full_close_is_not_short). The 1e-9 in the comparison
    // is exactly what stops a float-dusty full close reading as opening a short.
    const w = world({ ENGS: PRICE })
    const a = acct()
    hold(a, 'ENGS', 100)
    const p = previewOrder(a, w.view, { symbol: 'ENGS', side: 'sell', type: 'market', mode: 'shares', qty: 100 })
    if ('error' in p) throw new Error('unexpected error')
    expect(p.isShort).toBe(false)
    expect(p.shortQty).toBe(0)
  })

  it('prices, sizes and costs the order without touching the account', () => {
    const w = world({ ENGS: PRICE })
    const a = acct({ settings: { ...DEFAULT_SETTINGS, takerFeeBps: 10 } })
    const before = JSON.stringify(a)
    const p = previewOrder(a, w.view, { symbol: 'ENGS', side: 'buy', type: 'market', mode: 'dollars', qty: 276 })
    if ('error' in p) throw new Error('unexpected error')
    expect(p.qty).toBeCloseTo(100, 9)
    expect(p.est).toBeCloseTo(276, 9)
    expect(p.fee).toBeCloseTo(0.276, 9)
    expect(p.approx).toBe(true)
    expect(JSON.stringify(a)).toBe(before)
  })

  it('shows an exact price for a limit and an estimate for a market', () => {
    const w = world({ ENGS: PRICE })
    const a = acct()
    const lim = previewOrder(a, w.view, { symbol: 'ENGS', side: 'buy', type: 'limit', mode: 'shares', qty: 1, limit: 2.5 })
    if ('error' in lim) throw new Error('unexpected error')
    expect(lim.price).toBe(2.5)
    expect(lim.approx).toBe(false)
  })

  it('shows the underlying, not the contract key, for an option', () => {
    const contract: Instrument = {
      kind: 'option',
      symbol: 'AAPL|2026-07-06|call|302.5',
      underlying: 'AAPL',
      expiry: et(2026, 7, 6, 16),
      right: 'call',
      strike: 302.5,
      multiplier: 100,
      tickSize: 0.01,
      pricePrecision: 2,
    }
    const w = world({ [contract.symbol]: 5 }, { [contract.symbol]: contract })
    const a = acct()
    const p = previewOrder(a, w.view, { symbol: contract.symbol, side: 'buy', type: 'market', mode: 'shares', qty: 1 })
    if ('error' in p) throw new Error('unexpected error')
    expect(p.symbol).toBe('AAPL')
    expect(p.label).toBe('AAPL 2026-07-06 C302.5')
    expect(p.isOption).toBe(true)
    expect(p.mult).toBe(100)
    expect(p.est).toBe(500)
  })
})

describe('market-hours realism', () => {
  const CLOSED = et(2026, 7, 18, 12, 0) // Saturday
  const PREMARKET = et(2026, 7, 13, 9, 0) // Monday, before the bell
  const OPEN = et(2026, 7, 13, 9, 31)

  it('fills instantly when the setting is OFF, even with the market shut', () => {
    // PINNED (test_setting_off_fills_instantly_when_closed): the default
    // behaviour must be unchanged by the realism setting existing at all.
    const w = world({ AAPL: PRICE })
    w.state.t = CLOSED
    const a = acct()
    const r = placeOrder(a, w.view, { symbol: 'AAPL', side: 'buy', type: 'market', mode: 'shares', qty: 1 })
    expect(r.ok && r.outcome).toBe('filled')
    expect(a.positions.AAPL.qty).toBe(1)
  })

  it('queues a market order when the setting is ON and fills it after the bell', () => {
    // PINNED (test_setting_on_queues_market_order_when_closed), all four beats.
    const w = world({ AAPL: PRICE })
    w.state.t = PREMARKET
    const a = acct()
    a.settings.marketHoursOnly = true
    a.lastStepAt = PREMARKET

    const r = placeOrder(a, w.view, { symbol: 'AAPL', side: 'buy', type: 'market', mode: 'shares', qty: 1 })
    expect(r.ok && r.outcome).toBe('queued')
    expect(a.positions.AAPL).toBeUndefined()
    expect(a.orders[a.orders.length - 1].status).toBe('open')
    expect(a.orders[a.orders.length - 1].type).toBe('market')

    // Nothing fills while the market stays closed.
    w.state.t = PREMARKET + 20 * 60_000
    const out: BrokerEvent[] = []
    step(a, w.view, out)
    expect(out.filter((e) => e.type === 'fill')).toHaveLength(0)
    expect(a.orders[a.orders.length - 1].status).toBe('open')

    // ...and it fills on the first evaluation after the open.
    w.state.t = OPEN
    step(a, w.view, out)
    expect(a.orders[a.orders.length - 1].status).toBe('filled')
    expect(a.positions.AAPL.qty).toBe(1)
  })

  it('fills crypto at any hour even with the setting ON', () => {
    // PINNED (test_setting_on_crypto_fills_anytime): 24/7 instruments are exempt.
    const w = world({ 'BTC-USD': 30_000 })
    w.state.t = CLOSED
    const a = acct()
    a.settings.marketHoursOnly = true
    const r = placeOrder(a, w.view, { symbol: 'BTC-USD', side: 'buy', type: 'market', mode: 'shares', qty: 0.1 })
    expect(r.ok && r.outcome).toBe('filled')
  })

  it('warns on the preview that the order will be queued', () => {
    // paper.py's `queued_open`, as a machine code the UI can translate.
    const w = world({ AAPL: PRICE })
    w.state.t = CLOSED
    const a = acct()
    a.settings.marketHoursOnly = true
    const p = previewOrder(a, w.view, { symbol: 'AAPL', side: 'buy', type: 'market', mode: 'shares', qty: 1 })
    if ('error' in p) throw new Error('unexpected error')
    expect(p.warnings).toContain('market-closed')
  })

  it('freezes trailing peaks while the session is closed', () => {
    // paper.py's subtle half: with the setting on, a closed market means the
    // trail does not move either — otherwise a weekend gap would trail the stop
    // against a price nobody could have traded at.
    const w = world({ AAPL: 100 })
    w.state.t = CLOSED
    const a = acct()
    a.settings.marketHoursOnly = true
    a.lastStepAt = CLOSED
    placeOrder(a, w.view, { symbol: 'AAPL', side: 'sell', type: 'trailing', mode: 'shares', qty: 1, trail: 10 })
    w.state.prices.AAPL = 200
    w.state.t = CLOSED + 60_000
    step(a, w.view, [])
    expect(a.orders[0].peak).toBe(100) // seeded at placement, never ratcheted
  })
})

// ── Beyond the port ──────────────────────────────────────────────────────────

describe('errors are machine codes', () => {
  it('never returns prose', () => {
    // paper.py raises English straight into the UI. This app ships EN and TH, so
    // every failure has to arrive as a key the React layer can translate.
    const w = world({ ENGS: PRICE })
    const a = acct({ cash: 1 })
    const cases: OrderRequest[] = [
      { symbol: '', side: 'buy', type: 'market', mode: 'shares', qty: 1 },
      { symbol: 'NOPE', side: 'buy', type: 'market', mode: 'shares', qty: 1 },
      { symbol: 'ENGS', side: 'buy', type: 'market', mode: 'shares', qty: 0 },
      { symbol: 'ENGS', side: 'buy', type: 'market', mode: 'shares', qty: 1000 },
      { symbol: 'ENGS', side: 'buy', type: 'limit', mode: 'shares', qty: 1 },
      { symbol: 'ENGS', side: 'buy', type: 'stop', mode: 'shares', qty: 1 },
      { symbol: 'ENGS', side: 'buy', type: 'trailing', mode: 'shares', qty: 1 },
    ]
    const codes = cases.map((r) => {
      const res = placeOrder(a, w.view, r)
      if (res.ok) throw new Error(`expected a rejection for ${JSON.stringify(r)}`)
      return res.error.code
    })
    expect(codes).toEqual([
      'no-symbol',
      'unknown-instrument',
      'bad-qty',
      'insufficient-funds',
      'missing-limit',
      'missing-stop',
      'missing-trail',
    ])
    // Machine-readable by construction: lower-case, hyphenated, no spaces.
    for (const c of codes) expect(c).toMatch(/^[a-z][a-z-]*[a-z]$/)
  })

  it('blocks opening orders while a margin deficit is outstanding', () => {
    const w = world({ ENGS: PRICE })
    const a = acct({ marginDeficit: 50 })
    hold(a, 'ENGS', 10)
    const opening = placeOrder(a, w.view, { symbol: 'ENGS', side: 'buy', type: 'market', mode: 'shares', qty: 1 })
    expect(opening.ok).toBe(false)
    // Closing is still allowed — that is how the user cures it.
    const closing = sell(a, w.view, 'ENGS', 10)
    expect(closing.ok).toBe(true)
  })

  it('refuses a reduce-only order that would open exposure', () => {
    const w = world({ ENGS: PRICE })
    const a = acct()
    hold(a, 'ENGS', 10)
    const r = placeOrder(a, w.view, { symbol: 'ENGS', side: 'sell', type: 'market', mode: 'shares', qty: 20, reduceOnly: true })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('reduce-only-would-open')
  })

  it('refuses leverage above the account or venue cap', () => {
    const w = world({ BTC: 100 }, { BTC: perp('BTC') })
    const a = acct()
    const r = placeOrder(a, w.view, { symbol: 'BTC', side: 'buy', type: 'market', mode: 'shares', qty: 1, leverage: 50 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('exceeds-leverage')
  })

  it('refuses to trade an already-expired option', () => {
    const contract: Instrument = {
      kind: 'option',
      symbol: 'X|2026-07-06|call|100',
      underlying: 'X',
      expiry: 1000,
      right: 'call',
      strike: 100,
      multiplier: 100,
      tickSize: 0.01,
      pricePrecision: 2,
    }
    const w = world({ [contract.symbol]: 5 }, { [contract.symbol]: contract })
    w.state.t = 2000
    const a = acct()
    const r = placeOrder(a, w.view, { symbol: contract.symbol, side: 'buy', type: 'market', mode: 'shares', qty: 1 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('option-expired')
  })
})

describe('cash movements are never P/L', () => {
  it('raises cash AND contributed on a deposit', () => {
    const w = world({})
    const a = acct()
    const r = deposit(a, w.view, 500)
    expect(r.ok).toBe(true)
    expect(a.cash).toBe(100_500)
    expect(a.contributed).toBe(100_500)
    // Equity minus contributed — the P/L — is unchanged by the movement.
    expect(a.cash - a.contributed).toBe(0)
  })

  it('lowers both on a withdrawal', () => {
    const w = world({})
    const a = acct()
    withdraw(a, w.view, 500)
    expect(a.cash).toBe(99_500)
    expect(a.contributed).toBe(99_500)
  })

  it('only lets free cash out, never a position', () => {
    const w = world({ ENGS: PRICE })
    const a = acct({ cash: 100 })
    hold(a, 'ENGS', 10_000)
    const r = withdraw(a, w.view, 500)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('insufficient-funds')
    expect(a.positions.ENGS.qty).toBe(10_000)
  })

  it('rejects a non-positive amount by code', () => {
    const w = world({})
    const a = acct()
    for (const bad of [0, -1, NaN]) {
      const r = deposit(a, w.view, bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('bad-amount')
    }
  })

  it('books a blotter row for the movement', () => {
    const w = world({})
    const a = acct()
    const r = deposit(a, w.view, 500)
    if (!r.ok || r.outcome !== 'filled') throw new Error('unexpected')
    expect(r.trade.side).toBe('deposit')
    expect(r.trade.value).toBe(500)
    expect(r.trade.realized).toBe(0)
    // The synthetic order that satisfies PlaceResult's shape must NOT pollute
    // the user's order history.
    expect(a.orders).toHaveLength(0)
  })

  it('cures a margin deficit', () => {
    const w = world({})
    const a = acct({ marginDeficit: 300 })
    deposit(a, w.view, 500)
    expect(a.marginDeficit).toBe(0)
  })
})

describe('cancelOrder', () => {
  it('cancels an open order once and only once', () => {
    const w = world({ ENGS: PRICE })
    const a = acct()
    const r = placeOrder(a, w.view, { symbol: 'ENGS', side: 'buy', type: 'limit', mode: 'shares', qty: 1, limit: 1 })
    if (!r.ok) throw new Error('unexpected')
    expect(cancelOrder(a, r.order.id)).toBe(true)
    expect(a.orders[0].status).toBe('cancelled')
    expect(cancelOrder(a, r.order.id)).toBe(false)
  })
})

describe('step — the trigger cycle', () => {
  it('fills a limit order when the price crosses it', () => {
    const w = world({ ENGS: 3 })
    const a = acct({ lastStepAt: 1000 })
    placeOrder(a, w.view, { symbol: 'ENGS', side: 'buy', type: 'limit', mode: 'shares', qty: 10, limit: 2.5 })

    w.state.t = 2000
    const out: BrokerEvent[] = []
    step(a, w.view, out)
    expect(a.orders[0].status).toBe('open') // 3 has not crossed 2.5

    w.state.prices.ENGS = 2.4
    w.state.t = 3000
    step(a, w.view, out)
    expect(a.orders[0].status).toBe('filled')
    // Filled at the price that crossed it, not at the limit — paper.py's
    // behaviour, and strictly better for the user.
    expect(a.orders[0].fillPrice).toBe(2.4)
    expect(a.positions.ENGS.qty).toBe(10)
  })

  it('cancels a triggered order it can no longer fund, with the reason', () => {
    const w = world({ ENGS: 3 })
    const a = acct({ cash: 5, lastStepAt: 1000 })
    placeOrder(a, w.view, { symbol: 'ENGS', side: 'buy', type: 'limit', mode: 'shares', qty: 10, limit: 3 })
    w.state.t = 2000
    const out: BrokerEvent[] = []
    step(a, w.view, out)
    expect(a.orders[0].status).toBe('cancelled')
    expect(a.orders[0].note).toBe('insufficient-funds')
    const cancelled = out.find((e) => e.type === 'order-cancelled')
    expect(cancelled?.reason).toBe('insufficient-funds')
  })

  it('expires a day order when the session it was placed in ends', () => {
    const w = world({ AAPL: 100 })
    w.state.t = et(2026, 7, 13, 15, 0)
    const a = acct({ lastStepAt: et(2026, 7, 13, 15, 0) })
    placeOrder(a, w.view, { symbol: 'AAPL', side: 'buy', type: 'limit', mode: 'shares', qty: 1, limit: 1, tif: 'day' })
    w.state.t = et(2026, 7, 14, 10, 0)
    a.lastStepAt = et(2026, 7, 14, 9, 59) // skip the overnight catch-up
    step(a, w.view, [])
    expect(a.orders[0].status).toBe('expired')
  })

  it('syncs rather than replaying when the clock jumps forward from nothing', () => {
    // A restored snapshot must not fire every stop the price crossed while the
    // app was shut.
    const w = world({ ENGS: 3 })
    const a = acct({ lastStepAt: 0 })
    w.state.t = 500_000
    step(a, w.view, [])
    expect(a.lastStepAt).toBe(500_000)
  })

  it('banks the sub-second residual instead of rounding it away', () => {
    const w = world({ ENGS: 3 })
    const a = acct({ lastStepAt: 1000 })
    w.state.t = 1750
    step(a, w.view, [])
    expect(a.lastStepAt).toBe(1000) // not enough elapsed for a step
    w.state.t = 2400
    step(a, w.view, [])
    expect(a.lastStepAt).toBe(2000) // one step, residual 400ms kept
  })
})

describe('step — funding', () => {
  it('charges a long once per interval and credits the short', () => {
    const w = world({ BTC: 100 }, { BTC: perp('BTC') })
    const a = acct({ cash: 1000, lastFundingAt: T0, lastStepAt: T0 })
    a.settings.fundingIntervalMs = 60_000
    a.positions.BTC = { symbol: 'BTC', kind: 'perp', qty: 1, avgCost: 100, mark: 100, openedAt: 0, leverage: 10, margin: 10 }

    w.state.t = T0 + 180_000
    const out: BrokerEvent[] = []
    step(a, w.view, out)
    const funding = out.filter((e) => e.type === 'funding')
    expect(funding).toHaveLength(3) // exactly one per elapsed interval
    expect(a.cash).toBeLessThan(1000) // mark == index, so only the interest leg
    expect(a.positions.BTC.fundingPaid).toBeCloseTo(1000 - a.cash, 9)
  })
})

describe('step — option expiry seam', () => {
  const contract: Instrument = {
    kind: 'option',
    symbol: 'X|2026-07-06|call|100',
    underlying: 'X',
    expiry: 10_000,
    right: 'call',
    strike: 100,
    multiplier: 100,
    tickSize: 0.01,
    pricePrecision: 2,
  }

  function expiring() {
    const w = world({ [contract.symbol]: 5, X: 120 }, { [contract.symbol]: contract })
    const a = acct({ lastStepAt: 8000 })
    a.positions[contract.symbol] = {
      symbol: contract.symbol,
      kind: 'option',
      qty: 1,
      avgCost: 5,
      mark: 5,
      openedAt: 0,
      expiry: 10_000,
      right: 'call',
      strike: 100,
      multiplier: 100,
      underlying: 'X',
    }
    return { w, a }
  }

  it('emits ONE event on the step that crosses expiry when no settler is wired', () => {
    // The seam: step() owns the timing, options/expiry.ts owns the math. Without
    // the settler the position stays put and the gap is announced once — not
    // once a second, which is what a naive `expiry <= now` check would do.
    const { w, a } = expiring()
    w.state.t = 30_000
    const out: BrokerEvent[] = []
    step(a, w.view, out)
    expect(out.filter((e) => e.type === 'expiry')).toHaveLength(1)
    expect(a.positions[contract.symbol]).toBeDefined()
  })

  it('applies the injected settler and removes the position', () => {
    const { w, a } = expiring()
    w.state.t = 12_000
    const out: BrokerEvent[] = []
    const cashBefore = a.cash
    step(a, w.view, out, {
      settle: (positions) =>
        positions.map((p) => ({
          symbol: p.symbol,
          qty: p.qty,
          settlementPrice: 120,
          intrinsic: 20,
          cash: 20 * 100,
          realized: 20 * 100 - p.avgCost * 100,
          exercised: true,
          assigned: false,
        })),
    })
    expect(a.positions[contract.symbol]).toBeUndefined()
    expect(a.cash).toBe(cashBefore + 2000)
    expect(a.realized).toBe(1500)
    const settlement = out.find((e) => e.type === 'fill' && e.trade.side === 'settlement')
    expect(settlement).toBeDefined()
  })

  it('records a margin deficit when an assignment drives cash negative', () => {
    // C.6: this CAN go negative, and that is real. Opening orders are blocked
    // until it is cured.
    const { w, a } = expiring()
    a.cash = 100
    w.state.t = 12_000
    step(a, w.view, [], {
      settle: (positions) =>
        positions.map((p) => ({
          symbol: p.symbol,
          qty: p.qty,
          settlementPrice: 120,
          intrinsic: 20,
          cash: -5000,
          realized: -5000,
          exercised: false,
          assigned: true,
        })),
    })
    expect(a.cash).toBeLessThan(0)
    expect(a.marginDeficit).toBeCloseTo(4900, 9)
  })
})

describe('step — liquidation', () => {
  it('force-closes a perp that has fallen through its liquidation price', () => {
    const w = world({ BTC: 100 }, { BTC: perp('BTC') })
    const a = acct({ cash: 10, lastStepAt: T0, lastFundingAt: T0 })
    a.settings.liquidationFeeBps = 0
    a.positions.BTC = { symbol: 'BTC', kind: 'perp', qty: 1, avgCost: 100, mark: 100, openedAt: 0, leverage: 10, margin: 10 }

    w.state.prices.BTC = 89 // below 90.909…
    w.state.t = T0 + 1000
    const out: BrokerEvent[] = []
    step(a, w.view, out, { tiers: FLAT_1PCT })

    expect(a.positions.BTC).toBeUndefined()
    expect(out.some((e) => e.type === 'liquidation')).toBe(true)
    expect(a.cash).toBeGreaterThanOrEqual(0)
  })

  it('leaves a healthy perp alone', () => {
    const w = world({ BTC: 100 }, { BTC: perp('BTC') })
    const a = acct({ cash: 10, lastStepAt: T0, lastFundingAt: T0 })
    a.positions.BTC = { symbol: 'BTC', kind: 'perp', qty: 1, avgCost: 100, mark: 100, openedAt: 0, leverage: 10, margin: 10 }
    w.state.prices.BTC = 99
    w.state.t = T0 + 1000
    const out: BrokerEvent[] = []
    step(a, w.view, out, { tiers: FLAT_1PCT })
    expect(a.positions.BTC).toBeDefined()
    expect(out.some((e) => e.type === 'liquidation')).toBe(false)
  })
})

describe('step — live and fast-forward are the same code path', () => {
  /**
   * A hand-built account, so the two runs start byte-identical: placeOrder would
   * mint random order ids and the comparison would be meaningless.
   */
  function scenario() {
    const w = world({ BTC: 100 }, { BTC: perp('BTC') })
    const orders: Order[] = [
      { id: 'o1', seq: 1, accountId: 'a', symbol: 'BTC', kind: 'perp', side: 'sell', type: 'trailing', qty: 1, status: 'open', createdAt: 0, trail: 20, peak: 100, tif: 'gtc', leverage: 10 },
      { id: 'o2', seq: 2, accountId: 'a', symbol: 'BTC', kind: 'perp', side: 'buy', type: 'limit', qty: 1, status: 'open', createdAt: 0, limit: 100, tif: 'gtc', leverage: 10 },
      { id: 'o3', seq: 3, accountId: 'a', symbol: 'BTC', kind: 'perp', side: 'buy', type: 'stop', qty: 1, status: 'open', createdAt: 0, stop: 200, tif: 'gtc', leverage: 10 },
    ]
    const a = acct({
      cash: 1000,
      lastStepAt: T0,
      lastFundingAt: T0,
      orders,
      positions: {
        BTC: { symbol: 'BTC', kind: 'perp', qty: 1, avgCost: 100, mark: 100, openedAt: 0, leverage: 10, margin: 10 },
      },
    })
    a.settings.fundingIntervalMs = 60_000
    return { w, a }
  }

  /** Trade ids are uuids by design — they are not part of the simulation. */
  const comparable = (events: BrokerEvent[]) =>
    JSON.stringify(events, (k, v) => (k === 'id' ? undefined : v))

  it('produces identical fills, funding and equity samples either way', () => {
    // The one guarantee that makes catch-up trustworthy: a day fast-forwarded in
    // 200ms must give exactly the fills a day watched live would have given.
    const SPAN = 1_000_000 // 1000 sim-seconds

    const oneShot = scenario()
    const bulkEvents: BrokerEvent[] = []
    oneShot.w.state.t = T0 + SPAN
    step(oneShot.a, oneShot.w.view, bulkEvents, { tiers: FLAT_1PCT })

    const live = scenario()
    const liveEvents: BrokerEvent[] = []
    for (let i = 1; i <= 1000; i++) {
      live.w.state.t = T0 + i * 1000
      step(live.a, live.w.view, liveEvents, { tiers: FLAT_1PCT })
    }

    expect(comparable(liveEvents)).toBe(comparable(bulkEvents))
    expect(JSON.stringify(live.a)).toBe(JSON.stringify(oneShot.a))
    expect(live.a.lastStepAt).toBe(T0 + SPAN)
    // And it actually did something worth comparing.
    expect(bulkEvents.filter((e) => e.type === 'funding').length).toBeGreaterThan(10)
    expect(bulkEvents.some((e) => e.type === 'fill')).toBe(true)
  })

  it('is unaffected by ragged slicing', () => {
    const SPAN = 100_000
    const bulk = scenario()
    const bulkEvents: BrokerEvent[] = []
    bulk.w.state.t = T0 + SPAN
    step(bulk.a, bulk.w.view, bulkEvents, { tiers: FLAT_1PCT })

    const ragged = scenario()
    const raggedEvents: BrokerEvent[] = []
    // Deliberately not on second boundaries: the residual has to carry.
    for (let t = 137; t <= SPAN; t += 137) {
      ragged.w.state.t = T0 + t
      step(ragged.a, ragged.w.view, raggedEvents, { tiers: FLAT_1PCT })
    }
    ragged.w.state.t = T0 + SPAN
    step(ragged.a, ragged.w.view, raggedEvents, { tiers: FLAT_1PCT })

    expect(comparable(raggedEvents)).toBe(comparable(bulkEvents))
    expect(JSON.stringify(ragged.a)).toBe(JSON.stringify(bulk.a))
  })
})
