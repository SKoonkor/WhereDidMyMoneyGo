import { describe, it, expect } from 'vitest'
import { createAggregator, rollup } from './candles'
import type { CandleSeries } from './candles'
import { createRng } from '../rng'
import { TF_MS } from '../types'
import type { Candle } from '../types'

const MIN = TF_MS['1m']

/**
 * The chart's view of a series, restated here rather than imported.
 *
 * lib/chart/ and lib/trading/ are forbidden from importing each other, so the
 * only thing holding the two halves together is that a CandleSeries structurally
 * satisfies OhlcvColumns. Assigning one to the other is what turns that promise
 * into a compile error the day a field is renamed.
 */
interface OhlcvColumnsShape {
  readonly length: number
  readonly t: Float64Array
  readonly o: Float64Array
  readonly h: Float64Array
  readonly l: Float64Array
  readonly c: Float64Array
  readonly v: Float64Array
  at(i: number): number
  readonly rev: number
}

function bars(s: CandleSeries): Candle[] {
  const out: Candle[] = []
  for (let k = 0; k < s.length; k++) {
    const i = s.at(k)
    out.push({ t: s.t[i], o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i], v: s.v[i], n: s.n[i] })
  }
  return out
}

describe('the candle aggregator', () => {
  it('satisfies the chart’s column contract without importing it', () => {
    const a = createAggregator('1m', 10)
    const cols: OhlcvColumnsShape = a.series
    expect(cols.length).toBe(0)
  })

  it('opens the first bar at its first trade', () => {
    const a = createAggregator('1m', 10)
    a.onTick(30_000, 100, 2, 1)
    a.onTick(40_000, 105, 1, 1)
    a.onTick(50_000, 95, 3, -1)
    expect(bars(a.series)).toEqual([{ t: 0, o: 100, h: 105, l: 95, c: 95, v: 6, n: 3 }])
  })

  it('opens every later bar at the previous close', () => {
    const a = createAggregator('1m', 10)
    a.onTick(0, 100, 1, 1)
    a.onTick(MIN + 10, 130, 1, 1)
    const b = bars(a.series)
    expect(b[1].o).toBe(100)
    expect(b[1].h).toBe(130)
    expect(b[1].l).toBe(100)
  })

  it('never skips a bucket — a ten-minute gap yields ten flat bars', () => {
    const a = createAggregator('1m', 100)
    a.onTick(0, 100, 5, 1)
    a.fillTo(10 * MIN)

    const b = bars(a.series)
    expect(b).toHaveLength(11)
    for (let i = 1; i < b.length; i++) {
      expect(b[i]).toEqual({ t: i * MIN, o: 100, h: 100, l: 100, c: 100, v: 0, n: 0 })
    }
  })

  it('keeps the bar times evenly spaced through a gap in the ticks', () => {
    const a = createAggregator('1m', 100)
    a.onTick(0, 100, 1, 1)
    a.onTick(37 * MIN + 500, 120, 1, 1)
    const b = bars(a.series)
    expect(b).toHaveLength(38)
    for (let i = 1; i < b.length; i++) expect(b[i].t - b[i - 1].t).toBe(MIN)
  })

  it('does nothing on fillTo before the first tick', () => {
    // With no previous close there is no price to draw a flat bar at, and
    // inventing one would put a fabricated level on the chart.
    const a = createAggregator('1m', 10)
    a.fillTo(10 * MIN)
    expect(a.series.length).toBe(0)
  })

  it('fires onClose exactly once per bucket that rolls, flat ones included', () => {
    const a = createAggregator('1m', 100)
    const closed: number[] = []
    const off = a.onClose((t) => closed.push(t))
    a.onTick(0, 100, 1, 1)
    a.fillTo(3 * MIN)
    expect(closed).toEqual([0, MIN, 2 * MIN])

    off()
    a.fillTo(6 * MIN)
    expect(closed).toEqual([0, MIN, 2 * MIN])
  })

  it('reports the closing values, not the forming ones', () => {
    const a = createAggregator('1m', 10)
    const seen: number[][] = []
    a.onClose((t, o, h, l, c, v) => seen.push([t, o, h, l, c, v]))
    a.onTick(0, 100, 1, 1)
    a.onTick(1_000, 110, 2, 1)
    a.onTick(MIN + 1, 90, 1, -1)
    expect(seen).toEqual([[0, 100, 110, 100, 110, 3]])
  })

  it('drops a tick that arrives behind the forming bar rather than corrupting it', () => {
    const a = createAggregator('1m', 10)
    a.onTick(2 * MIN, 100, 1, 1)
    a.onTick(MIN, 999, 1, 1)
    expect(a.series.length).toBe(1)
    expect(a.series.h[a.series.at(0)]).toBe(100)
  })

  it('bumps rev on every mutation so the chart can dirty-check it', () => {
    const a = createAggregator('1m', 10)
    const r0 = a.series.rev
    a.onTick(0, 100, 1, 1)
    expect(a.series.rev).toBeGreaterThan(r0)
    const r1 = a.series.rev
    a.onTick(1, 101, 1, 1)
    expect(a.series.rev).toBeGreaterThan(r1)
  })

  it('wraps at capacity, dropping the oldest bar and keeping at() correct', () => {
    const a = createAggregator('1m', 5)
    for (let i = 0; i < 9; i++) a.onTick(i * MIN, 100 + i, 1, 1)
    const b = bars(a.series)
    expect(a.series.length).toBe(5)
    expect(b.map((x) => x.t)).toEqual([4 * MIN, 5 * MIN, 6 * MIN, 7 * MIN, 8 * MIN])
    expect(b.map((x) => x.c)).toEqual([104, 105, 106, 107, 108])
  })

  it('round-trips through toArray and loadArray', () => {
    const a = createAggregator('1m', 50)
    for (let i = 0; i < 20; i++) a.onTick(i * MIN + 100, 100 + i, i + 1, 1)
    const saved = a.toArray()

    const b = createAggregator('1m', 50)
    b.loadArray(saved)
    expect(b.toArray()).toEqual(saved)

    // And it keeps aggregating from where the loaded data left off.
    b.onTick(19 * MIN + 200, 500, 2, 1)
    expect(b.series.length).toBe(20)
    expect(b.toArray()[19].h).toBe(500)
  })

  it('keeps only the newest bars when loading more than capacity', () => {
    const a = createAggregator('1m', 4)
    const all: Candle[] = []
    for (let i = 0; i < 10; i++) {
      all.push({ t: i * MIN, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 })
    }
    a.loadArray(all)
    expect(a.toArray().map((c) => c.t)).toEqual([6 * MIN, 7 * MIN, 8 * MIN, 9 * MIN])
  })

  it('slices toArray by logical index', () => {
    const a = createAggregator('1m', 10)
    for (let i = 0; i < 6; i++) a.onTick(i * MIN, 100 + i, 1, 1)
    expect(a.toArray(2, 4).map((c) => c.t)).toEqual([2 * MIN, 3 * MIN])
    expect(a.toArray(4).map((c) => c.t)).toEqual([4 * MIN, 5 * MIN])
    expect(a.toArray(99, 200)).toEqual([])
  })
})

