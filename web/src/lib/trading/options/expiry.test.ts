import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ITM_THRESHOLD, SETTLEMENT_TWAP_MS, settleExpiries, twapFromCandles,
  type SettleablePosition,
} from './expiry'
import type { Candle } from '../types'

const MIN = 60_000
const EXPIRY = Date.parse('2026-08-14T08:00:00.000Z')
const MULT = 100

/** 1m bars stamped by OPEN time, newest last — the aggregator's convention. */
function bars(closes: number[], lastOpen: number = EXPIRY - MIN): Candle[] {
  return closes.map((c, i) => {
    const t = lastOpen - (closes.length - 1 - i) * MIN
    return { t, o: c, h: c, l: c, c, v: 1, n: 1 }
  })
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

const pos = (o: Partial<SettleablePosition> = {}): SettleablePosition => ({
  symbol: 'BTC|2026-08-14|call|100',
  qty: 1,
  avgCost: 12,
  expiry: EXPIRY,
  right: 'call',
  strike: 100,
  multiplier: MULT,
  underlying: 'BTC',
  ...o,
})

/** Settle against one fixed price for every underlying. */
const fixed = (p: number | undefined) => () => p

describe('twapFromCandles', () => {
  it('averages exactly the thirty one-minute closes ending at expiry', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i)
    expect(twapFromCandles(bars(closes), EXPIRY)).toBeCloseTo(mean(closes.slice(30)), 12)
  })

  it('window is exactly thirty minutes wide', () => {
    expect(SETTLEMENT_TWAP_MS).toBe(30 * MIN)
    // The 31st bar back closes precisely on the window's opening edge, which is
    // outside it. Off by one here silently changes every settlement price.
    const closes = [999, ...Array.from({ length: 30 }, () => 100)]
    expect(twapFromCandles(bars(closes), EXPIRY)).toBe(100)
  })

  it('ignores the bar that is still forming at the bell', () => {
    // Bars are stamped by OPEN time, so a bar opening at the expiry minute has
    // not closed yet. Including it would settle on a price that had not happened.
    const settled = bars(Array.from({ length: 30 }, () => 100))
    const forming: Candle = { t: EXPIRY, o: 5000, h: 5000, l: 5000, c: 5000, v: 1, n: 1 }
    expect(twapFromCandles([...settled, forming], EXPIRY)).toBe(100)
  })

  it('is gameable-proof: one spike moves it by a thirtieth, not by all of it', () => {
    // This is the whole reason settlement is not the last print. Pausing the sim
    // on a favourable tick must not hand the user that tick as the settlement.
    const flat = Array.from({ length: 30 }, () => 100)
    const spiked = [...flat.slice(0, 29), 400]
    expect(twapFromCandles(bars(spiked), EXPIRY)).toBeCloseTo(110, 9)
  })

  it('tolerates a short history rather than refusing to settle', () => {
    // A contract can expire in the first minutes of a fresh sandbox, and leaving
    // it unsettled would strand the position forever.
    expect(twapFromCandles(bars([100, 110, 120]), EXPIRY)).toBeCloseTo(110, 12)
    expect(twapFromCandles(bars([100]), EXPIRY)).toBe(100)
  })

  it('falls back to the last close when the window is empty but history exists', () => {
    // Stale bars, all older than 30 minutes: better the last known price than no
    // settlement at all.
    const stale = bars([100, 105, 108], EXPIRY - 5 * SETTLEMENT_TWAP_MS)
    expect(twapFromCandles(stale, EXPIRY)).toBe(108)
  })

  it('is undefined only when there is no history at all', () => {
    expect(twapFromCandles([], EXPIRY)).toBeUndefined()
    // Everything is in the future: nothing has closed by the bell.
    expect(twapFromCandles(bars([100, 101], EXPIRY + 10 * MIN), EXPIRY)).toBeUndefined()
  })

  it('does not care what order the bars arrive in', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i)
    const forward = twapFromCandles(bars(closes), EXPIRY)
    const reversed = twapFromCandles([...bars(closes)].reverse(), EXPIRY)
    expect(reversed).toBe(forward)
  })
})

