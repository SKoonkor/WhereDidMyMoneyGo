// Coordinate transforms and axis ladders.
//
// Pure arithmetic, no canvas, no DOM — which is deliberate: jsdom has no 2D
// context, so anything testable has to live outside the renderer, and this is
// where most of the chart's correctness actually is.

import type { OhlcvColumns, Rect, Scales, TimeTick, Viewport } from './types'

/** Round to the nearest odd integer, never below 1. */
function oddify(n: number): number {
  const r = Math.round((n - 1) / 2) * 2 + 1
  return r < 1 ? 1 : r
}

/** Largest odd integer not greater than `n`, floored at 1. */
function oddAtMost(n: number): number {
  const f = Math.floor(n)
  const r = f % 2 === 0 ? f - 1 : f
  return r < 1 ? 1 : r
}

/**
 * Build the transforms for one frame.
 *
 * Body and wick widths are both forced ODD in device pixels and `cx` snaps bar
 * centres to half device pixels, so every rect edge lands exactly on a device
 * pixel boundary. Getting this pairing wrong is what produces the soft grey
 * candle edges that read as amateur at any zoom.
 */
export function makeScales(v: Viewport, plot: Rect, dpr: number): Scales {
  const barW = plot.w / v.span
  const pitchDev = barW * dpr
  // The body must leave at least one device pixel of BACKGROUND between
  // neighbours, and `oddify` rounds up: at a 5px pitch it turned 0.72*5 = 3.6
  // into 5, so bodies met edge to edge. Adjacent up and down candles then shared
  // a boundary column that the rasteriser blended into a third colour — a pixel
  // audit of one frame found 346 olive columns in a chart whose entire semantics
  // are green-up / red-down. Clamping to the largest odd width that still leaves
  // a gap is what keeps the gutter background rather than a mixture.
  const bodyDev = Math.min(
    oddify(Math.max(1, Math.round(pitchDev * 0.72))),
    oddAtMost(pitchDev - 1),
  )
  // 1 device px while bars are thin, widening to 3 as they get fat. Kept odd so
  // it shares the body's centring.
  const wickDev = oddify(Math.min(3, Math.max(1, Math.round((barW * dpr) / 12))))

  const pSpan = v.p1 - v.p0
  // A degenerate band would divide by zero and paint every bar on one row.
  const pScale = pSpan > 0 ? plot.h / pSpan : 0

  const xOf = (i: number) => plot.x + (i - v.i0 + 0.5) * barW
  const yOf = (p: number) => plot.y + plot.h - (p - v.p0) * pScale

  return {
    xOf,
    cx(i: number) {
      // Land on a half device pixel: floor to an integer device pixel, then add
      // a half. Paired with odd widths this makes every edge integral.
      const dev = Math.floor(xOf(i) * dpr) + 0.5
      return dev / dpr
    },
    iOf: (x: number) => (x - plot.x) / barW + v.i0 - 0.5,
    yOf,
    pOf: (y: number) => (pScale > 0 ? v.p0 + (plot.y + plot.h - y) / pScale : v.p0),
    barW,
    bodyW: bodyDev / dpr,
    wickW: wickDev / dpr,
  }
}

/** The 1 / 2 / 2.5 / 5 ladder every financial chart uses. 2.5 is the one people
 *  forget, and it is what keeps a 0-to-250 range from stepping in 50s. */
const MANTISSAS = [1, 2, 2.5, 5, 10]

/** Smallest ladder step that is at least `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  for (const m of MANTISSAS) if (norm <= m + 1e-12) return m * mag
  return 10 * mag
}

/**
 * Price gridlines.
 *
 * Snapped to a multiple of `tickSize` so a label can never show a price the
 * instrument cannot actually trade at — a detail nobody notices when it is right
 * and everybody notices when it is wrong.
 */
export function priceTicks(
  p0: number,
  p1: number,
  h: number,
  minGapPx: number,
  tickSize: number,
  max: number,
): Float64Array {
  const span = p1 - p0
  if (!(span > 0) || !(h > 0)) return new Float64Array(0)

  const room = Math.max(1, Math.min(max, Math.floor(h / minGapPx)))
  let step = niceStep(span / room)
  // Never step finer than the instrument's own resolution.
  if (tickSize > 0 && step < tickSize) step = tickSize

  const first = Math.ceil(p0 / step) * step
  const out: number[] = []
  for (let p = first; p <= p1 + step * 1e-9 && out.length < max; p += step) {
    // Re-snap each value: accumulating `+= step` drifts, and a drifted 43,200.000000001
    // formats as 43,200.00 but sorts and compares wrong.
    out.push(Math.round(p / step) * step)
  }
  return Float64Array.from(out)
}

/** Time ladder in ms. Months and years are approximated — the labels are placed
 *  by real calendar boundaries below, this only chooses the density. */
const TIME_STEPS = [
  1_000, 5_000, 15_000, 30_000,
  60_000, 300_000, 900_000, 1_800_000,
  3_600_000, 7_200_000, 14_400_000, 21_600_000, 43_200_000,
  86_400_000, 604_800_000, 2_592_000_000, 31_536_000_000,
]

