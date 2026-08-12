import { describe, expect, it } from 'vitest'
import {
  applyFill,
  checkFunds,
  instrumentLabel,
  marketOpenNow,
  optionSymbol,
  qtyFromSpec,
  sessionDay,
  snapQty,
  triggered,
} from './fills'
import { DEFAULT_SETTINGS, type BrokerAccount, type Order, type Position } from './types'
import type { Instrument, OptionInstrument, SpotInstrument } from '../types'

// The reference price paper.py's own suite uses, kept so the ported cases can be
// compared line for line against tests/test_paper_orders.py.
const PRICE = 2.76

const spot = (symbol = 'ENGS'): SpotInstrument => ({
  kind: 'spot',
  symbol,
  base: symbol,
  quote: 'USD',
  tickSize: 0.01,
  lotSize: 0,
  pricePrecision: 2,
  qtyPrecision: 8,
})

const option = (): OptionInstrument => ({
  kind: 'option',
  symbol: 'AAPL|2026-07-06|call|302.5',
  underlying: 'AAPL',
  expiry: Date.UTC(2026, 6, 6, 20, 0),
  right: 'call',
  strike: 302.5,
  multiplier: 100,
  tickSize: 0.01,
  pricePrecision: 2,
})

const held = (qty: number, avgCost = PRICE, over: Partial<Position> = {}): Position => ({
  symbol: 'ENGS',
  kind: 'spot',
  qty,
  avgCost,
  mark: PRICE,
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

const order = (over: Partial<Order> = {}): Order => ({
  id: '1-abcdef',
  seq: 1,
  accountId: 'a',
  symbol: 'ENGS',
  kind: 'spot',
  side: 'buy',
  type: 'market',
  qty: 1,
  status: 'open',
  createdAt: 0,
  tif: 'gtc',
  ...over,
})

/** ET wall time as an instant. July is EDT, so ET = UTC−4. */
const et = (y: number, mo: number, d: number, hh: number, mm = 0) => Date.UTC(y, mo - 1, d, hh + 4, mm)

describe('applyFill — opening and averaging', () => {
  it('pays cash on a buy and receives it on a sell', () => {
    const buy = applyFill(null, spot(), 'buy', 10, 100, 0)
    expect(buy.cashDelta).toBe(-1000)
    const sell = applyFill(null, spot(), 'sell', 10, 100, 0)
    expect(sell.cashDelta).toBe(1000)
  })

  it('weights the average cost over absolute quantities when adding to a long', () => {
    const first = applyFill(null, spot(), 'buy', 10, 100, 0).position!
    const second = applyFill(first, spot(), 'buy', 10, 120, 0).position!
    expect(second.qty).toBe(20)
    expect(second.avgCost).toBe(110)
  })

  it('gives a SHORT a positive average cost', () => {
    // paper.py averages over abs(old_qty), so the basis stays positive and the
    // sign flip lives in the realized formula instead. A negative basis here
    // would flip twice and invert every short's P/L.
    const r = applyFill(null, spot(), 'sell', 10, 100, 0)
    expect(r.position!.qty).toBe(-10)
    expect(r.position!.avgCost).toBe(100)
    const bigger = applyFill(r.position, spot(), 'sell', 10, 120, 0).position!
    expect(bigger.qty).toBe(-20)
    expect(bigger.avgCost).toBe(110)
  })

  it('multiplies an option fill by the contract multiplier', () => {
    const r = applyFill(null, option(), 'buy', 1, 5, 0)
    expect(r.cashDelta).toBe(-500)
  })
})

describe('applyFill — closing', () => {
  it('books realized on the closed quantity and leaves the basis alone', () => {
    const pos = held(10, 110)
    const r = applyFill(pos, spot(), 'sell', 5, 130, 0)
    expect(r.realized).toBeCloseTo(5 * (130 - 110), 10)
    expect(r.position!.qty).toBe(5)
    expect(r.position!.avgCost).toBe(110)
  })

  it('flips the sign of realized for a short', () => {
    const pos = held(-10, 100)
    const r = applyFill(pos, spot(), 'buy', 4, 90, 0)
    // Covering below the short's basis is a PROFIT.
    expect(r.realized).toBeCloseTo(4 * (90 - 100) * -1, 10)
    expect(r.position!.qty).toBe(-6)
  })

  it('scales an option close by the multiplier', () => {
    const pos: Position = { ...held(1, 5), kind: 'option', symbol: option().symbol, multiplier: 100 }
    const r = applyFill(pos, option(), 'sell', 1, 7, 0)
    expect(r.realized).toBeCloseTo((7 - 5) * 100, 10)
  })

  it('books P/L on the closed part of a FLIP and restarts the remainder at price', () => {
    // Sell 150 while long 100: the 100 closes, and the resulting -50 short must
    // start at 12 — blending 10 in would carry the closed trade's cost into a
    // position that has nothing to do with it.
    const r = applyFill(held(100, 10), spot(), 'sell', 150, 12, 0)
    expect(r.realized).toBeCloseTo(100 * (12 - 10), 10)
    expect(r.position!.qty).toBe(-50)
    expect(r.position!.avgCost).toBe(12)
  })

  it('deletes the position when the residual is sub-micro', () => {
    // PINNED (test_apply_fill_drops_sub_micro_residual): 10.0000005 − 10 leaves
    // 5e-7, which is float dust from a full close, not a position.
    const r = applyFill(held(10.0000005), spot(), 'sell', 10, PRICE, 0)
    expect(r.position).toBeNull()
  })

  it('keeps a residual that is merely small but real', () => {
    const r = applyFill(held(10.001), spot(), 'sell', 10, PRICE, 0)
    expect(r.position!.qty).toBeCloseTo(0.001, 12)
  })

  it('keeps the fee out of realized and out of cashDelta', () => {
    const r = applyFill(held(10, 100), spot(), 'sell', 10, 110, 7)
    expect(r.realized).toBeCloseTo(100, 10) // fee-free
    expect(r.cashDelta).toBe(1100) // fee-free
    expect(r.fee).toBe(7)
    // The caller applies cash += cashDelta − fee.
    expect(r.cashDelta - r.fee).toBe(1093)
  })

  it('carries broker bookkeeping across a fill', () => {
    const pos = held(10, 100, { kind: 'perp', leverage: 5, margin: 200, fundingPaid: 1.5 })
    const perp: Instrument = {
      kind: 'perp',
      symbol: 'ENGS',
      underlying: 'ENGS',
      tickSize: 0.01,
      lotSize: 0,
      pricePrecision: 2,
      qtyPrecision: 8,
      maxLeverage: 20,
      fundingIntervalMs: 28_800_000,
    }
    const r = applyFill(pos, perp, 'buy', 5, 100, 0)
    expect(r.position!.fundingPaid).toBe(1.5)
    expect(r.position!.leverage).toBe(5)
  })
})

describe('snapQty — the dust snap', () => {
  it('snaps a reducing sell that is a rounding hair short of the whole position', () => {
    // PINNED (test_dust_snap_sell_closes_position): a $-mode buy leaves
    // 12280.282631694204 held; the user types what the screen showed them.
    // The literal below is that same IEEE double written in the shortest form
    // that round-trips through JS — Python's source spelling ends ...204 and
    // parses to the identical bit pattern.
    expect(snapQty(12280.282631694205, 'sell', 12280.2826)).toBe(12280.282631694205)
  })

  it('snaps a reducing buy that covers a micro short', () => {
    // PINNED (test_dust_snap_buy_covers_micro_short).
    const heldQty = -3.534005778906818e-5
    expect(snapQty(heldQty, 'buy', 0.0001)).toBe(Math.abs(heldQty))
  })

  it('leaves a materially different quantity alone', () => {
    // PINNED (test_no_snap_on_material_difference): an intentional partial sell
    // must stay a partial sell.
    expect(snapQty(12280.28, 'sell', 12000)).toBe(12000)
  })

  it('never snaps an order that is not reducing', () => {
    // PINNED (test_no_snap_when_not_reducing): selling with no position is a
    // fresh short, and snapping it to |held| = 0 would drop the order entirely.
    expect(snapQty(0, 'sell', 5)).toBe(5)
    expect(snapQty(-10, 'sell', 10)).toBe(10) // adding to a short
    expect(snapQty(10, 'buy', 10)).toBe(10) // adding to a long
  })

  it('uses the absolute floor for a tiny position and the relative one for a large', () => {
    expect(snapQty(0.5, 'sell', 0.4995)).toBe(0.5) // within SNAP_ABS = 1e-3
    expect(snapQty(0.5, 'sell', 0.498)).toBe(0.498) // outside it
    expect(snapQty(1e6, 'sell', 999_995)).toBe(1e6) // within |held| * 1e-5
  })
})

describe('checkFunds', () => {
  it('rejects a buy that costs more than the cash', () => {
    const err = checkFunds(account({ cash: 100 }), spot(), 'buy', 2, 100)
    expect(err?.code).toBe('insufficient-funds')
  })

  it('allows spending exactly the cash on hand', () => {
    // The FUNDS_EPS exists so float error on a $-mode quantity cannot turn
    // "spend it all" into a rejection.
    expect(checkFunds(account({ cash: 100 }), spot(), 'buy', 1, 100)).toBeNull()
  })

  it('lets a broke account sell what it already holds', () => {
    const a = account({ cash: 0, positions: { ENGS: held(10, 100) } })
    expect(checkFunds(a, spot(), 'sell', 10, 100)).toBeNull()
  })

  it('demands collateral only for the part of a sell that opens a short', () => {
    const a = account({ cash: 500, positions: { ENGS: held(10, 100) } })
    // 5 beyond the long at 100 needs 500 — exactly what is there.
    expect(checkFunds(a, spot(), 'sell', 15, 100)).toBeNull()
    expect(checkFunds(a, spot(), 'sell', 16, 100)?.code).toBe('insufficient-collateral')
  })

  it('exempts perps, which are collateralised by margin rather than cash', () => {
    const perp: Instrument = {
      kind: 'perp',
      symbol: 'BTC',
      underlying: 'BTC',
      tickSize: 0.1,
      lotSize: 0,
      pricePrecision: 1,
      qtyPrecision: 3,
      maxLeverage: 20,
      fundingIntervalMs: 28_800_000,
    }
    expect(checkFunds(account({ cash: 10 }), perp, 'buy', 1, 100_000)).toBeNull()
  })
})

describe('qtyFromSpec', () => {
  it('keeps shares fractional and contracts whole', () => {
    expect(qtyFromSpec({ mode: 'shares', qty: 1.5 }, 100, 1)).toEqual({ qty: 1.5 })
    expect(qtyFromSpec({ mode: 'shares', qty: 1.9 }, 100, 100)).toEqual({ qty: 1 })
  })

  it('divides a dollar amount by price times multiplier', () => {
    expect(qtyFromSpec({ mode: 'dollars', qty: 1000 }, 2.5, 1)).toEqual({ qty: 400 })
    // Options truncate: rounding up would spend more than the user asked to.
    expect(qtyFromSpec({ mode: 'dollars', qty: 1400 }, 5, 100)).toEqual({ qty: 2 })
  })

  it('names the mode in the error so the UI blames the right field', () => {
    expect(qtyFromSpec({ mode: 'shares', qty: 0 }, 100, 1)).toEqual({ error: { code: 'bad-qty' } })
    expect(qtyFromSpec({ mode: 'dollars', qty: -5 }, 100, 1)).toEqual({ error: { code: 'bad-amount' } })
    expect(qtyFromSpec({ mode: 'shares', qty: NaN }, 100, 1)).toEqual({ error: { code: 'bad-qty' } })
  })
})

describe('triggered', () => {
  it('fills a queued market order on sight', () => {
    expect(triggered(order({ type: 'market' }), 1)).toBe(true)
  })

  it('crosses a limit from the right side', () => {
    expect(triggered(order({ type: 'limit', side: 'buy', limit: 100 }), 100)).toBe(true)
    expect(triggered(order({ type: 'limit', side: 'buy', limit: 100 }), 101)).toBe(false)
    expect(triggered(order({ type: 'limit', side: 'sell', limit: 100 }), 100)).toBe(true)
    expect(triggered(order({ type: 'limit', side: 'sell', limit: 100 }), 99)).toBe(false)
  })

  it('crosses a stop from the right side', () => {
    expect(triggered(order({ type: 'stop', side: 'sell', stop: 90 }), 90)).toBe(true)
    expect(triggered(order({ type: 'stop', side: 'sell', stop: 90 }), 91)).toBe(false)
    expect(triggered(order({ type: 'stop', side: 'buy', stop: 110 }), 110)).toBe(true)
  })

  it('RATCHETS the trailing peak on prices that do not trigger', () => {
    // PINNED, and the reason this function is not pure: the peak has to persist
    // between evaluations or the stop trails nothing. paper.py's process() even
    // records "changed" when only the peak moved.
    const o = order({ type: 'trailing', side: 'sell', trail: 10, peak: 100 })
    expect(triggered(o, 105)).toBe(false)
    expect(o.peak).toBe(105) // mutated by a NON-triggering price
    expect(triggered(o, 100)).toBe(false)
    expect(o.peak).toBe(105) // ratchets up only
    expect(triggered(o, 94.5)).toBe(true) // 105 * (1 − 0.10)
  })

  it('ratchets a trailing buy DOWN and triggers on the bounce', () => {
    const o = order({ type: 'trailing', side: 'buy', trail: 10, peak: 100 })
    expect(triggered(o, 80)).toBe(false)
    expect(o.peak).toBe(80)
    expect(triggered(o, 88)).toBe(true) // 80 * 1.10
  })

  it('seeds the peak from the first price it ever sees', () => {
    const o = order({ type: 'trailing', side: 'sell', trail: 5 })
    expect(triggered(o, 200)).toBe(false)
    expect(o.peak).toBe(200)
  })
})

describe('marketOpenNow', () => {
  it('follows the NYSE regular session', () => {
    // PINNED (test_market_open_now_sessions), instant for instant.
    expect(marketOpenNow('spot', 'AAPL', et(2026, 7, 16, 12, 0))).toBe(true) // Thu midday
    expect(marketOpenNow('spot', 'AAPL', et(2026, 7, 18, 12, 0))).toBe(false) // Saturday
    expect(marketOpenNow('spot', 'AAPL', et(2026, 7, 3, 12, 0))).toBe(false) // holiday
    expect(marketOpenNow('spot', 'AAPL', et(2026, 7, 16, 8, 0))).toBe(false) // pre-market
    expect(marketOpenNow('spot', 'AAPL', et(2026, 7, 16, 20, 0))).toBe(false) // after hours
  })

  it('opens ON the 09:30 bell and is closed ON the 16:00 bell', () => {
    // The half-open interval, pinned: 09:30 trades, 16:00 does not.
    expect(marketOpenNow('spot', 'AAPL', et(2026, 7, 16, 9, 30))).toBe(true)
    expect(marketOpenNow('spot', 'AAPL', et(2026, 7, 16, 9, 29))).toBe(false)
    expect(marketOpenNow('spot', 'AAPL', et(2026, 7, 16, 15, 59))).toBe(true)
    expect(marketOpenNow('spot', 'AAPL', et(2026, 7, 16, 16, 0))).toBe(false)
  })

  it('never closes for crypto', () => {
    // PINNED: 03:00 on a Saturday.
    const sat = et(2026, 7, 18, 3, 0)
    expect(marketOpenNow('perp', 'BTCUSDT', sat)).toBe(true)
    expect(marketOpenNow('spot', 'BTC-USD', sat)).toBe(true)
    expect(marketOpenNow('spot', 'ETHUSDT', sat)).toBe(true)
  })

  it('tracks the DST boundary rather than a fixed offset', () => {
    // 09:35 EST in January is 14:35 UTC; the same UTC instant in July is 10:35
    // ET, which is also open — so the test that means something is the winter
    // pre-market hour that a hardcoded −4 would call open.
    expect(marketOpenNow('spot', 'AAPL', Date.UTC(2026, 0, 15, 14, 35))).toBe(true) // 09:35 EST
    expect(marketOpenNow('spot', 'AAPL', Date.UTC(2026, 0, 15, 13, 35))).toBe(false) // 08:35 EST
  })
})

describe('naming', () => {
  it('labels an option contract the way paper.py did', () => {
    expect(instrumentLabel(option())).toBe('AAPL 2026-07-06 C302.5')
    expect(instrumentLabel(spot('AAPL'))).toBe('AAPL')
  })

  it('builds a stable contract key', () => {
    expect(optionSymbol('btc', Date.UTC(2026, 7, 14, 8), 'call', 65000)).toBe('BTC|2026-08-14|call|65000')
  })

  it('keys a day order to the Eastern session, not the UTC date', () => {
    // 15:00 ET Monday is 19:00 UTC Monday — same day either way. 20:00 ET is
    // Tuesday in UTC, and a UTC key would expire a live order overnight.
    expect(sessionDay(et(2026, 7, 13, 15, 0))).toBe('2026-07-13')
    expect(sessionDay(et(2026, 7, 13, 21, 0))).toBe('2026-07-13')
  })
})
