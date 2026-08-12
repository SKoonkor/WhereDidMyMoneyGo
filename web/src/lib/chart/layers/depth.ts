// The depth spine — order-book size as horizontal bars down the plot's right
// edge, at 18% alpha.
//
// It carries no text at all, deliberately. The book is peripheral information:
// the shape of it (where the wall is) is the entire message, and numbers there
// would compete with the price axis six pixels away for no gain.
//
// The book type is declared structurally rather than imported. lib/chart never
// imports lib/trading — that seam is what lets the chart be built and judged
// before the market engine exists — so the layer describes the shape it needs
// and the real `OrderBook` satisfies it without either side naming the other.

import type { ChartLayer, RenderCtx } from '../types'
import { Z } from '../types'
import { pathRect, px1 } from './shared'

export interface BookLevelLike {
  p: number
  q: number
}

export interface OrderBookLike {
  bids: readonly BookLevelLike[]
  asks: readonly BookLevelLike[]
}

export interface DepthOptions {
  /** Returns the SAME object mutated in place — the market engine rebuilds the
   *  book rather than reallocating it. Read it, never keep it. */
  book(): OrderBookLike | undefined
  widthPx?: number
  alpha?: number
}

export function createDepthLayer(o: DepthOptions): ChartLayer {
  const width = o.widthPx ?? 64
  const alpha = o.alpha ?? 0.18

  function pass(c: RenderCtx, levels: readonly BookLevelLike[], peak: number, right: number, h: number): void {
    const { scales, plot } = c
    for (let i = 0; i < levels.length; i++) {
      const y = scales.yOf(levels[i].p)
      if (y < plot.y || y > plot.y + plot.h) continue
      const w = (levels[i].q / peak) * width
      if (!(w > 0)) continue
      pathRect(c, right - w, y - h / 2, w, h)
    }
  }

  return {
    id: 'depth',
    z: Z.positionLines + 20,
    // The book is rebuilt continuously; there is no cheap dirty check for it.
    volatile: true,
    cacheable: false,

    draw(c: RenderCtx) {
      const book = o.book()
      if (!book || c.plot.w <= 0) return
      const { ctx, theme, plot } = c

      let peak = 0
      for (let i = 0; i < book.bids.length; i++) if (book.bids[i].q > peak) peak = book.bids[i].q
      for (let i = 0; i < book.asks.length; i++) if (book.asks[i].q > peak) peak = book.asks[i].q
      if (!(peak > 0)) return

      // One device pixel of gap between rows, so a deep book reads as a ladder
      // rather than a solid block.
      const h = Math.max(px1(c) * 2, plot.h / 90)
      const right = plot.x + plot.w
      const prev = ctx.globalAlpha
      ctx.globalAlpha = alpha

      ctx.fillStyle = theme.up
      ctx.beginPath()
      pass(c, book.bids, peak, right, h)
      ctx.fill()

      ctx.fillStyle = theme.down
      ctx.beginPath()
      pass(c, book.asks, peak, right, h)
      ctx.fill()

      ctx.globalAlpha = prev
    },
  }
}
