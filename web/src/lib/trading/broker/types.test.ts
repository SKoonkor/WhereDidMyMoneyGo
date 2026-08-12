import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, instMult, posMark, tradeError, type Position } from './types'
import { OPTION_MULT } from '../types'
import type { Instrument } from '../types'

const spot: Instrument = {
  kind: 'spot',
  symbol: 'AAPL',
  base: 'AAPL',
  quote: 'USD',
  tickSize: 0.01,
  lotSize: 0,
  pricePrecision: 2,
  qtyPrecision: 8,
}

const contract: Instrument = {
  kind: 'option',
  symbol: 'AAPL|2026-07-06|call|300',
  underlying: 'AAPL',
  expiry: 0,
  right: 'call',
  strike: 300,
  multiplier: 100,
  tickSize: 0.01,
  pricePrecision: 2,
}

const position = (over: Partial<Position> = {}): Position => ({
  symbol: 'AAPL',
  kind: 'spot',
  qty: 1,
  avgCost: 100,
  mark: 110,
  openedAt: 0,
  ...over,
})

describe('instMult', () => {
  it('is 1 for anything that trades one-for-one', () => {
    expect(instMult(spot)).toBe(1)
    expect(instMult(position({ kind: 'perp' }))).toBe(1)
  })

  it('is the contract size for an option', () => {
    expect(instMult(contract)).toBe(100)
    expect(instMult(position({ kind: 'option', multiplier: 50 }))).toBe(50)
  })

  it('falls back to OPTION_MULT for a position saved before multiplier existed', () => {
    // Restored accounts predate the field; reading 0 here would value every old
    // option contract at nothing.
    expect(instMult(position({ kind: 'option', multiplier: undefined }))).toBe(OPTION_MULT)
  })
})

describe('posMark', () => {
  it('prefers the live mark', () => {
    expect(posMark(position())).toBe(110)
  })

  it('falls back to cost so an unpriced position reads as flat, not free', () => {
    expect(posMark(position({ mark: 0 }))).toBe(100)
  })

  it('is 0 only when there is nothing to go on', () => {
    expect(posMark(position({ mark: 0, avgCost: 0 }))).toBe(0)
  })
})

describe('tradeError', () => {
  it('omits vars entirely when there are none, so errors compare by value', () => {
    expect(tradeError('bad-qty')).toEqual({ code: 'bad-qty' })
  })

  it('carries the numbers the translated sentence interpolates', () => {
    expect(tradeError('insufficient-funds', { need: 100, have: 5 })).toEqual({
      code: 'insufficient-funds',
      vars: { need: 100, have: 5 },
    })
  })
})

describe('DEFAULT_SETTINGS', () => {
  it('opens with the market-hours realism OFF, as paper.py did', () => {
    // `test_setting_off_fills_instantly_when_closed` pins that the default
    // behaviour is unchanged by the setting existing.
    expect(DEFAULT_SETTINGS.marketHoursOnly).toBe(false)
  })

  it('funds every 8 hours, the interval the funding rate is scaled to', () => {
    expect(DEFAULT_SETTINGS.fundingIntervalMs).toBe(8 * 3_600_000)
  })
})
