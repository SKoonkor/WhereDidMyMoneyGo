// The static-bitmap cache: what makes a fling free.
//
// Grid, volume, candles and indicators are a function of (data, viewport, theme)
// and nothing else, so they are painted once into a bitmap three plot-widths
// wide — one plot-width of bleed on each side — and every frame after that is a
// single `drawImage`. ~0.15ms regardless of how many candles are on screen,
// against ~1ms and rising to redraw them.
//
// During a 1000px fling at 120 visible bars that is about two repaints instead
// of forty.
//
// An HTMLCanvasElement rather than an OffscreenCanvas, deliberately: Safari was
// late to OffscreenCanvas, and a worker would buy nothing here because the blit
// has to happen on the compositing thread anyway.
//
// Three subtleties that are the whole reason this file is not ten lines:
//
//  1. THE BLIT OFFSET MUST BE A WHOLE DEVICE PIXEL. drawImage to a fractional
//     destination resamples, and resampling a chart full of 1px wicks turns the
//     entire plot soft — exactly the "hobby chart" look the bitmap exists to
//     protect. Snapping costs up to half a device pixel of position error, which
//     no one can see, and buys back perfect crispness.
//
//  2. THE FORMING BAR IS PATCHED, NOT REBUILT. Its close changes several times a
//     second, and rebuilding three plot-widths on every tick would cancel the
//     cache out. Instead the newest bars' column is cleared and repainted inside
//     the bitmap, so the live frame stays a pure blit and a crosshair move
//     redraws no layers at all.
//
//  3. THE PATCH COLUMN MUST BE WHOLE DEVICE PIXELS, AND MUST NOT REACH PAST THE
//     BARS IT REPAINTS. Both edges of it are compositing hazards, and both have
//     shipped as visible artifacts: a fractional edge is cleared at c² and
//     repainted at c, so it accumulates grid ink until it saturates into a
//     bright seam; an over-wide column erases a closed candle that the repaint
//     never redraws. See `patchTail`.

import type { Rect, Viewport } from './types'

/** Everything that can invalidate the bitmap, gathered so the check is one
 *  comparison per field rather than a scatter of booleans across the renderer. */
export interface CacheKey {
  /** Bar pitch in CSS px. Any change at all is a zoom, and a zoom is a repaint. */
  barW: number
  p0: number
  p1: number
  /** Leftmost visible logical bar. */
  i0: number
  span: number
  /** Bar count. A change here is a bar close. */
  len: number
  /** Bumped by the renderer on setTheme. */
  themeRev: number
  plotW: number
  /** Height of the PRICE pane. */
  plotH: number
  /**
   * Height of the volume pane, carried directly below the price pane inside the
   * same bitmap. 0 or absent when volume is off.
   *
   * The two panes share one bitmap rather than getting one each: volume is
   * cacheable for exactly the same reason the candles are, and a second bitmap
   * would double the blit count and the memory for a strip a fifth the height.
   */
  volumeH?: number
  dpr: number
}

export type StaleReason = '' | 'empty' | 'size' | 'zoom' | 'range' | 'bars' | 'theme' | 'pan'

/**
 * Paint callback. Receives the cache's own context, the WIDENED viewport the
 * bitmap covers, the bitmap's PRICE-pane rect, and the logical bar range to
 * draw. Anything the caller puts below that rect — the volume pane — is inside
 * the bitmap too and is cleared, patched and blitted along with it.
 *
 * The range is passed separately from the viewport because a patch draws a
 * two-bar slice into a bitmap whose viewport still spans three screens.
 */
export type CachePaint = (
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  plot: Rect,
  i0: number,
  i1: number,
) => void

/**
 * §C.1: the price range may drift 2% before the bitmap is considered wrong.
 * Without a deadband the autoscale spring's every step would be a repaint, which
 * is the opposite of the point.
 */
const RANGE_DEADBAND = 0.02

/** Bars repainted when the forming bar re-ticks. Two, not one: a polyline
 *  indicator needs its previous point to draw the final segment, and clearing a
 *  one-bar column would erase that segment with nothing to redraw it. */
const PATCH_BARS = 2

