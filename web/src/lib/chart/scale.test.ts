import { describe, it, expect } from 'vitest'
import {
  autoRange, clampViewport, followI0, makeScales, niceStep, priceTicks, timeTicks,
} from './scale'
import type { OhlcvColumns, Rect, Viewport } from './types'

const plot: Rect = { x: 0, y: 0, w: 300, h: 200 }
const vp: Viewport = { i0: 0, span: 100, p0: 100, p1: 200 }

/** A columnar series backed by plain arrays, laid out like the real ring buffer
 *  (logical 0 = oldest) so `at` is exercised rather than bypassed. */
function series(bars: { o: number; h: number; l: number; c: number; v?: number }[]): OhlcvColumns {
  const n = bars.length
  const mk = (f: (b: (typeof bars)[0]) => number) => Float64Array.from(bars.map(f))
  return {
    length: n,
    t: Float64Array.from(bars.map((_, i) => i * 60_000)),
    o: mk((b) => b.o),
    h: mk((b) => b.h),
    l: mk((b) => b.l),
    c: mk((b) => b.c),
    v: mk((b) => b.v ?? 1),
    at: (i) => i,
    rev: 1,
  }
}

describe('makeScales', () => {
  it('round-trips x and price', () => {
    const s = makeScales(vp, plot, 2)
    expect(s.iOf(s.xOf(42))).toBeCloseTo(42, 9)
    expect(s.pOf(s.yOf(137.5))).toBeCloseTo(137.5, 9)
  })

  it('puts price low at the bottom of the plot and high at the top', () => {
    const s = makeScales(vp, plot, 2)
    expect(s.yOf(100)).toBeCloseTo(200, 9)
    expect(s.yOf(200)).toBeCloseTo(0, 9)
  })

  it('keeps body and wick widths odd in device pixels', () => {
    // Both odd is what lets a bar centre sit on a half device pixel and every
    // edge land on a whole one. An even body here is a blurry candle later.
    for (const span of [12, 40, 100, 300, 800]) {
      for (const dpr of [1, 2, 3]) {
        const s = makeScales({ ...vp, span }, plot, dpr)
        expect(Math.round(s.bodyW * dpr) % 2).toBe(1)
        expect(Math.round(s.wickW * dpr) % 2).toBe(1)
        expect(s.bodyW * dpr).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('always leaves a device pixel of background between neighbouring bodies', () => {
    // Found by a pixel audit during a blind visual review: `oddify` rounds UP, so
    // at a 5-device-pixel pitch a body came out 5 wide and candles met edge to
    // edge. Where an up candle touched a down one the boundary column blended
    // green into red and produced a third colour the chart has no meaning for —
    // 346 such pixels in a single frame.
    for (const span of [12, 40, 100, 150, 200, 300, 500, 800]) {
      for (const dpr of [1, 2, 3]) {
        const s = makeScales({ ...vp, span }, plot, dpr)
        const pitchDev = (plot.w / span) * dpr
        const bodyDev = Math.round(s.bodyW * dpr)
        // Only exempt when there is genuinely no room; the candle layer degrades
        // to 1px OHLC bars long before this.
        if (pitchDev >= 3) {
          expect(bodyDev, `span ${span} dpr ${dpr}`).toBeLessThanOrEqual(pitchDev - 1)
        }
        expect(bodyDev % 2, `span ${span} dpr ${dpr}`).toBe(1)
      }
    }
  })

  it('snaps bar centres to half device pixels', () => {
    for (const dpr of [1, 2, 3]) {
      const s = makeScales(vp, plot, dpr)
      for (let i = 0; i < 20; i++) {
        const dev = s.cx(i) * dpr
        expect(Math.abs(dev - Math.floor(dev) - 0.5)).toBeLessThan(1e-9)
      }
    }
  })

  it('puts every candle edge on a whole device pixel', () => {
    const dpr = 2
    const s = makeScales(vp, plot, dpr)
    for (let i = 0; i < 20; i++) {
      for (const w of [s.bodyW, s.wickW]) {
        for (const edge of [s.cx(i) - w / 2, s.cx(i) + w / 2]) {
          const dev = edge * dpr
          expect(Math.abs(dev - Math.round(dev))).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('survives a degenerate price band without dividing by zero', () => {
    const s = makeScales({ ...vp, p0: 50, p1: 50 }, plot, 2)
    expect(Number.isFinite(s.yOf(50))).toBe(true)
    expect(Number.isFinite(s.pOf(0))).toBe(true)
  })
})

describe('niceStep', () => {
  it('walks the 1 / 2 / 2.5 / 5 ladder', () => {
    expect(niceStep(0.9)).toBe(1)
    expect(niceStep(1.1)).toBe(2)
    expect(niceStep(2.3)).toBe(2.5)
    expect(niceStep(2.6)).toBe(5)
    expect(niceStep(6)).toBe(10)
    expect(niceStep(230)).toBe(250)
    expect(niceStep(0.023)).toBeCloseTo(0.025, 12)
  })
})

describe('priceTicks', () => {
  it('respects the minimum gap and the cap', () => {
    const ticks = priceTicks(100, 200, 200, 34, 0.01, 7)
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks.length).toBeLessThanOrEqual(7)
    for (let i = 1; i < ticks.length; i++) {
      const gapPx = ((ticks[i] - ticks[i - 1]) / 100) * 200
      expect(gapPx).toBeGreaterThanOrEqual(34 - 1e-9)
    }
  })

  it('stays inside the band', () => {
    const ticks = priceTicks(101.3, 198.7, 200, 34, 0.01, 7)
    for (const v of ticks) {
      expect(v).toBeGreaterThanOrEqual(101.3)
      expect(v).toBeLessThanOrEqual(198.7)
    }
  })

  it('never steps finer than the instrument can trade', () => {
    // A label showing a price the instrument cannot quote is the kind of detail
    // that is invisible when right and obvious when wrong.
    const ticks = priceTicks(100, 100.5, 400, 34, 0.25, 7)
    for (const v of ticks) {
      expect(Math.abs(v / 0.25 - Math.round(v / 0.25))).toBeLessThan(1e-9)
    }
  })

  it('does not drift when accumulating small steps', () => {
    const ticks = priceTicks(0, 1, 700, 34, 0.001, 20)
    for (const v of ticks) {
      expect(Math.abs(v * 1000 - Math.round(v * 1000))).toBeLessThan(1e-6)
    }
  })

  it('returns nothing for a degenerate band', () => {
    expect(priceTicks(100, 100, 200, 34, 0.01, 7).length).toBe(0)
    expect(priceTicks(100, 200, 0, 34, 0.01, 7).length).toBe(0)
  })
})

describe('timeTicks', () => {
  const day = new Date(2026, 7, 10, 0, 0, 0, 0).getTime()

  it('aligns intraday ticks to local clock boundaries', () => {
    const ticks = timeTicks(day, day + 6 * 3_600_000, 360, 64)
    expect(ticks.length).toBeGreaterThan(2)
    for (const t of ticks) {
      const d = new Date(t.t)
      expect(d.getSeconds()).toBe(0)
      expect(d.getMilliseconds()).toBe(0)
    }
  })

  it('marks the day boundary as major inside an intraday view', () => {
    // This one rule — dates in --ink, times in --muted — is most of what makes a
    // dense time axis readable.
    const ticks = timeTicks(day - 4 * 3_600_000, day + 4 * 3_600_000, 400, 64)
    const majors = ticks.filter((t) => t.major)
    expect(majors.length).toBeGreaterThanOrEqual(1)
    expect(new Date(majors[0].t).getHours()).toBe(0)
  })

  it('honours the minimum gap at every zoom', () => {
    for (const span of [60_000, 3_600_000, 86_400_000, 30 * 86_400_000, 800 * 86_400_000]) {
      const w = 360
      const ticks = timeTicks(day, day + span, w, 64)
      const perPx = span / w
      for (let i = 1; i < ticks.length; i++) {
        expect((ticks[i].t - ticks[i - 1].t) / perPx).toBeGreaterThanOrEqual(63)
      }
    }
  })

  it('walks the calendar rather than adding milliseconds at month scale', () => {
    // Adding 30 days repeatedly drifts off the 1st within a year, which puts the
    // gridline next to the month label instead of on it.
    const ticks = timeTicks(day, day + 400 * 86_400_000, 360, 64)
    for (const t of ticks) {
      const d = new Date(t.t)
      expect(d.getDate()).toBe(1)
      expect(d.getHours()).toBe(0)
    }
  })

  it('returns nothing for a degenerate span', () => {
    expect(timeTicks(day, day, 300, 64)).toEqual([])
    expect(timeTicks(day, day + 1000, 0, 64)).toEqual([])
  })
})

describe('autoRange', () => {
  const bars = series([
    { o: 10, h: 12, l: 9, c: 11 },
    { o: 11, h: 15, l: 10, c: 14 },
    { o: 14, h: 14, l: 8, c: 9 },
  ])

  it('covers the visible highs and lows with padding', () => {
    const { p0, p1 } = autoRange(bars, 0, 2, 0.05, 0.01)
    expect(p0).toBeLessThan(8)
    expect(p1).toBeGreaterThan(15)
  })

  it('only looks at the visible slice', () => {
    const { p1 } = autoRange(bars, 0, 0, 0.05, 0.01)
    expect(p1).toBeLessThan(15)
  })

  it('refuses to zoom into float noise on a flat stretch', () => {
    // Without the floor, a dead-flat series autoscales to its own rounding error
    // and renders as a seismograph.
    const flat = series([
      { o: 100, h: 100, l: 100, c: 100 },
      { o: 100, h: 100, l: 100, c: 100 },
    ])
    const { p0, p1 } = autoRange(flat, 0, 1, 0.05, 0.01)
    expect(p1 - p0).toBeGreaterThanOrEqual(0.2)
  })

  it('handles an empty series', () => {
    expect(autoRange(series([]), 0, 0, 0.05, 0.01)).toEqual({ p0: 0, p1: 1 })
  })
})

describe('clampViewport', () => {
  it('holds the zoom inside its bounds', () => {
    expect(clampViewport({ ...vp, span: 2 }, 500, 12, 2000, 12).span).toBe(12)
    expect(clampViewport({ ...vp, span: 9999 }, 500, 12, 2000, 12).span).toBe(2000)
  })

  it('allows half a screen of overscroll each way but no more', () => {
    // The slack is what a rubber-band fling needs to have somewhere to go.
    const left = clampViewport({ ...vp, i0: -9999, span: 100 }, 500, 12, 2000, 12)
    expect(left.i0).toBe(-50)
    const right = clampViewport({ ...vp, i0: 9999, span: 100 }, 500, 12, 2000, 12)
    expect(right.i0).toBe(500 + 12 - 100 + 50)
  })

  it('leaves a legal viewport untouched', () => {
    const v = { i0: 120, span: 100, p0: 1, p1: 2 }
    expect(clampViewport(v, 500, 12, 2000, 12)).toEqual(v)
  })

  it('stays sane when there is less data than one screen', () => {
    const v = clampViewport({ ...vp, i0: 0, span: 100 }, 5, 12, 2000, 12)
    expect(Number.isFinite(v.i0)).toBe(true)
  })
})

describe('followI0', () => {
  it('leaves the right-hand gap past the newest bar', () => {
    // A chart glued to its price axis reads as unfinished; this gap is the
    // cheapest quality win in the whole feature.
    expect(followI0(500, 100, 12)).toBe(412)
  })
})
