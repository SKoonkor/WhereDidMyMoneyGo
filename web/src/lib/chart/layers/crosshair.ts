// The crosshair: two hairlines and the two axis pills that read them off.
//
// The OHLC readout that belongs to this gesture lives in legend.ts — same
// information, but it is drawn at the plot's top-left whether or not a crosshair
// is up (falling back to the newest bar), which is how every real trading app
// behaves and is what makes a screenshot with no pointer in it still look like
// a trading app.
//
// Two things here are mobile-specific and both are commonly missed:
//
//  * The crosshair sits `touchOffsetY` above the finger (44px on touch, 0 on a
//    mouse). Drawn under the finger it is simply invisible on a phone, which is
//    the most common mobile-chart failure there is.
//  * The y magnetises to the bar's close within 12px. Without it, reading the
//    close off a chart on a phone is a game of millimetres.
//
// The position itself is NEVER smoothed — a crosshair that lags the finger feels
// broken. Only the magnet snap animates, over 90ms.

import type { ChartLayer, RenderCtx } from '../types'
import { Z } from '../types'
import { formatPriceForCanvas, precisionFromTick } from '../format'
import { inkOn, monoFont, pillPath, px1 } from './shared'

export interface CrosshairOptions {
  formatPrice?: (p: number) => string
  /** The app owns date formatting: it is the only part that knows the language. */
  formatTime: (t: number) => string
  /** 44 on touch, 0 on mouse. */
  touchOffsetY: number
  tickSize?: number
}

/** Distance within which the crosshair sticks to the bar's close. */
const MAGNET_PX = 12
/** easeOutQuad over 90ms when the snapped bar changes (§C.2). */
const SNAP_MS = 90
const DASH = [2, 3]
const NO_DASH: number[] = []

const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t)

export function createCrosshairLayer(o: CrosshairOptions): ChartLayer {
  const tickSize = o.tickSize && o.tickSize > 0 ? o.tickSize : 0.01
  const precision = precisionFromTick(tickSize)
  let censor = false
  const fmtP = o.formatPrice ?? ((p: number) => formatPriceForCanvas(p, precision, censor))

  let animFrom = NaN
  let animTo = NaN
  let animMs = 0

  // Hoisted out of draw() deliberately: a function expression inside draw is an
  // allocation, sixty times a second, for no reason.
  function xNow(): number {
    if (!(animMs > 0) || !Number.isFinite(animFrom)) return animTo
    return animFrom + (animTo - animFrom) * easeOutQuad(1 - animMs / SNAP_MS)
  }

  return {
    id: 'crosshair',
    z: Z.crosshair,
    volatile: true,
    cacheable: false,

    draw(c: RenderCtx) {
      const ch = c.interaction.crosshair
      if (!ch) {
        animMs = 0
        animFrom = NaN
        animTo = NaN
        return
      }
      const { ctx, theme, plot, priceAxis, timeAxis, scales, data } = c
      if (data.length === 0) return
      censor = theme.censor

      const i = Math.max(0, Math.min(data.length - 1, Math.round(ch.i)))
      const target = scales.cx(i)
      if (target !== animTo) {
        animFrom = Number.isFinite(animFrom) ? xNow() : target
        animTo = target
        animMs = theme.reducedMotion ? 0 : SNAP_MS
      } else if (animMs > 0) {
        animMs = Math.max(0, animMs - c.dt)
      }
      const x = xNow()

      // Magnetise to the close, then lift the whole readout clear of the finger.
      const close = data.c[data.at(i)]
      const closeY = scales.yOf(close)
      let y = ch.y - o.touchOffsetY
      if (Math.abs(y - closeY) < MAGNET_PX) y = closeY
      y = Math.max(plot.y, Math.min(plot.y + plot.h, y))
      const price = scales.pOf(y)

      ctx.save()
      ctx.globalAlpha = 0.35
      ctx.strokeStyle = theme.crosshair
      ctx.lineWidth = px1(c)
      ctx.setLineDash(DASH)
      ctx.beginPath()
      // Half a device pixel off the grid line the stroke straddles, so a 1px
      // dashed line covers exactly one row of pixels instead of two at 50%.
      const hx = Math.round(x * c.dpr - 0.5) / c.dpr + px1(c) / 2
      const hy = Math.round(y * c.dpr - 0.5) / c.dpr + px1(c) / 2
      ctx.moveTo(hx, plot.y)
      ctx.lineTo(hx, plot.y + plot.h)
      ctx.moveTo(plot.x, hy)
      ctx.lineTo(plot.x + plot.w, hy)
      ctx.stroke()
      ctx.setLineDash(NO_DASH)
      ctx.restore()

      ctx.font = monoFont(theme.labelFontPx, 600, theme.fontMono)
      ctx.textBaseline = 'middle'

      // Both readouts change on every pointer move, so these two measureText
      // calls are the one place in the chart where caching would buy nothing.
      if (priceAxis.w > 0) {
        const s = fmtP(price)
        const h = theme.labelFontPx + 9
        const py = Math.max(plot.y + h / 2, Math.min(plot.y + plot.h - h / 2, y))
        ctx.fillStyle = theme.pillBg
        ctx.beginPath()
        pillPath(ctx, c.snap(priceAxis.x), c.snap(py - h / 2), c.snap(priceAxis.w), c.snap(h), 4)
        ctx.fill()
        ctx.fillStyle = theme.pillInk || inkOn(theme.pillBg)
        ctx.textAlign = 'left'
        ctx.fillText(s, priceAxis.x + 8, c.snap(py))
      }

      if (timeAxis.h > 0) {
        const s = o.formatTime(data.t[data.at(i)])
        const w = ctx.measureText(s).width + 16
        const h = Math.min(timeAxis.h - 4, theme.labelFontPx + 9)
        let tx = x - w / 2
        // Clamped rather than dropped: a time pill is the answer to the gesture
        // the user is making right now, so it has to stay on screen.
        tx = Math.max(plot.x, Math.min(plot.x + plot.w - w, tx))
        const ty = timeAxis.y + (timeAxis.h - h) / 2
        ctx.fillStyle = theme.pillBg
        ctx.beginPath()
        pillPath(ctx, c.snap(tx), c.snap(ty), c.snap(w), c.snap(h), 4)
        ctx.fill()
        ctx.fillStyle = theme.pillInk || inkOn(theme.pillBg)
        ctx.textAlign = 'center'
        ctx.fillText(s, c.snap(tx + w / 2), c.snap(ty + h / 2))
      }
    },
  }
}
