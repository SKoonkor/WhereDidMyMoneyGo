import { describe, expect, it } from 'vitest'
import { atr, bollinger, ema, macd, rsi, sma, vwap, type Indicator } from './indicators'

const feed = (ind: { push(v: number): unknown }, xs: number[]) => {
  for (const x of xs) ind.push(x)
}

/** 1..n, the sequence whose moving averages can be checked by hand. */
const ramp = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i)

describe('sma', () => {
  it('is NaN until the window is full, then the mean of the window', () => {
    const s = sma(3, 64)
    expect(s.push(2)).toBeNaN()
    expect(s.push(4)).toBeNaN()
    expect(s.push(6)).toBeCloseTo(4, 12)
    expect(s.push(8)).toBeCloseTo(6, 12)
    expect(s.push(10)).toBeCloseTo(8, 12)
  })

  it('writes into the ring aligned to the series', () => {
    const s = sma(2, 4)
    feed(s, [1, 2, 3, 4, 5, 6])
    expect(s.count).toBe(6)
    expect(s.out[(6 - 1) % 4]).toBeCloseTo(5.5, 12)
    expect(s.last).toBeCloseTo(5.5, 12)
  })
})

describe('ema', () => {
  it('seeds on the simple average of the first period, then smooths at 2/(n+1)', () => {
    // Seeded with the first PRICE instead, the line leaves a visible hook at the
    // left edge that no charting package has.
    const e = ema(3, 64)
    feed(e, [1, 2])
    expect(e.last).toBeNaN()
    expect(e.push(3)).toBeCloseTo(2, 12) // (1+2+3)/3
    expect(e.push(7)).toBeCloseTo(2 + (7 - 2) * 0.5, 12) // k = 2/4
    expect(e.push(9)).toBeCloseTo(4.5 + (9 - 4.5) * 0.5, 12)
  })
})

