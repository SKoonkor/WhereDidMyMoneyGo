// The right-hand price axis.
//
// Two details here are worth more than everything else in the file:
//
//  1. Decimals come from the instrument's TICK SIZE, never from the value. Every
//     label on the axis therefore carries the same number of decimals and the
//     column has a straight decimal point. Deriving precision per value is the
//     classic mistake that produces "43,200 / 43,187.5 / 43,175" — ragged, and
//     it reads as amateur before you can say why.
//  2. It HIDES any grid label within 18px of the last-price pill. Two labels
//     overlapping in a price axis is the single most common tell in a hobby
//     chart, and the fix is four lines.
//
// The pill's position is derived here from the same series the last-price layer
// derives it from, rather than handed over: the two layers draw at different z,
// so a passed value would always be one frame stale and the suppression would
// visibly flicker as the price moved.

import type { ChartLayer, RenderCtx } from '../types'
import { Z } from '../types'
import { formatPriceForCanvas, precisionFromTick } from '../format'
import { PRICE_TICK_GAP, PRICE_TICK_MAX } from './grid'
import { LabelCache, PriceTickCache, lastCloseOf, monoFont, snapRect, vLine } from './shared'

export interface PriceAxisOptions {
  /** Overrides the built-in formatter. The default is the right one — it is the
   *  same censor-aware, width-stable formatter every other number uses. */
  format?: (p: number) => string
  tickSize?: number
  /** Left padding inside the axis. Fixed at 8px by §E. */
  padLeft?: number
  /** Suppression radius around the last-price pill. */
  pillClear?: number
}

/** Vertical clearance the last-price pill demands from any grid label. */
export const PILL_CLEAR = 18

export function createPriceAxisLayer(
  o: PriceAxisOptions = {},
): ChartLayer & { desiredWidth(): number } {
  const tickSize = o.tickSize && o.tickSize > 0 ? o.tickSize : 0.01
  const precision = precisionFromTick(tickSize)
  const padLeft = o.padLeft ?? 8
  const clear = o.pillClear ?? PILL_CLEAR
  const ticks = new PriceTickCache()
  const labels = new LabelCache()
  let censor = false

  const fmt = o.format ?? ((p: number) => formatPriceForCanvas(p, precision, censor))

  return {
    id: 'priceAxis',
    z: Z.axes,
    // The labels ride the autoscale spring, so they move on frames where neither
    // the data nor the viewport changed.
    volatile: true,
    cacheable: false,

    /** Widest label + 16px, per §E. The renderer sizes the axis from this. */
    desiredWidth() {
      return labels.maxWidth + 16
    },

    draw(c: RenderCtx) {
      const { ctx, theme, plot, priceAxis, scales } = c
      if (priceAxis.w <= 0 || plot.h <= 0) return

      ctx.fillStyle = theme.axisBg
      snapRect(c, priceAxis.x, priceAxis.y, priceAxis.w, priceAxis.h)
      ctx.fillStyle = theme.axisBorder
      vLine(c, priceAxis.x, priceAxis.y, priceAxis.h)

      const p0 = scales.pOf(plot.y + plot.h)
      const p1 = scales.pOf(plot.y)
      const set = ticks.get(p0, p1, plot.h, PRICE_TICK_GAP, tickSize, PRICE_TICK_MAX)
      if (set.length === 0) return

      censor = theme.censor
      ctx.font = monoFont(theme.axisFontPx, 600, theme.fontMono)
      // Keyed on the tick array's identity: PriceTickCache hands back the same
      // instance while the ladder is unchanged, so this re-measures on a zoom
      // and never on a plain repaint. measureText costs as much as fillText.
      labels.sync(set, theme.censor, set, set.length, fmt, ctx)

      const pillY = scales.yOf(lastCloseOf(c))
      const hasPill = Number.isFinite(pillY)

      ctx.fillStyle = theme.muted
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const x = priceAxis.x + padLeft
      for (let i = 0; i < set.length; i++) {
        const y = scales.yOf(set[i])
        // Half a label hanging off the top edge looks like a clipping bug, so
        // the label is dropped rather than clamped.
        if (y - theme.axisFontPx / 2 < plot.y || y + theme.axisFontPx / 2 > plot.y + plot.h) continue
        if (hasPill && Math.abs(y - pillY) < clear) continue
        ctx.fillText(labels.label(set[i]), x, c.snap(y))
      }
    },
  }
}