function unitFor(step: number): TimeTick['unit'] {
  if (step < 60_000) return 'sec'
  if (step < 3_600_000) return 'min'
  if (step < 86_400_000) return 'hour'
  if (step < 2_592_000_000) return 'day'
  if (step < 31_536_000_000) return 'month'
  return 'year'
}

/**
 * Time gridlines, aligned to real local calendar boundaries.
 *
 * `major` marks the label the axis should promote — a day change inside an
 * intraday view, a month change inside a daily one. Drawing majors in --ink and
 * the rest in --muted is most of what makes a dense time axis readable, so the
 * decision is made here rather than left to the layer.
 *
 * Returns no strings at all: formatting is the React layer's job, because it is
 * the only part that knows the app's language.
 */
export function timeTicks(t0: number, t1: number, w: number, minGapPx: number): TimeTick[] {
  const span = t1 - t0
  if (!(span > 0) || !(w > 0)) return []

  const perPx = span / w
  const wanted = perPx * minGapPx
  let step = TIME_STEPS[TIME_STEPS.length - 1]
  for (const s of TIME_STEPS) {
    if (s >= wanted) {
      step = s
      break
    }
  }
  const unit = unitFor(step)
  const out: TimeTick[] = []

  // Steps of a day or less divide the local day evenly, so aligning to local
  // midnight puts a gridline exactly on the day boundary — which is the line the
  // eye is actually looking for.
  if (step <= 86_400_000) {
    const start = new Date(t0)
    start.setHours(0, 0, 0, 0)
    let t = start.getTime()
    while (t < t0) t += step
    let prevDay = -1
    for (; t <= t1 && out.length < 64; t += step) {
      const d = new Date(t)
      const day = d.getDate()
      const major = step < 86_400_000 ? day !== prevDay && prevDay !== -1 : d.getDay() === 1
      prevDay = day
      out.push({ t, unit, major })
    }
    // The first visible label has no predecessor to compare against; treat a
    // midnight tick as major so a chart opening on a day boundary shows the date.
    if (out.length && step < 86_400_000) {
      const f = new Date(out[0].t)
      if (f.getHours() === 0 && f.getMinutes() === 0) out[0] = { ...out[0], major: true }
    }
    return out
  }

  // Coarser than a day: walk the calendar rather than adding milliseconds, or
  // month lengths and DST make the labels drift off their own boundaries.
  const months = step >= 31_536_000_000 ? 12 : Math.max(1, Math.round(step / 2_592_000_000))
  const d = new Date(t0)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  while (d.getTime() < t0) d.setMonth(d.getMonth() + 1)
  while (d.getTime() <= t1 && out.length < 64) {
    out.push({ t: d.getTime(), unit, major: d.getMonth() === 0 })
    d.setMonth(d.getMonth() + months)
  }
  return out
}

/**
 * The price band that fits bars [i0, i1].
 *
 * Floored at 20 ticks so a dead-flat stretch doesn't zoom into float noise and
 * render as a seismograph — the most jarring failure a naive autoscale has.
 */
export function autoRange(
  d: OhlcvColumns,
  i0: number,
  i1: number,
  padPct: number,
  tickSize: number,
): { p0: number; p1: number } {
  const lo0 = Math.max(0, Math.floor(i0))
  const hi0 = Math.min(d.length - 1, Math.ceil(i1))
  if (d.length === 0 || hi0 < lo0) return { p0: 0, p1: 1 }

  let lo = Infinity
  let hi = -Infinity
  for (let i = lo0; i <= hi0; i++) {
    const k = d.at(i)
    const l = d.l[k]
    const h = d.h[k]
    if (l < lo) lo = l
    if (h > hi) hi = h
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { p0: 0, p1: 1 }

  let span = hi - lo
  const floor = Math.max(tickSize * 20, Math.abs(hi) * 1e-6)
  if (span < floor) {
    const mid = (hi + lo) / 2
    lo = mid - floor / 2
    hi = mid + floor / 2
    span = floor
  }
  const pad = span * padPct
  return { p0: lo - pad, p1: hi + pad }
}

/**
 * Keep a viewport legal: zoom within [minSpan, maxSpan], and never panned so far
 * that the data leaves the screen entirely.
 *
 * `rightGapBars` is the empty space deliberately kept to the right of the newest
 * bar. A chart whose last candle is jammed against the price axis reads as
 * unfinished, and this is the cheapest fix for it in the entire feature.
 */
export function clampViewport(
  v: Viewport,
  dataLen: number,
  minSpan: number,
  maxSpan: number,
  rightGapBars: number,
): Viewport {
  const span = Math.max(minSpan, Math.min(maxSpan, v.span))
  // Half a screen of slack each way: enough to fling past the edge and feel the
  // rubber band, not enough to lose the data.
  const slack = span / 2
  const minI0 = -slack
  const maxI0 = Math.max(minI0, dataLen + rightGapBars - span + slack)
  const i0 = Math.max(minI0, Math.min(maxI0, v.i0))
  return { i0, span, p0: v.p0, p1: v.p1 }
}

/** Where i0 must sit for the newest bar to be at the right edge, gap included. */
export function followI0(dataLen: number, span: number, rightGapBars: number): number {
  return dataLen + rightGapBars - span
}
