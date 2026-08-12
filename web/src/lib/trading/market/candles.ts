// Ticks in, OHLCV ring buffers out.
//
// Two rules here are load-bearing and neither is obvious:
//
//  1. A bucket is NEVER skipped. When nothing trades for ten minutes the series
//     still gains ten flat bars. The chart maps x to a bar INDEX, not to a time,
//     so a missing bucket silently bends the time axis: every label to the left
//     of the gap is drawn at the wrong place and no amount of staring at the
//     renderer explains why.
//
//  2. A new bar opens at the previous bar's CLOSE, not at its first trade. That
//     is what makes `rollup` exact — a 5m bar derived from five 1m bars has to
//     equal the 5m bar the same ticks would have produced directly, and it only
//     does if a bucket whose first 1m sub-bar was flat still opens at the same
//     price both ways. The very first bar of a series has no previous close and
//     opens at its first trade.
//
// The columns are Float64Arrays because the renderer walks a few hundred bars
// every frame and boxed candle objects would put that walk on the GC's path.

import { TF_MS } from '../types'
import type { Candle, Px, Qty, SimTime, TickSink, Timeframe } from '../types'

/**
 * Struct-of-arrays ring buffer. The chart reads these Float64Arrays directly.
 *
 * `at(i)` maps a LOGICAL index (0 = oldest bar held) to the physical slot.
 * Nothing may index the columns without it.
 */
export interface CandleSeries {
  readonly tf: Timeframe
  readonly capacity: number
  readonly length: number
  readonly t: Float64Array
  readonly o: Float64Array
  readonly h: Float64Array
  readonly l: Float64Array
  readonly c: Float64Array
  readonly v: Float64Array
  /** Trade count per bar. Not part of what the chart needs, but it is what makes
   *  a synthetic candle's volume look bucketed rather than smeared, and it has to
   *  survive a save/load round trip. */
  readonly n: Float64Array
  /** Bumped on every mutation — the chart's dirty check. */
  readonly rev: number
  at(i: number): number
}

export interface CandleAggregator extends TickSink {
  readonly series: CandleSeries
  /** Emit flat (o=h=l=c=prevClose, v=0) candles up to the bucket containing `t`.
   *  No-op until the series has its first bar: with no previous close there is
   *  no price to draw a flat bar at. */
  fillTo(t: SimTime): void
  /** Fires exactly once per bucket that rolls closed, including flat ones. */
  onClose(cb: (t: SimTime, o: Px, h: Px, l: Px, c: Px, v: number) => void): () => void
  /** Logical half-open range [fromIdx, toIdx), defaulting to the whole series. */
  toArray(fromIdx?: number, toIdx?: number): Candle[]
  /** Replace the contents. Bars must be ascending; only the last `capacity`
   *  survive. The final bar becomes the forming one. */
  loadArray(bars: Candle[]): void
}

class Ring implements CandleSeries {
  readonly tf: Timeframe
  readonly capacity: number
  length = 0
  rev = 0
  readonly t: Float64Array
  readonly o: Float64Array
  readonly h: Float64Array
  readonly l: Float64Array
  readonly c: Float64Array
  readonly v: Float64Array
  readonly n: Float64Array
  /** Physical slot of logical 0. */
  private start = 0

  constructor(tf: Timeframe, capacity: number) {
    this.tf = tf
    this.capacity = Math.max(1, Math.floor(capacity))
    const k = this.capacity
    this.t = new Float64Array(k)
    this.o = new Float64Array(k)
    this.h = new Float64Array(k)
    this.l = new Float64Array(k)
    this.c = new Float64Array(k)
    this.v = new Float64Array(k)
    this.n = new Float64Array(k)
  }

  at(i: number): number {
    return (this.start + i) % this.capacity
  }

  /** Physical slot of the newest bar. -1 when empty. */
  head(): number {
    return this.length === 0 ? -1 : this.at(this.length - 1)
  }

  push(t: SimTime, o: Px, h: Px, l: Px, c: Px, v: number, n: number): number {
    let i: number
    if (this.length < this.capacity) {
      i = this.at(this.length)
      this.length++
    } else {
      // Full: the oldest bar is the one overwritten, and logical 0 moves on.
      i = this.start
      this.start = (this.start + 1) % this.capacity
    }
    this.t[i] = t
    this.o[i] = o
    this.h[i] = h
    this.l[i] = l
    this.c[i] = c
    this.v[i] = v
    this.n[i] = n
    this.rev++
    return i
  }

  clear(): void {
    this.length = 0
    this.start = 0
    this.rev++
  }
}

type CloseCb = (t: SimTime, o: Px, h: Px, l: Px, c: Px, v: number) => void