describe('rollup', () => {
  /** A tick stream with deliberate quiet stretches, so the coarser grid has to
   *  cope with flat sub-bars rather than a tidy sequence of busy ones. */
  function ticks(): { t: number; p: number; q: number }[] {
    const rng = createRng('rollup')
    const out: { t: number; p: number; q: number }[] = []
    let p = 100
    for (let t = 0; t < 130 * MIN; t += 7_000) {
      // A third of the time nothing trades at all for a while.
      if (rng.u() < 0.3) continue
      p *= Math.exp(0.002 * rng.normal())
      out.push({ t, p, q: 1 + rng.u() })
    }
    return out
  }

  it('derives a 5m series identical to aggregating the same ticks at 5m', () => {
    const fine = createAggregator('1m', 500)
    const coarse = createAggregator('5m', 500)
    for (const k of ticks()) {
      fine.onTick(k.t, k.p, k.q, 1)
      coarse.onTick(k.t, k.p, k.q, 1)
    }

    expect(bars(rollup(fine.series, '5m', 500))).toEqual(bars(coarse.series))
  })

  it('agrees at 1h as well, so the rule is not a 5m coincidence', () => {
    const fine = createAggregator('1m', 500)
    const coarse = createAggregator('1h', 500)
    for (const k of ticks()) {
      fine.onTick(k.t, k.p, k.q, 1)
      coarse.onTick(k.t, k.p, k.q, 1)
    }
    expect(bars(rollup(fine.series, '1h', 500))).toEqual(bars(coarse.series))
  })

  it('returns an empty series from an empty one', () => {
    const a = createAggregator('1m', 10)
    const r = rollup(a.series, '5m', 10)
    expect(r.length).toBe(0)
    expect(r.tf).toBe('5m')
  })

  it('fills buckets a hand-loaded source skipped', () => {
    const a = createAggregator('1m', 100)
    a.loadArray([
      { t: 0, o: 100, h: 101, l: 99, c: 100, v: 1, n: 1 },
      { t: 60 * MIN, o: 100, h: 100, l: 100, c: 100, v: 1, n: 1 },
    ])
    const r = rollup(a.series, '5m', 100)
    expect(r.length).toBe(13)
    for (let k = 1; k < r.length; k++) {
      expect(r.t[r.at(k)] - r.t[r.at(k - 1)]).toBe(TF_MS['5m'])
    }
  })
})