describe('amend', () => {
  // The reason the method exists: the forming candle's close changes several
  // times a second, and a naive push per tick folds every intermediate price
  // into the average permanently.
  const finals = [11, 4, 19, 7]

  const drive = (make: () => Indicator) => {
    const naive = make()
    feed(naive, ramp(20))
    naive.push(finals[0])

    const amended = make()
    feed(amended, ramp(20))
    amended.push(99)
    amended.amend(1)
    amended.amend(58)
    amended.amend(finals[0])
    return { naive, amended }
  }

  for (const [name, make] of [
    ['sma', () => sma(5, 64)],
    ['ema', () => ema(5, 64)],
    ['rsi', () => rsi(5, 64)],
  ] as const) {
    it(`leaves ${name} exactly where a single push with the final value would`, () => {
      const { naive, amended } = drive(make)
      expect(amended.count).toBe(naive.count)
      expect(amended.last).toBeCloseTo(naive.last, 12)

      // And the state, not just the output: one more bar has to agree too, or
      // the corruption is merely deferred by a tick.
      expect(amended.push(23)).toBeCloseTo(naive.push(23), 12)
    })
  }

  it('behaves as a plain push when nothing has been pushed yet', () => {
    const a = sma(2, 8)
    a.amend(4)
    a.push(6)
    expect(a.last).toBeCloseTo(5, 12)
  })

  it('keeps macd, bollinger, vwap and atr honest the same way', () => {
    const naiveM = macd(3, 6, 3, 64)
    const amendM = macd(3, 6, 3, 64)
    for (const v of ramp(30)) {
      naiveM.push(v)
      amendM.push(v)
    }
    naiveM.push(17)
    amendM.push(100)
    amendM.amend(2)
    amendM.amend(17)
    const lastOf = (a: Float64Array, n: number) => a[(n - 1) % a.length]
    expect(lastOf(amendM.macd, amendM.count)).toBeCloseTo(lastOf(naiveM.macd, naiveM.count), 12)
    expect(lastOf(amendM.signal, amendM.count)).toBeCloseTo(lastOf(naiveM.signal, naiveM.count), 12)
    expect(lastOf(amendM.hist, amendM.count)).toBeCloseTo(lastOf(naiveM.hist, naiveM.count), 12)

    const naiveB = bollinger(5, 2, 64)
    const amendB = bollinger(5, 2, 64)
    for (const v of ramp(20)) {
      naiveB.push(v)
      amendB.push(v)
    }
    naiveB.push(9)
    amendB.push(40)
    amendB.amend(3)
    amendB.amend(9)
    expect(lastOf(amendB.up, amendB.count)).toBeCloseTo(lastOf(naiveB.up, naiveB.count), 12)
    expect(lastOf(amendB.lo, amendB.count)).toBeCloseTo(lastOf(naiveB.lo, naiveB.count), 12)

    const naiveV = vwap(64)
    const amendV = vwap(64)
    for (let i = 0; i < 10; i++) {
      naiveV.push(100 + i, 5, i === 0)
      amendV.push(100 + i, 5, i === 0)
    }
    expect(naiveV.push(140, 9, false)).toBeCloseTo(
      (amendV.push(999, 2, false), amendV.amend(140, 9, false)),
      12,
    )

    const naiveA = atr(5, 64)
    const amendA = atr(5, 64)
    for (let i = 0; i < 20; i++) {
      naiveA.push(10 + i, 8 + i, 9 + i)
      amendA.push(10 + i, 8 + i, 9 + i)
    }
    expect(naiveA.push(40, 20, 33)).toBeCloseTo(
      (amendA.push(99, 1, 50), amendA.amend(40, 20, 33)),
      12,
    )
  })

  it('survives a whole forming bar of amendments without drifting', () => {
    // 200 ticks on one bar is a normal minute at 4 ticks a second.
    const drifted = ema(10, 512)
    const clean = ema(10, 512)
    feed(drifted, ramp(50))
    feed(clean, ramp(50))
    drifted.push(0)
    for (let i = 0; i < 200; i++) drifted.amend(40 + Math.sin(i) * 3)
    drifted.amend(51)
    clean.push(51)
    expect(drifted.last).toBeCloseTo(clean.last, 12)
  })
})

describe('rsi', () => {
  it('reads 100 for a monotone rise', () => {
    // Zero average loss. Guarded, this is 100; unguarded it is a NaN that
    // silently blanks the whole sub-pane.
    const r = rsi(14, 64)
    feed(r, ramp(40))
    expect(r.last).toBe(100)
  })

  it('reads 0 for a monotone fall', () => {
    const r = rsi(14, 64)
    feed(r, ramp(40).reverse())
    expect(r.last).toBe(0)
  })

  it('matches Wilder on the classic worked example', () => {
    // Wilder's 14-period series (New Concepts, table 3.1), at the precision it
    // is published in. The first reading is the SEED — a simple average of the
    // 14 gains and the 14 losses — and only the readings after it use Wilder's
    // (prev*(n-1) + current)/n smoothing. Seeding with the smoother instead, or
    // with an EMA's 2/(n+1), lands near 70 but not on it.
    //
    // These closes must stay at four decimals: rounded to two they are a
    // different series and give 70.4641, which is arithmetic, not a bug.
    const closes = [
      44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245,
      45.8433, 46.0826, 45.8931, 46.0328, 45.6140, 46.2820, 46.2820,
    ]
    const r = rsi(14, 64)
    feed(r, closes)
    expect(r.last).toBeCloseTo(70.53, 2)
  })

  it('smooths after the seed rather than re-averaging the window', () => {
    // The bar after the seed: avgGain = (seedGain*13 + gain)/14. A second simple
    // average here would make the line an SMA of changes and lag visibly.
    const closes = [
      44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245,
      45.8433, 46.0826, 45.8931, 46.0328, 45.6140, 46.2820, 46.2820, 46.0028,
    ]
    const r = rsi(14, 64)
    feed(r, closes)
    expect(r.last).toBeCloseTo(66.32, 2)
  })

  it('sits at 50 when nothing moves at all', () => {
    const r = rsi(5, 64)
    feed(r, [3, 3, 3, 3, 3, 3, 3])
    expect(r.last).toBe(50)
  })
})

