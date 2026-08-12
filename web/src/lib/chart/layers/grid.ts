// The grid.
//
// The whole design brief for this layer is RESTRAINT. A grid strong enough to
// read as lines reads as a spreadsheet; TradingView's is barely there and that
// is why the candles look like the subject of the picture. So: horizontals only
// by default, one device pixel, at the theme's 6%-of-ink alpha, and verticals
// only where the time axis promotes a label — never a full lattice.
//
// It shares its price ladder with the price-axis layer through identical
// arguments to `priceTicks`, so a gridline and its label can never disagree.

import type { ChartLayer, RenderCtx } from '../types'
import { Z } from '../types'
import { PriceTickCache, TimeTickCache, indexAtTime, pathRect, px1 } from './shared'

export interface GridOptions {
  /** The instrument's tick size — the ladder is snapped to it so no gridline
   *  ever sits at a price the instrument cannot trade at. */
  tickSize?: number
  /** Verticals at major time boundaries. On by default: a day boundary with no
   *  line under its label makes a dense intraday axis hard to scan. */
  verticals?: boolean
}

/** Matches the price axis exactly — 34px is the touch-legible minimum gap and
 *  7 labels is the point past which an axis reads as noise. */
export const PRICE_TICK_GAP = 34
export const PRICE_TICK_MAX = 7
/** 64px, so labels never crowd. Shared with the time-axis layer. */
export const TIME_TICK_GAP = 64

export function createGridLayer(o: GridOptions = {}): ChartLayer {
  const tickSize = o.tickSize && o.tickSize > 0 ? o.tickSize : 0.01
  const verticals = o.verticals !== false
  const prices = new PriceTickCache()
  const times = new TimeTickCache()
  // Snapped y of each horizontal, ascending. Preallocated — the verticals need
  // to know where the horizontals are, and draw() may not allocate.
  const rowY = new Float64Array(PRICE_TICK_MAX)

  return {
    id: 'grid',
    z: Z.grid,
    volatile: false,
    // Purely (data, viewport, theme) — exactly what the cached bitmap is for.
    cacheable: true,

    draw(c: RenderCtx) {
      const { plot, scales, theme, ctx } = c
      if (plot.w <= 0 || plot.h <= 0) return

      const p0 = scales.pOf(plot.y + plot.h)
      const p1 = scales.pOf(plot.y)
      const ticks = prices.get(p0, p1, plot.h, PRICE_TICK_GAP, tickSize, PRICE_TICK_MAX)

      const d1 = px1(c)
      const bottom = plot.y + plot.h

      // Horizontals, batched into one path. Rows are collected ascending on the
      // way through because the verticals below have to step around them.
      let rows = 0
      ctx.fillStyle = theme.grid
      ctx.beginPath()
      for (let i = ticks.length - 1; i >= 0; i--) {
        const y = scales.yOf(ticks[i])
        // A line half off the plot reads as a rendering bug, so drop it rather
        // than clip it — the axis drops the matching label on the same rule.
        if (y < plot.y || y > bottom) continue
        const sy = c.snap(y)
        rowY[rows++] = sy
        pathRect(c, plot.x, sy, plot.w, d1)
      }
      ctx.fill()

      if (!verticals || c.data.length === 0) return
      const t0 = c.data.t[c.data.at(Math.max(0, Math.floor(c.i0)))]
      const t1 = c.data.t[c.data.at(Math.max(0, Math.min(c.data.length - 1, Math.ceil(c.i1))))]
      const tt = times.get(t0, t1, plot.w, TIME_TICK_GAP)

      // gridMajor is the boundary token; the plain `grid` colour here would make
      // the verticals as loud as the horizontals and turn the plot into graph
      // paper.
      //
      // Each vertical is drawn as SEGMENTS that step over every horizontal row,
      // so no pixel of the grid is ever painted twice. That is not tidiness: a
      // 4% vertical laid across a 6% horizontal composites to ~10%, which makes
      // the crossings the brightest marks on the grid while carrying no
      // information at all. A blind review found exactly that — "the brightest
      // thing on the grid and it means nothing" — reading as a stray artifact
      // repeating once per gridline row. The 1px gap the skip leaves in a 4%
      // line is invisible; the double-painted crossing was not.
      ctx.fillStyle = theme.gridMajor
      ctx.beginPath()
      for (let i = 0; i < tt.length; i++) {
        if (!tt[i].major) continue
        const x = scales.xOf(indexAtTime(c, tt[i].t))
        if (x < plot.x || x > plot.x + plot.w) continue
        let top = plot.y
        for (let r = 0; r < rows; r++) {
          if (rowY[r] > top) pathRect(c, x, top, d1, rowY[r] - top)
          top = rowY[r] + d1
        }
        if (bottom > top) pathRect(c, x, top, d1, bottom - top)
      }
      ctx.fill()
    },
  }
}
