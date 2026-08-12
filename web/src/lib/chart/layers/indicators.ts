// Indicator overlays — moving averages, bands, histograms.
//
// The series arrive as ACCESSORS, not arrays, and that is the important design
// decision in this file. lib/trading/indicators.ts writes into a ring buffer, so
// there is no array whose index is the logical bar index; handing over `at(i)`
// lets the ring be read directly with no copy per frame. It also keeps the seam
// intact — lib/chart never imports lib/trading, so the layer describes the shape
// it needs and the app wires the two together.
//
// Drawn UNDER the candles (z 80) on purpose: an MA line over a candle body hides
// the one thing the chart exists to show.

import type { ChartLayer, RenderCtx } from '../types'
import { Z } from '../types'
import { pathRect, px1 } from './shared'

export interface IndicatorSeries {
  id: string
  kind: 'line' | 'band' | 'hist'
  color: string
  /** Band fill / negative histogram bars. Falls back to `color`. */
  color2?: string
  /** Stroke width in CSS px. */
  width?: number
  /** Value for a LOGICAL bar index, or NaN before the indicator is warm. */
  at(i: number): number
  upperAt?(i: number): number
  lowerAt?(i: number): number
}

export interface IndicatorLayerOptions {
  specs(): readonly IndicatorSeries[]
}

export function createIndicatorLayer(o: IndicatorLayerOptions): ChartLayer {
  /** Polyline of one series, skipping the NaN warm-up run rather than drawing a
   *  line from zero — a hook up from the bottom-left is the classic tell that an
   *  indicator was plotted before it was ready. */
  function line(c: RenderCtx, get: (i: number) => number): void {
    const { ctx, scales } = c
    let open = false
    for (let i = c.i0; i <= c.i1; i++) {
      const v = get(i)
      if (!Number.isFinite(v)) {
        open = false
        continue
      }
      const x = scales.cx(i)
      const y = scales.yOf(v)
      if (open) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
      open = true
    }
  }

  return {
    id: 'indicators',
    z: Z.indicators,
    volatile: false,
    // Pure function of (data, viewport, theme) — belongs in the cached bitmap
    // with the candles, which is what makes a fling free.
    cacheable: true,

    draw(c: RenderCtx) {
      const specs = o.specs()
      if (specs.length === 0 || c.data.length === 0 || c.i1 < c.i0) return
      const { ctx, scales } = c

      for (let n = 0; n < specs.length; n++) {
        const s = specs[n]

        if (s.kind === 'hist') {
          const base = scales.yOf(0)
          const half = scales.bodyW / 2
          const d1 = px1(c)
          // Two passes by sign, same batching rule as the candles.
          for (let pass = 0; pass < 2; pass++) {
            ctx.fillStyle = pass === 0 ? s.color : s.color2 ?? s.color
            ctx.beginPath()
            for (let i = c.i0; i <= c.i1; i++) {
              const v = s.at(i)
              if (!Number.isFinite(v)) continue
              if ((v >= 0) !== (pass === 0)) continue
              const y = scales.yOf(v)
              const top = Math.min(y, base)
              const h = Math.max(Math.abs(y - base), d1)
              pathRect(c, scales.cx(i) - half, top, scales.bodyW, h)
            }
            ctx.fill()
          }
          continue
        }

        if (s.kind === 'band' && s.upperAt && s.lowerAt) {
          // The band is a fill between the two edges; the mid line is drawn by
          // registering the same series again as a 'line', which keeps this
          // branch from needing a third stroke style.
          ctx.save()
          ctx.globalAlpha = 0.1
          ctx.fillStyle = s.color2 ?? s.color
          ctx.beginPath()
          let open = false
          for (let i = c.i0; i <= c.i1; i++) {
            const v = s.upperAt(i)
            if (!Number.isFinite(v)) continue
            const x = scales.cx(i)
            const y = scales.yOf(v)
            if (open) ctx.lineTo(x, y)
            else ctx.moveTo(x, y)
            open = true
          }
          for (let i = c.i1; i >= c.i0; i--) {
            const v = s.lowerAt(i)
            if (!Number.isFinite(v)) continue
            ctx.lineTo(scales.cx(i), scales.yOf(v))
          }
          if (open) ctx.fill()
          ctx.restore()

          ctx.strokeStyle = s.color
          ctx.lineWidth = s.width ?? px1(c)
          ctx.beginPath()
          line(c, s.upperAt)
          line(c, s.lowerAt)
          ctx.stroke()
          continue
        }

        ctx.strokeStyle = s.color
        ctx.lineWidth = s.width ?? c.snap(1.25)
        ctx.lineJoin = 'round'
        ctx.beginPath()
        line(c, s.at)
        ctx.stroke()
      }
    },
  }
}
