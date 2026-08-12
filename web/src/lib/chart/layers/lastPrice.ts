// The last-price line, its axis pill, and the bar-close countdown.
//
// z: this draws ABOVE the axes rather than at Z.lastPrice, and that is not a
// slip. The pill lives inside the price axis, and the axis layer fills its own
// background opaquely — at z 300 the pill would be painted over every frame and
// simply never appear. It still sits below the crosshair (900), which is the
// ordering that matters visually.
//
// The pill's ink is chosen by the background's computed LUMINANCE, not by "is
// this the up colour". That is what keeps it legible the moment a user switches
// on the colour-blind palette, where blue wants white ink and orange wants dark
// and neither of them is "up".
//
// The countdown is the cheapest credibility in the whole chart: fifteen lines,
// and TradingView has it where Robinhood does not.

import type { ChartLayer, RenderCtx } from '../types'
import { Z } from '../types'
import { formatCountdown, formatPriceForCanvas, precisionFromTick } from '../format'
import {
  barMsOf,
  inkOn,
  lastCloseOf,
  lastOpenTimeOf,
  monoFont,
  pillPath,
  px1,
  snapRect,
} from './shared'

export interface LastPriceOptions {
  format?: (p: number) => string
  tickSize?: number
  /** Bar-close countdown under the pill. */
  countdown?: boolean
  /** Bar duration in sim ms. Derived from the series when omitted. */
  barMs?: number
  /** Left inset of the pill's text. Must match the price axis's, or the pill's
   *  price sits off the ladder's left margin and reads as a separate element. */
  padLeft?: number
}

/** Gutter kept to the right of the pill so its glyphs never reach the screen
 *  edge. Small, but its absence was visible in review. */
const PILL_INSET_RIGHT = 4

/** Alpha 1 -> 0 over 220ms, easeOutCubic (§C.2). */
const FLASH_MS = 220
/** 4 CSS px on and off. The canvas transform is already dpr-scaled, so this is
 *  the `[4,4] x dpr` device-pixel pattern §E asks for. */
const DASH = [4, 4]
const NO_DASH: number[] = []

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

export function createLastPriceLayer(o: LastPriceOptions = {}): ChartLayer {
  const tickSize = o.tickSize && o.tickSize > 0 ? o.tickSize : 0.01
  const precision = precisionFromTick(tickSize)
  const padLeft = o.padLeft ?? 8
  let censor = false
  const fmt = o.format ?? ((p: number) => formatPriceForCanvas(p, precision, censor))

  let prevPrice = NaN
  let flash = 0
  let flashUp = true

  return {
    id: 'lastPrice',
    z: Z.axes + 50,
    // The flash decays and the countdown ticks on frames where nothing else has
    // changed, so this layer has to be asked for every one of them.
    volatile: true,
    cacheable: false,

    draw(c: RenderCtx) {
      const { ctx, theme, plot, priceAxis, scales, data } = c
      const price = lastCloseOf(c)
      if (!Number.isFinite(price) || priceAxis.w <= 0) return
      censor = theme.censor

      if (price !== prevPrice) {
        if (Number.isFinite(prevPrice)) {
          flash = theme.reducedMotion ? 0 : FLASH_MS
          flashUp = price > prevPrice
        }
        prevPrice = price
      }
      // Animated off c.dt, never the wall clock: a backgrounded tab resumes with
      // one huge frame, and Date.now() would make that frame skip the whole flash.
      if (flash > 0) flash = Math.max(0, flash - c.dt)

      const up = data.length > 0 && price >= data.o[data.at(data.length - 1)]
      const tone = up ? theme.up : theme.down
      const h = theme.axisFontPx + 8
      const yRaw = scales.yOf(price)
      const y = Math.max(plot.y + h / 2, Math.min(plot.y + plot.h - h / 2, yRaw))

      // Dashed leader from the newest candle to the pill. Stroked because it is
      // dashed — a dash pattern is the one thing a fill cannot express — but it
      // is a single horizontal hairline, so it snaps to a half device pixel and
      // stays as crisp as the filled ones.
      //
      // Anchored at the newest candle's LEFT body edge, not its centre. Review
      // caught the connector starting clear of the candle and floating: the
      // centre is the right price but the wrong place to begin a line, because
      // the body is drawn over it and the dash phase decides how much of the
      // first segment survives. Starting behind the body makes the run from
      // candle to pill continuous at every bar width and every dash phase.
      if (data.length > 0) {
        const x0 = scales.cx(data.length - 1) - scales.bodyW / 2
        ctx.save()
        ctx.globalAlpha = 0.45
        ctx.strokeStyle = tone
        ctx.lineWidth = px1(c)
        ctx.setLineDash(DASH)
        ctx.beginPath()
        const ly = Math.round(yRaw * c.dpr - 0.5) / c.dpr + px1(c) / 2
        ctx.moveTo(c.snap(x0), ly)
        ctx.lineTo(c.snap(priceAxis.x), ly)
        ctx.stroke()
        ctx.setLineDash(NO_DASH)
        ctx.restore()
      }

      // Sized to the gutter rather than over it: the left edge starts one device
      // pixel INSIDE the axis so it never covers the plot/axis divider, and the
      // right edge keeps a fixed inset so the glyphs cannot run to the screen
      // edge. Review read the old full-bleed pill as a badge stuck onto the
      // axis rather than a member of the ladder.
      const px = px1(c)
      const pillX = priceAxis.x + px
      const pillW = priceAxis.w - px - PILL_INSET_RIGHT

      // The flash is a wash behind the pill rather than a colour change on it:
      // recolouring the pill makes the price momentarily unreadable, which is
      // the opposite of what a flash is for. Kept to the pill's own column so
      // the halo cannot reach back over the divider the pill just cleared.
      if (flash > 0) {
        const a = 1 - easeOutCubic(1 - flash / FLASH_MS)
        ctx.save()
        ctx.globalAlpha = a * 0.35
        ctx.fillStyle = flashUp ? theme.up : theme.down
        snapRect(c, pillX, y - h / 2 - 3, pillW, h + 6)
        ctx.restore()
      }

      ctx.fillStyle = tone
      ctx.beginPath()
      pillPath(
        ctx,
        c.snap(pillX),
        c.snap(y - h / 2),
        c.snap(pillW),
        c.snap(h),
        4,
      )
      ctx.fill()

      // Same size and weight as the ladder labels it sits among. The filled
      // background is the highlight; the type does not also need to shout, and
      // when it did the pill read as foreign to the axis around it.
      ctx.fillStyle = inkOn(tone)
      ctx.font = monoFont(theme.axisFontPx, 600, theme.fontMono)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(fmt(price), priceAxis.x + padLeft, c.snap(y))

      // A countdown is a clock, not money — but it sits inside the price pill's
      // own furniture, and one stray digit there would make the privacy promise
      // "mostly" rather than "always". It hides with the price.
      if (o.countdown === false || theme.censor) return
      const barMs = o.barMs && o.barMs > 0 ? o.barMs : barMsOf(c)
      const open = lastOpenTimeOf(c)
      if (!Number.isFinite(barMs) || !Number.isFinite(open)) return
      const left = open + barMs - c.now
      if (!(left >= 0) || left > barMs) return
      const cy = y + h / 2 + 9
      if (cy > plot.y + plot.h) return
      ctx.fillStyle = theme.muted
      ctx.font = monoFont(10, 600, theme.fontMono)
      ctx.fillText(formatCountdown(left), priceAxis.x + padLeft, c.snap(cy))
    },
  }
}