class Aggregator implements CandleAggregator {
  readonly series: Ring
  private readonly tfMs: number
  /** Bucket time of the forming bar; -1 before the first tick. */
  private curT = -1
  private readonly cbs = new Set<CloseCb>()

  constructor(tf: Timeframe, capacity: number) {
    this.series = new Ring(tf, capacity)
    this.tfMs = TF_MS[tf]
  }

  private bucket(t: SimTime): SimTime {
    return Math.floor(t / this.tfMs) * this.tfMs
  }

  private emitClose(): void {
    if (this.cbs.size === 0) return
    const s = this.series
    const i = s.head()
    for (const cb of this.cbs) cb(s.t[i], s.o[i], s.h[i], s.l[i], s.c[i], s.v[i])
  }

  /** Roll forward to `target`, closing the forming bar and inserting a flat one
   *  for every bucket in between. Assumes a bar already exists. */
  private roll(target: SimTime): void {
    const s = this.series
    while (this.curT < target) {
      this.emitClose()
      const prev = s.c[s.head()]
      this.curT += this.tfMs
      s.push(this.curT, prev, prev, prev, prev, 0, 0)
    }
  }

  onTick(t: SimTime, p: Px, q: Qty, _s: 1 | -1): void {
    const s = this.series
    const b = this.bucket(t)

    if (this.curT < 0) {
      this.curT = b
      s.push(b, p, p, p, p, q, 1)
      return
    }
    // A tick behind the forming bar would have to reopen a closed bucket. It
    // cannot happen from one market (times are non-decreasing), and quietly
    // folding it into the current bar is far better than corrupting the series.
    if (b < this.curT) return
    if (b > this.curT) this.roll(b)

    const i = s.head()
    if (p > s.h[i]) s.h[i] = p
    if (p < s.l[i]) s.l[i] = p
    s.c[i] = p
    s.v[i] += q
    s.n[i] += 1
    s.rev++
  }

  fillTo(t: SimTime): void {
    if (this.curT < 0) return
    this.roll(this.bucket(t))
  }

  onClose(cb: CloseCb): () => void {
    this.cbs.add(cb)
    return () => {
      this.cbs.delete(cb)
    }
  }

  toArray(fromIdx = 0, toIdx = this.series.length): Candle[] {
    const s = this.series
    const lo = Math.max(0, Math.min(fromIdx, s.length))
    const hi = Math.max(lo, Math.min(toIdx, s.length))
    const out: Candle[] = []
    for (let k = lo; k < hi; k++) {
      const i = s.at(k)
      out.push({ t: s.t[i], o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i], v: s.v[i], n: s.n[i] })
    }
    return out
  }

  loadArray(bars: Candle[]): void {
    const s = this.series
    s.clear()
    this.curT = -1
    const from = Math.max(0, bars.length - s.capacity)
    for (let k = from; k < bars.length; k++) {
      const b = bars[k]
      s.push(b.t, b.o, b.h, b.l, b.c, b.v, b.n)
      this.curT = b.t
    }
  }
}

export function createAggregator(tf: Timeframe, capacity: number): CandleAggregator {
  return new Aggregator(tf, capacity)
}

/**
 * Derive a coarser series without replaying ticks.
 *
 * Equal, bar for bar, to aggregating the same ticks at `tf` directly — which is
 * only true because of the open-at-previous-close rule above, and is worth a
 * test precisely because it is the kind of thing that is nearly right.
 */
export function rollup(src: CandleSeries, tf: Timeframe, capacity: number): CandleSeries {
  const out = new Ring(tf, capacity)
  const tfMs = TF_MS[tf]
  if (src.length === 0) return out

  let curT = -1
  let head = -1
  for (let k = 0; k < src.length; k++) {
    const i = src.at(k)
    const b = Math.floor(src.t[i] / tfMs) * tfMs
    if (b > curT) {
      // The source cannot have gaps, but a hand-loaded one can, and a coarser
      // grid must not inherit them.
      if (curT >= 0) {
        const prev = out.c[head]
        for (let g = curT + tfMs; g < b; g += tfMs) head = out.push(g, prev, prev, prev, prev, 0, 0)
      }
      head = out.push(b, src.o[i], src.h[i], src.l[i], src.c[i], src.v[i], src.n[i])
      curT = b
      continue
    }
    if (src.h[i] > out.h[head]) out.h[head] = src.h[i]
    if (src.l[i] < out.l[head]) out.l[head] = src.l[i]
    out.c[head] = src.c[i]
    out.v[head] += src.v[i]
    out.n[head] += src.n[i]
  }
  out.rev++
  return out
}
