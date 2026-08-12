// The bridge between the market's candle ring and the chart's column reader.
//
// The two never meet directly, and cannot: `CandleSeries` is the aggregator's own
// ring, sized by TF_CAPACITY and holding only what the sandbox has actually
// simulated, while the chart wants ONE set of Float64Arrays covering history
// AND live bars — `OhlcvColumns.at()` maps a logical index into a single array, so
// there is no way to span two of them. A fresh sandbox's 1m series is empty, and a
// chart drawn straight from it would open on a blank plot.
//
// So this owns its own ring: seeded from persisted bars (and, where those run out,
// from the feed's invented history), then kept in step with the live series. The
// sync is O(bars that changed), not O(series), because it runs at frame rate:
// a full recopy of 4,320 bars across six columns sixty times a second is 1.5M
// writes per second for, almost always, one bar's worth of new information.
//
// It also owns the "a bar just closed" signal. `FeedListener.onBarClose` reports
// only (symbol, tf, t) — enough to know something happened, not enough to persist
// it — and the diff this file already computes hands back the whole candle.

import type { OhlcvColumns } from '../../lib/chart/types'
import type { Candle } from '../../lib/trading/types'
import type { CandleSeries } from '../../lib/trading/market/candles'

/** How many bars the chart keeps per series. Comfortably more than any zoom-out
 *  shows, so panning back never hits a wall the user can see. */
export const CHART_CAPACITY = 3000

export interface ChartBars extends OhlcvColumns {
  readonly n: Float64Array
  /** Sim time of the newest bar held, or NaN when empty. */
  readonly newestT: number
  /** Replace everything. Bars must be ascending; the last becomes the forming one. */
  seed(bars: readonly Candle[]): void
  /**
   * Pull whatever changed out of the live series.
   *
   * `onClosed` fires once per bar that has become final — never for the forming
   * bar, which is still moving — so the caller can stage it for persistence
   * exactly once.
   */
  sync(series: CandleSeries, onClosed?: (b: Candle) => void): void
  clear(): void
}

class Bars implements ChartBars {
  readonly capacity: number
  readonly t: Float64Array
  readonly o: Float64Array
  readonly h: Float64Array
  readonly l: Float64Array
  readonly c: Float64Array
  readonly v: Float64Array
  readonly n: Float64Array
  length = 0
  rev = 0

  private head = 0
  /** The newest live-series timestamp already folded in. NaN before the first
   *  sync, which is what tells `sync` to take the whole series rather than a diff. */
  private lastT = NaN

  constructor(capacity: number) {
    this.capacity = capacity
    this.t = new Float64Array(capacity)
    this.o = new Float64Array(capacity)
    this.h = new Float64Array(capacity)
    this.l = new Float64Array(capacity)
    this.c = new Float64Array(capacity)
    this.v = new Float64Array(capacity)
    this.n = new Float64Array(capacity)
  }

  at(i: number): number {
    return (this.head + i) % this.capacity
  }

  get newestT(): number {
    return this.length ? this.t[this.at(this.length - 1)] : NaN
  }

  private write(k: number, b: Candle): void {
    this.t[k] = b.t
    this.o[k] = b.o
    this.h[k] = b.h
    this.l[k] = b.l
    this.c[k] = b.c
    this.v[k] = b.v
    this.n[k] = b.n
  }

  private push(b: Candle): void {
    if (this.length < this.capacity) {
      this.write(this.at(this.length), b)
      this.length++
    } else {
      // Full: the oldest bar is overwritten and the window slides. No copying —
      // that is the whole reason this is a ring and not an array with a shift().
      this.write(this.head, b)
      this.head = (this.head + 1) % this.capacity
    }
  }

  seed(bars: readonly Candle[]): void {
    this.clear()
    for (const b of bars) this.push(b)
    this.rev++
  }

  clear(): void {
    this.length = 0
    this.head = 0
    this.lastT = NaN
    this.rev++
  }

  sync(series: CandleSeries, onClosed?: (b: Candle) => void): void {
    const n = series.length
    if (n === 0) return
    const read = (i: number): Candle => {
      const k = series.at(i)
      return {
        t: series.t[k], o: series.o[k], h: series.h[k], l: series.l[k],
        c: series.c[k], v: series.v[k], n: series.n[k],
      }
    }
    const newest = series.t[series.at(n - 1)]

    // First contact with the live series. Anything already seeded that the series
    // also covers is dropped, so the join never doubles a bar.
    if (Number.isNaN(this.lastT)) {
      const oldest = series.t[series.at(0)]
      while (this.length > 0 && this.t[this.at(this.length - 1)] >= oldest) this.length--
      for (let i = 0; i < n; i++) this.push(read(i))
      this.lastT = newest
      this.rev++
      return
    }

    if (newest === this.lastT) {
      // The forming bar moved. One write, which is the overwhelmingly common case.
      if (this.length > 0) this.write(this.at(this.length - 1), read(n - 1))
      else this.push(read(n - 1))
      this.rev++
      return
    }

    // How many live bars are strictly newer than what we last folded in.
    let k = 0
    while (k < n && series.t[series.at(n - 1 - k)] > this.lastT) k++

    // The bar we were holding as "forming" has closed. Refresh it from its final
    // state and only then report it — a bar reported at the moment it was still
    // moving would be persisted with a close that never happened.
    const prev = n - 1 - k
    if (prev >= 0) {
      const b = read(prev)
      if (this.length > 0) this.write(this.at(this.length - 1), b)
      else this.push(b)
      onClosed?.(b)
    }
    for (let j = k - 1; j >= 0; j--) {
      const b = read(n - 1 - j)
      this.push(b)
      // Everything but the newest is already final.
      if (j > 0) onClosed?.(b)
    }
    this.lastT = newest
    this.rev++
  }
}

export function createChartBars(capacity: number = CHART_CAPACITY): ChartBars {
  return new Bars(capacity)
}
