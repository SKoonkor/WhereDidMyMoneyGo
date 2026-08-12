// Entry, liquidation, take-profit, stop and working-order lines.
//
// These are the elements that turn a price chart into a POSITION, and the
// liquidation line in particular is the one a critic looks for: it is the
// difference between a chart with a trade drawn on it and a trading screen.
//
// Lines are pulled through a callback rather than pushed into the layer, so the
// layer never holds a copy that can go stale — the broker's position list is the
// only source of truth and it is read once per frame.

import type { ChartLayer, RenderCtx } from '../types'
import { Z } from '../types'
import { formatPriceForCanvas, precisionFromTick } from '../format'
import { inkOn, maskDigits, monoFont, px1, snapRect } from './shared'

export type PriceLineTone = 'entry' | 'liq' | 'tp' | 'sl' | 'order'

export interface PriceLine {
  price: number
  /** Prose, from the app's i18n — "Entry", "Liq.", "TP". The price is appended
   *  here so it goes through the one censor-aware formatter. */
  label: string
  tone: PriceLineTone
  dashed: boolean
}

export interface PositionLinesOptions {
  lines(): readonly PriceLine[]
  tickSize?: number
}

const DASH = [5, 4]
const NO_DASH: number[] = []

export function createPositionLinesLayer(o: PositionLinesOptions): ChartLayer {
  const tickSize = o.tickSize && o.tickSize > 0 ? o.tickSize : 0.01
  const precision = precisionFromTick(tickSize)

  function toneColor(t: PriceLineTone, c: RenderCtx): string {
    const th = c.theme
    // Liquidation and stop both mean "you lose here", so both take the expense
    // colour; entry is neutral-accent because it is a fact, not a warning.
    if (t === 'liq' || t === 'sl') return th.down
    if (t === 'tp') return th.up
    if (t === 'entry') return th.accent
    return th.neutral
  }

  return {
    id: 'positionLines',
    z: Z.positionLines,
    volatile: false,
    cacheable: false,

    draw(c: RenderCtx) {
      const lines = o.lines()
      if (lines.length === 0 || c.plot.w <= 0) return
      const { ctx, theme, plot, scales } = c
      const h = theme.axisFontPx + 8

      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const y = scales.yOf(line.price)
        // Off-plot lines are dropped, not clamped: a liquidation line pinned to
        // the top edge would claim a price that is nowhere near the truth.
        if (y < plot.y || y > plot.y + plot.h) continue
        const col = toneColor(line.tone, c)

        ctx.save()
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = col
        ctx.lineWidth = px1(c)
        if (line.dashed) ctx.setLineDash(DASH)
        ctx.beginPath()
        const ly = Math.round(y * c.dpr - 0.5) / c.dpr + px1(c) / 2
        ctx.moveTo(plot.x, ly)
        ctx.lineTo(plot.x + plot.w, ly)
        ctx.stroke()
        if (line.dashed) ctx.setLineDash(NO_DASH)
        ctx.restore()

        const text = (theme.censor ? maskDigits(line.label) : line.label)
          + ' '
          + formatPriceForCanvas(line.price, precision, theme.censor)
        ctx.font = monoFont(theme.axisFontPx, 600, theme.fontMono)
        const w = ctx.measureText(text).width + 12
        const x = plot.x + 8
        ctx.fillStyle = col
        snapRect(c, x, y - h / 2, w, h)
        ctx.fillStyle = inkOn(col)
        ctx.fillText(text, x + 6, c.snap(y))
      }
    },
  }
}