describe('settleExpiries — what it leaves alone', () => {
  it('ignores an option that has not expired', () => {
    expect(settleExpiries([pos()], fixed(130), EXPIRY - 1)).toEqual([])
    expect(settleExpiries([pos()], fixed(130), EXPIRY)).toHaveLength(1)
  })

  it('ignores spot and perp rows in the same book', () => {
    // The caller hands over its WHOLE book; filtering is this function's job.
    const book: SettleablePosition[] = [
      { symbol: 'BTC', qty: 3, avgCost: 60_000 },
      { symbol: 'BTC-PERP', qty: -2, avgCost: 61_000, underlying: 'BTC' },
      pos(),
    ]
    const out = settleExpiries(book, fixed(130), EXPIRY)
    expect(out.map((o) => o.symbol)).toEqual(['BTC|2026-08-14|call|100'])
  })

  it('ignores a dust residual left by a full close', () => {
    expect(settleExpiries([pos({ qty: 1e-9 })], fixed(130), EXPIRY)).toEqual([])
    expect(settleExpiries([pos({ qty: 0 })], fixed(130), EXPIRY)).toEqual([])
  })

  it('skips a position whose underlying has no settlement price yet', () => {
    // Returning nothing lets the caller retry on the next step rather than
    // settling against a made-up price.
    expect(settleExpiries([pos()], fixed(undefined), EXPIRY)).toEqual([])
    expect(settleExpiries([pos()], fixed(NaN), EXPIRY)).toEqual([])
  })

  it('looks the settlement price up by underlying, not by contract symbol', () => {
    const prices = new Map([['BTC', 130], ['ETH', 55]])
    const out = settleExpiries(
      [pos(), pos({ symbol: 'ETH-C', underlying: 'ETH', strike: 50 })],
      (u) => prices.get(u),
      EXPIRY,
    )
    expect(out.map((o) => o.settlementPrice)).toEqual([130, 55])
  })
})

describe('settleExpiries — cash settlement', () => {
  it('credits a long ITM call qty * intrinsic * multiplier', () => {
    const [o] = settleExpiries([pos({ qty: 2 })], fixed(130), EXPIRY)
    expect(o.settlementPrice).toBe(130)
    expect(o.intrinsic).toBe(30)
    expect(o.cash).toBe(2 * 30 * MULT)
    expect(o.exercised).toBe(true)
    expect(o.assigned).toBe(false)
    // Premium paid was 2 * 12 * 100 = 2400.
    expect(o.realized).toBe(6000 - 2400)
  })

  it('debits a short ITM call and calls it an assignment', () => {
    const [o] = settleExpiries([pos({ qty: -3 })], fixed(130), EXPIRY)
    expect(o.cash).toBe(-3 * 30 * MULT)
    expect(o.assigned).toBe(true)
    expect(o.exercised).toBe(false)
    // Kept the 3600 premium, paid out 9000.
    expect(o.realized).toBe(-9000 + 3600)
  })

  it('lets a short assignment drive cash negative, because that is real', () => {
    // The single most important behaviour of a short option. Clamping it here
    // would hide the only risk short options exist to teach; the broker is the
    // one that records the deficit and blocks opening orders.
    const [o] = settleExpiries([pos({ qty: -10, avgCost: 1 })], fixed(500), EXPIRY)
    expect(o.cash).toBe(-10 * 400 * MULT)
    const cashAfter = 1_000 + o.cash
    expect(cashAfter).toBeLessThan(0)
  })

  it('uses K - S for a put', () => {
    const [o] = settleExpiries([pos({ right: 'put', qty: 2 })], fixed(70), EXPIRY)
    expect(o.intrinsic).toBe(30)
    expect(o.cash).toBe(2 * 30 * MULT)
    expect(o.exercised).toBe(true)
    // And a put is worthless above its strike.
    const [up] = settleExpiries([pos({ right: 'put', qty: 2 })], fixed(130), EXPIRY)
    expect(up.intrinsic).toBe(0)
    expect(up.cash).toBe(0)
  })

  it('books the whole premium as realized when a long expires worthless', () => {
    const [o] = settleExpiries([pos({ qty: 2 })], fixed(90), EXPIRY)
    expect(o.intrinsic).toBe(0)
    expect(o.cash).toBe(0)
    expect(o.exercised).toBe(false)
    expect(o.assigned).toBe(false)
    expect(o.realized).toBe(-2 * 12 * MULT)
  })

  it('books the whole premium as a gain when a short expires worthless', () => {
    const [o] = settleExpiries([pos({ qty: -2 })], fixed(90), EXPIRY)
    expect(o.cash).toBe(0)
    expect(o.realized).toBe(2 * 12 * MULT)
    expect(o.assigned).toBe(false)
  })

  it('keeps realized consistent with the blotter by construction', () => {
    // realized must always be cash minus the cost basis, whatever the sign of the
    // position or the moneyness. A matched pair of branches would eventually drift.
    for (const qty of [3, -3, 0.5, -0.5]) {
      for (const settle of [70, 99.999, 100, 100.005, 130]) {
        for (const right of ['call', 'put'] as const) {
          const [o] = settleExpiries([pos({ qty, right })], fixed(settle), EXPIRY)
          expect(o.realized, `${qty}/${settle}/${right}`)
            .toBeCloseTo(o.cash - qty * 12 * MULT, 9)
        }
      }
    }
  })

  it('honours the contract multiplier, defaulting to 100', () => {
    const [ten] = settleExpiries([pos({ multiplier: 10 })], fixed(130), EXPIRY)
    expect(ten.cash).toBe(30 * 10)
    const [dflt] = settleExpiries([pos({ multiplier: undefined })], fixed(130), EXPIRY)
    expect(dflt.cash).toBe(30 * 100)
  })

  it('settles every expired contract in the book, in order', () => {
    const out = settleExpiries(
      [pos({ symbol: 'A', qty: 1 }), pos({ symbol: 'B', qty: -1 }), pos({ symbol: 'C', right: 'put' })],
      fixed(130),
      EXPIRY + 5 * MIN,
    )
    expect(out.map((o) => o.symbol)).toEqual(['A', 'B', 'C'])
  })
})