describe('macd', () => {
  it('is the fast EMA less the slow one, and the histogram their gap to signal', () => {
    const m = macd(3, 6, 3, 128)
    const fast = ema(3, 128)
    const slow = ema(6, 128)
    const xs = ramp(30)
    for (const v of xs) {
      m.push(v)
      fast.push(v)
      slow.push(v)
    }
    const i = (xs.length - 1) % 128
    expect(m.macd[i]).toBeCloseTo(fast.last - slow.last, 12)
    expect(m.hist[i]).toBeCloseTo(m.macd[i] - m.signal[i], 12)
  })

  it('never feeds the signal line before the macd line exists', () => {
    // One NaN into an EMA poisons it forever; a zero puts a fake crossover in
    // the first bars, which is worse because it looks like a signal.
    const m = macd(3, 6, 3, 128)
    feed(m, ramp(30))
    for (let i = 0; i < 5; i++) expect(m.signal[i]).toBeNaN()
    expect(m.signal[(30 - 1) % 128]).not.toBeNaN()
  })
})

describe('bollinger', () => {
  it('puts the bands k population deviations either side of the mean', () => {
    // 1..5 has mean 3 and population sd sqrt(2).
    const b = bollinger(5, 2, 64)
    feed(b, ramp(5))
    const i = 4
    expect(b.mid[i]).toBeCloseTo(3, 12)
    expect(b.up[i]).toBeCloseTo(3 + 2 * Math.SQRT2, 12)
    expect(b.lo[i]).toBeCloseTo(3 - 2 * Math.SQRT2, 12)
  })

  it('collapses onto the mean when the price is flat', () => {
    const b = bollinger(4, 2, 64)
    feed(b, [7, 7, 7, 7, 7])
    const i = 4
    expect(b.up[i]).toBeCloseTo(7, 9)
    expect(b.lo[i]).toBeCloseTo(7, 9)
  })
})

describe('atr', () => {
  it('uses the bar range alone for the very first bar', () => {
    // A first true range of 0 (no previous close) drags the reading down for a
    // whole period before it recovers.
    const a = atr(2, 64)
    a.push(12, 10, 11)
    a.push(13, 11, 12)
    expect(a.last).toBeCloseTo(2, 12)
  })

  it('takes the widest of the three true ranges, then smooths at Wilder 1/n', () => {
    const a = atr(3, 64)
    a.push(10, 8, 9) // tr 2
    a.push(12, 11, 11.5) // max(1, |12-9|, |11-9|) = 3
    a.push(11, 7, 8) // max(4, |11-11.5|, |7-11.5|) = 4.5
    expect(a.last).toBeCloseTo((2 + 3 + 4.5) / 3, 12)
    a.push(9, 8, 8.5) // max(1, |9-8|, |8-8|) = 1
    expect(a.last).toBeCloseTo((3.1666666666666665 * 2 + 1) / 3, 9)
  })
})

describe('vwap', () => {
  it('is the volume-weighted mean of the session so far', () => {
    const v = vwap(64)
    v.push(10, 1, true)
    expect(v.push(20, 3, false)).toBeCloseTo((10 + 60) / 4, 12)
  })

  it('starts over at the session boundary', () => {
    // Carried across the open, the line sticks to yesterday's value for hours.
    const v = vwap(64)
    v.push(10, 100, true)
    v.push(10, 100, false)
    expect(v.push(50, 1, true)).toBeCloseTo(50, 12)
  })
})

describe('reset', () => {
  it('returns every indicator to its unwarmed state', () => {
    const s = sma(3, 8)
    feed(s, ramp(10))
    s.reset()
    expect(s.count).toBe(0)
    expect(s.last).toBeNaN()
    expect(s.push(1)).toBeNaN()
  })
})
