import { describe, it, expect } from 'vitest'
import { createChartBars } from './chartData'
import type { CandleSeries } from '../../lib/trading/market/candles'
import type { Candle, Timeframe } from '../../lib/trading/types'

// The diff between the aggregator's ring and the chart's ring is the one piece of
// this feature that is pure, is easy to get subtly wrong, and fails invisibly: a
// missed bar just leaves a gap nobody notices until they read the price scale, and
// a double-reported close writes the same candle to IndexedDB twice.
//
// A hand-rolled CandleSeries stands in for the aggregator. It only has to satisfy
// the interface structurally, which is exactly the seam the architecture designed
// for — no market engine, no DOM, no database.

const TF: Timeframe = '1m'
const MIN = 60_000

function fakeSeries(bars: Candle[], capacity = 100): CandleSeries {
  const n = bars.length
  const col = (pick: (b: Candle) => number) => {
    const a = new Float64Array(capacity)
    for (let i = 0; i < n; i++) a[i] = pick(bars[i])
    return a
  }
  return {
    tf: TF,
    capacity,
    length: n,
    t: col((b) => b.t), o: col((b) => b.o), h: col((b) => b.h),
    l: col((b) => b.l), c: col((b) => b.c), v: col((b) => b.v), n: col((b) => b.n),
    rev: 1,
    at: (i: number) => i,
  }
}

const bar = (i: number, close = 100 + i): Candle => ({
  t: i * MIN, o: close - 1, h: close + 1, l: close - 2, c: close, v: 10, n: 3,
})

const closesOf = (b: ReturnType<typeof createChartBars>) =>
  Array.from({ length: b.length }, (_, i) => b.c[b.at(i)])

const timesOf = (b: ReturnType<typeof createChartBars>) =>
  Array.from({ length: b.length }, (_, i) => b.t[b.at(i)])

describe('chart bars', () => {
  it('seeds from history in order', () => {
    const bars = createChartBars(10)
    bars.seed([bar(0), bar(1), bar(2)])
    expect(bars.length).toBe(3)
    expect(closesOf(bars)).toEqual([100, 101, 102])
    expect(bars.newestT).toBe(2 * MIN)
  })

  it('takes the whole live series on first contact', () => {
    const bars = createChartBars(10)
    const closed: Candle[] = []
    bars.sync(fakeSeries([bar(0), bar(1)]), (b) => closed.push(b))
    expect(closesOf(bars)).toEqual([100, 101])
    // Nothing is reported closed on the first sync: the newest bar is still
    // forming and the ones before it were already whatever the series says.
    expect(closed).toEqual([])
  })

  it('drops seeded bars the live series also covers, so the join never doubles', () => {
    const bars = createChartBars(10)
    // History overlapping the live series is the normal case: persisted bars and
    // the aggregator both hold the last few minutes.
    bars.seed([bar(0), bar(1), bar(2)])
    bars.sync(fakeSeries([bar(2, 999), bar(3)]))
    expect(timesOf(bars)).toEqual([0, MIN, 2 * MIN, 3 * MIN])
    // The live series wins where they overlap — it is the fresher copy.
    expect(closesOf(bars)).toEqual([100, 101, 999, 103])
  })

  it('amends the forming bar in place rather than appending it', () => {
    const bars = createChartBars(10)
    bars.sync(fakeSeries([bar(0), bar(1, 500)]))
    bars.sync(fakeSeries([bar(0), bar(1, 700)]))
    expect(bars.length).toBe(2)
    expect(closesOf(bars)).toEqual([100, 700])
  })

  it('reports a bar closed exactly once, and only once it is final', () => {
    const bars = createChartBars(10)
    const closed: Candle[] = []
    const on = (b: Candle) => closed.push(b)

    bars.sync(fakeSeries([bar(0), bar(1, 500)]), on)
    bars.sync(fakeSeries([bar(0), bar(1, 700)]), on)
    expect(closed).toEqual([])

    // Bar 1 closes at 700 and bar 2 starts forming.
    bars.sync(fakeSeries([bar(0), bar(1, 700), bar(2)]), on)
    expect(closed.map((b) => b.t)).toEqual([MIN])
    // Reported with its FINAL close, not the value it had while forming.
    expect(closed[0].c).toBe(700)

    // Nothing new is reported while bar 2 only moves.
    bars.sync(fakeSeries([bar(0), bar(1, 700), bar(2, 999)]), on)
    expect(closed.length).toBe(1)
  })

  it('reports every bar in a multi-bar jump except the one still forming', () => {
    const bars = createChartBars(10)
    const closed: Candle[] = []
    bars.sync(fakeSeries([bar(0), bar(1)]))
    // A catch-up slice lands several closed bars at once.
    bars.sync(fakeSeries([bar(0), bar(1), bar(2), bar(3), bar(4)]), (b) => closed.push(b))
    expect(closed.map((b) => b.t)).toEqual([MIN, 2 * MIN, 3 * MIN])
    expect(timesOf(bars)).toEqual([0, MIN, 2 * MIN, 3 * MIN, 4 * MIN])
  })

  it('slides rather than grows once the ring is full', () => {
    const bars = createChartBars(3)
    bars.sync(fakeSeries([bar(0), bar(1), bar(2)]))
    bars.sync(fakeSeries([bar(0), bar(1), bar(2), bar(3)]))
    expect(bars.length).toBe(3)
    // The oldest bar is gone and the window has moved, with no copying.
    expect(timesOf(bars)).toEqual([MIN, 2 * MIN, 3 * MIN])
  })

  it('starts again when the whole window turned over', () => {
    const bars = createChartBars(10)
    bars.sync(fakeSeries([bar(0), bar(1)]))
    // Every bar is newer than anything held — a symbol switch, or a catch-up
    // longer than the series itself.
    bars.sync(fakeSeries([bar(50), bar(51)]))
    expect(timesOf(bars)).toEqual([0, MIN, 50 * MIN, 51 * MIN])
  })

  it('clear() forgets the live join as well as the data', () => {
    const bars = createChartBars(10)
    bars.sync(fakeSeries([bar(0), bar(1)]))
    bars.clear()
    expect(bars.length).toBe(0)
    // Not just empty: the next sync must take the whole series again rather than
    // diffing against a timestamp from the symbol it was showing before.
    bars.sync(fakeSeries([bar(7), bar(8)]))
    expect(timesOf(bars)).toEqual([7 * MIN, 8 * MIN])
  })

  it('bumps rev on every mutation, since it is the chart dirty check', () => {
    const bars = createChartBars(10)
    const r0 = bars.rev
    bars.seed([bar(0)])
    const r1 = bars.rev
    expect(r1).toBeGreaterThan(r0)
    bars.sync(fakeSeries([bar(0), bar(1)]))
    expect(bars.rev).toBeGreaterThan(r1)
  })

  it('ignores an empty series instead of clearing what it holds', () => {
    const bars = createChartBars(10)
    bars.seed([bar(0), bar(1)])
    bars.sync(fakeSeries([]))
    expect(bars.length).toBe(2)
  })
})