describe('settleExpiries — the ITM threshold', () => {
  it('expires worthless when in the money by less than a hundredth', () => {
    // Without a threshold, a position 1e-7 in the money "exercises" for a cash
    // amount that rounds to zero and still flips the blotter row to Exercised.
    const [o] = settleExpiries([pos()], fixed(100 + DEFAULT_ITM_THRESHOLD / 2), EXPIRY)
    expect(o.exercised).toBe(false)
    expect(o.cash).toBe(0)
    expect(o.intrinsic).toBeGreaterThan(0)
  })

  it('exercises once past the threshold', () => {
    const [o] = settleExpiries([pos()], fixed(100 + DEFAULT_ITM_THRESHOLD * 2), EXPIRY)
    expect(o.exercised).toBe(true)
    expect(o.cash).toBeCloseTo(DEFAULT_ITM_THRESHOLD * 2 * MULT, 9)
  })

  it('takes a caller-supplied threshold', () => {
    expect(settleExpiries([pos()], fixed(104), EXPIRY, 5)[0].exercised).toBe(false)
    expect(settleExpiries([pos()], fixed(106), EXPIRY, 5)[0].exercised).toBe(true)
  })

  it('treats exactly at the money as worthless', () => {
    const [o] = settleExpiries([pos()], fixed(100), EXPIRY)
    expect(o.intrinsic).toBe(0)
    expect(o.exercised).toBe(false)
    expect(o.assigned).toBe(false)
  })
})

describe('settleExpiries — the structural seam with the broker', () => {
  it('accepts a broker-shaped Position without either module importing the other', () => {
    // This type is declared locally, exactly as broker/types.ts declares its own
    // Position. If it type-checks here, a real `readonly Position[]` does too —
    // which is the whole point of not importing across the seam.
    interface BrokerPosition {
      symbol: string
      qty: number
      avgCost: number
      markPrice: number
      unrealized: number
      realized: number
      expiry?: number
      right?: 'call' | 'put'
      strike?: number
      multiplier?: number
      underlying?: string
    }
    const book: readonly BrokerPosition[] = [
      {
        symbol: 'BTC|2026-08-14|call|100',
        qty: 2, avgCost: 12, markPrice: 30, unrealized: 3600, realized: 0,
        expiry: EXPIRY, right: 'call', strike: 100, multiplier: MULT, underlying: 'BTC',
      },
    ]
    const out = settleExpiries(book, fixed(130), EXPIRY)
    expect(out).toHaveLength(1)
    expect(out[0].cash).toBe(6000)
  })
})

describe('settlement end to end', () => {
  it('settles a long call at the TWAP, not at the last print', () => {
    // Thirty minutes averaging 100, then a final bar that spikes. A last-price
    // settlement would pay out on 400; the TWAP pays out on 110.
    const history = bars([...Array.from({ length: 29 }, () => 100), 400])
    const twap = twapFromCandles(history, EXPIRY)!
    expect(twap).toBeCloseTo(110, 9)
    const [o] = settleExpiries([pos({ qty: 1, strike: 100 })], () => twap, EXPIRY)
    expect(o.settlementPrice).toBeCloseTo(110, 9)
    expect(o.cash).toBeCloseTo(10 * MULT, 9)
  })

  it('is pure: it does not touch the positions it is given', () => {
    const p = pos({ qty: 2 })
    const before = { ...p }
    settleExpiries([p], fixed(130), EXPIRY)
    expect(p).toEqual(before)
  })
})
