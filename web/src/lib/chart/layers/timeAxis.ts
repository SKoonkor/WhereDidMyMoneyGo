// The time axis.
//
// The hierarchy IS the feature. A label that crosses a day boundary renders in
// --ink as `MMM D`; every other label renders in --muted as `HH:mm`. That one
// rule is most of what makes TradingView's time axis readable at a glance, and
// an axis of uniformly-weighted `14:30 15:00 15:30` is most of what makes a
// hobby chart's unreadable. `timeTicks` already decides which is which — the
// `major` flag — so this layer only has to honour it.
//
// The other rule: never clip an edge label. A half-visible date at the left
// margin reads as a rendering bug, so a label that would not fit whole is
// dropped instead.

import type { ChartLayer, RenderCtx, TimeUnit } from '../types'
import { Z } from '../types'
import { TIME_TICK_GAP } from './grid'
import { TimeTickCache, hLine, indexAtTime, monoFont, proseFont, snapRect } from './shared'

export interface TimeAxisOptions {
  /** Supplied by the React layer, which is the only part that knows the app's
   *  language. `Intl.DateTimeFormat` with `calendar: 'gregory'` pinned — the
   *  rest of the app shows Gregorian dates in Thai too. */
  format: (t: number, unit: TimeUnit, major: boolean) => string
  minGapPx?: number
}

/** `timeTicks` caps its output at 64, so the caches never have to grow. */
const MAX_TICKS = 64

export function createTimeAxisLayer(o: TimeAxisOptions): ChartLayer {
  const minGap = o.minGapPx ?? TIME_TICK_GAP
  const times = new TimeTickCache()

  // Formatted labels and their measured widths, rebuilt only when the tick set
  // itself changes. measureText costs about as much as fillText, so measuring
  // six labels every frame would double this layer's text budget for nothing.
  const strs = new Array<string>(MAX_TICKS).fill('')
  const widths = new Float64Array(MAX_TICKS)
  let cacheKey: unknown = null
  let cacheFont = ''

  return {
    id: 'timeAxis',
    z: Z.axes,
    // Depends only on the viewport, but it lives outside the plot bitmap, so it
    // is neither animated nor cached — it repaints when something is dirty.
    volatile: false,
    cacheable: false,

    draw(c: RenderCtx) {
      const { ctx, theme, plot, timeAxis, scales, data } = c
      if (timeAxis.h <= 0 || timeAxis.w <= 0) return

      ctx.fillStyle = theme.axisBg
      snapRect(c, timeAxis.x, timeAxis.y, timeAxis.w, timeAxis.h)
      ctx.fillStyle = theme.axisBorder
      hLine(c, timeAxis.x, timeAxis.y, timeAxis.w)
      if (data.length === 0) return

      const lo = Math.max(0, Math.min(data.length - 1, Math.floor(c.i0)))
      const hi = Math.max(0, Math.min(data.length - 1, Math.ceil(c.i1)))
      const tt = times.get(data.t[data.at(lo)], data.t[data.at(hi)], plot.w, minGap)
      const n = Math.min(tt.length, MAX_TICKS)
      if (n === 0) return

      const majorFont = proseFont(theme.axisFontPx, 600, theme.font)
      const minorFont = monoFont(theme.axisFontPx, 600, theme.fontMono)
      const fontKey = majorFont + minorFont
      if (tt !== cacheKey || fontKey !== cacheFont) {
        cacheKey = tt
        cacheFont = fontKey
        for (let i = 0; i < n; i++) {
          ctx.font = tt[i].major ? majorFont : minorFont
          strs[i] = o.format(tt[i].t, tt[i].unit, tt[i].major)
          widths[i] = ctx.measureText(strs[i]).width
        }
      }

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const y = c.snap(timeAxis.y + timeAxis.h / 2)
      const left = plot.x
      const right = plot.x + plot.w

      for (let i = 0; i < n; i++) {
        const x = scales.xOf(indexAtTime(c, tt[i].t))
        const half = widths[i] / 2
        // Drop rather than clip: a label sliced by the axis edge looks broken.
        if (x - half < left || x + half > right) continue
        // A promoted label is a date and gets the prose stack and full ink; the
        // rest are clock times and stay mono and muted, so a dense axis has an
        // obvious rhythm instead of a wall of equal-weight numbers.
        ctx.font = tt[i].major ? majorFont : minorFont
        ctx.fillStyle = tt[i].major ? theme.ink : theme.muted
        ctx.fillText(strs[i], c.snap(x), y)
      }
    },
  }
}