export interface StaticCache {
  /** False when there is no 2D context — jsdom, or a browser that refused one.
   *  The renderer must then draw the cacheable layers live. */
  readonly available: boolean
  readonly canvas: HTMLCanvasElement
  /** Why the next frame cannot simply blit, or '' if it can. */
  stale(k: CacheKey): StaleReason
  /** Repaint the whole bitmap for this key. */
  rebuild(k: CacheKey, paint: CachePaint): void
  /** Repaint just the newest bars in place. False if there is no bitmap to
   *  patch — the caller must rebuild instead. */
  patchTail(paint: CachePaint): boolean
  /** Copy the visible slice onto the live context. `dest` is the region the
   *  bitmap covers — the price pane plus the volume pane, if there is one. False
   *  if nothing is cached. */
  blit(dst: CanvasRenderingContext2D, dest: Rect, i0: number): boolean
  dispose(): void
}

/** One plot-width of bleed each side, so the bitmap is three wide. */
const WIDTH_MULTIPLE = 3

export function createStaticCache(doc: Document = document): StaticCache {
  const canvas = doc.createElement('canvas')
  const ctx = canvas.getContext('2d')

  // The key the bitmap currently holds. Null means nothing has been painted.
  let key: CacheKey | null = null
  // Logical bar index at the bitmap's left edge.
  let cacheI0 = 0
  let devW = 0
  let devH = 0

  /** The viewport the bitmap covers: three screens, same price band. */
  const cacheViewport = (k: CacheKey): Viewport => ({
    i0: k.i0 - k.span,
    span: k.span * WIDTH_MULTIPLE,
    p0: k.p0,
    p1: k.p1,
  })

  const cachePlot = (k: CacheKey): Rect => ({
    x: 0,
    y: 0,
    w: k.plotW * WIDTH_MULTIPLE,
    h: k.plotH,
  })

  /** Price pane plus volume pane: the bitmap's full height. Everything that
   *  sizes, clears or copies the bitmap works in THIS, not in plotH — a bitmap
   *  cut to the price pane would silently drop everything volume drew. */
  const paneH = (k: CacheKey): number => k.plotH + Math.max(0, k.volumeH ?? 0)

  const api: StaticCache = {
    available: ctx !== null,
    canvas,

    stale(k: CacheKey): StaleReason {
      if (!ctx) return 'empty'
      if (!key) return 'empty'
      // The split counts as a size change: a bitmap painted for one pane
      // division cannot be blitted into another, and the volume bars would land
      // at the wrong height under candles that were still right.
      if (k.plotW !== key.plotW || k.plotH !== key.plotH || k.dpr !== key.dpr) return 'size'
      if ((k.volumeH ?? 0) !== (key.volumeH ?? 0)) return 'size'
      if (k.themeRev !== key.themeRev) return 'theme'
      // Bar pitch is compared exactly. A zoom of even a fraction of a pixel per
      // bar would put every candle a little further off from the cached one, and
      // the error grows across the width.
      if (k.barW !== key.barW) return 'zoom'
      // A bar closed, so every bar's index shifted under the bitmap.
      if (k.len !== key.len) return 'bars'

      const range = Math.abs(key.p1 - key.p0)
      if (range > 0) {
        const drift = Math.max(Math.abs(k.p0 - key.p0), Math.abs(k.p1 - key.p1))
        if (drift > range * RANGE_DEADBAND) return 'range'
      } else if (k.p0 !== key.p0 || k.p1 !== key.p1) {
        return 'range'
      }

      // Has the pan run out of bleed? The visible window is [i0, i0+span] and
      // the bitmap covers [cacheI0, cacheI0 + 3*span].
      if (k.i0 < cacheI0 || k.i0 + k.span > cacheI0 + k.span * WIDTH_MULTIPLE) return 'pan'
      return ''
    },

    rebuild(k: CacheKey, paint: CachePaint) {
      if (!ctx) return
      const wantW = Math.round(k.plotW * WIDTH_MULTIPLE * k.dpr)
      const wantH = Math.round(paneH(k) * k.dpr)
      if (wantW <= 0 || wantH <= 0) {
        key = null
        return
      }

      if (wantW !== devW || wantH !== devH) {
        // Assigning width/height also clears the canvas, so this is both the
        // resize and the clear.
        canvas.width = wantW
        canvas.height = wantH
        devW = wantW
        devH = wantH
      } else {
        ctx.clearRect(0, 0, wantW, wantH)
      }
      // Once per repaint, never inside a draw — the same rule the live canvas
      // follows. Layers work in CSS px and know nothing about dpr.
      ctx.setTransform(k.dpr, 0, 0, k.dpr, 0, 0)

      cacheI0 = k.i0 - k.span
      const vp = cacheViewport(k)
      const plot = cachePlot(k)
      // Clipped to the whole bitmap: a layer that draws a little past its range
      // must not scribble outside the bitmap's bounds.
      const lo = Math.max(0, Math.floor(vp.i0))
      const hi = Math.min(k.len - 1, Math.ceil(vp.i0 + vp.span))
      paint(ctx, vp, plot, lo, hi)
      key = { ...k }
    },

    patchTail(paint: CachePaint): boolean {
      if (!ctx || !key) return false
      const k = key
      if (k.len <= 0) return false

      const vp = cacheViewport(k)
      const plot = cachePlot(k)
      const lo = Math.max(0, k.len - PATCH_BARS)
      const hi = k.len - 1

      // The column those bars occupy in bitmap space.
      //
      // The left edge is the CENTRE of the first repainted bar, and that is the
      // furthest left it may go: everything this clears has to be put back by
      // the paint call below, and that call draws bars lo..hi and nothing else.
      // Starting a bar and a half further left — which is what "widen it so a
      // fat body is fully inside" turned into — cleared the whole cell of bar
      // lo-1 and then redrew nothing there, so a closed candle three bars from
      // the right edge vanished on the first tick after every bar close and
      // stayed gone until the next full rebuild.
      //
      // The centre is also exactly where an indicator's incoming segment ends,
      // so nothing drawn for bars < lo is touched. That is what PATCH_BARS = 2
      // is for, and it only works if the column stops here.
      const barW = k.barW
      const left = plot.x + (lo - vp.i0 + 0.5) * barW
      // The right side may overhang freely: past the newest bar is the right
      // gap, which holds nothing but gridline, and the grid is repainted whole.
      const right = plot.x + (hi - vp.i0 + 1) * barW + barW
      if (right <= 0 || left >= plot.w) return true // forming bar is off the bitmap

      // SNAPPED OUTWARD TO WHOLE DEVICE PIXELS, and this is not cosmetic.
      //
      // `clearRect` is issued inside the clip, so on a partially-covered edge
      // pixel it is masked TWICE — once by its own antialiased edge and once by
      // the clip's — while the gridline painted immediately afterwards is masked
      // only by the clip. The pixel is emptied at coverage c² and refilled at
      // coverage c, so it cannot be emptied as fast as it is filled: it climbs
      // towards grid-alpha / c and, at the small coverages a fractional edge
      // actually produces, saturates near solid --ink after a few thousand ticks.
      //
      // What that looks like is a bright vertical seam at the newest bars, one
      // pixel wide, appearing ONLY where a gridline crosses it — the grid is the
      // only cached layer that paints the full width, so it is the only one that
      // deposits ink there — and byte-identical on every gridline row, because
      // every row accumulates by the same recurrence. Off the gridlines the
      // bitmap is transparent and nothing accumulates, which is why the seam is
      // invisible against the background and looks like four unrelated specks.
      //
      // On whole device pixels c is 0 or 1, the clear and the repaint agree
      // exactly, and the recurrence has nowhere to go.
      const x = Math.max(0, Math.floor(left * k.dpr) / k.dpr)
      const w = Math.min(plot.w, Math.ceil(right * k.dpr) / k.dpr) - x
      if (w <= 0) return true

      // Full pane height, both panes: the forming bar has a volume bar under it,
      // and clearing only the price pane would leave the old one standing.
      const columnH = paneH(k)
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, plot.y, w, columnH)
      ctx.clip()
      // Cleared rather than painted over: compositing a second 6%-alpha grid
      // line onto the first would leave a visibly darker band exactly where the
      // newest bars are.
      ctx.clearRect(x, plot.y, w, columnH)
      paint(ctx, vp, plot, lo, hi)
      ctx.restore()
      return true
    },

    blit(dst: CanvasRenderingContext2D, dest: Rect, i0: number): boolean {
      if (!ctx || !key || devW <= 0 || devH <= 0) return false
      const k = key
      const sw = Math.round(dest.w * k.dpr)
      const sh = Math.round(dest.h * k.dpr)
      // Whole device pixels, or drawImage resamples and every 1px wick goes soft.
      let sx = Math.round((i0 - cacheI0) * k.barW * k.dpr)
      // Clamped so a key that went stale between the check and the blit cannot
      // sample outside the bitmap and paint a transparent stripe.
      sx = Math.max(0, Math.min(devW - sw, sx))
      dst.drawImage(canvas, sx, 0, sw, sh, dest.x, dest.y, dest.w, dest.h)
      return true
    },

    dispose() {
      // Zero-sizing releases the backing store immediately rather than waiting
      // for the element to be collected; on a phone that bitmap is several MB.
      canvas.width = 0
      canvas.height = 0
      devW = 0
      devH = 0
      key = null
    },
  }
  return api
}
