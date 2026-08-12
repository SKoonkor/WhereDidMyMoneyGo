import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createStaticCache, type CacheKey, type CachePaint } from './offscreen'
import { createFakeCtx, type FakeCtx, type Op } from './testing/fakeCtx'

/**
 * Give every canvas created from here on a recording context.
 *
 * `stubCanvas` attaches to one element, but the cache creates its own canvas
 * internally and there is no seam to hand one in — so the stub goes on the
 * prototype and each element gets its own recorder.
 */
function stubAllCanvases(): { ctxFor(el: HTMLCanvasElement): FakeCtx; restore(): void } {
  const original = HTMLCanvasElement.prototype.getContext
  const byElement = new WeakMap<HTMLCanvasElement, FakeCtx>()

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value(this: HTMLCanvasElement, kind: string) {
      if (kind !== '2d') return null
      let f = byElement.get(this)
      if (!f) {
        f = createFakeCtx()
        byElement.set(this, f)
      }
      return f.ctx
    },
  })

  return {
    ctxFor(el) {
      const f = byElement.get(el)
      if (!f) throw new Error('canvas never asked for a 2d context')
      return f
    },
    restore() {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        writable: true,
        value: original,
      })
    },
  }
}

let stub: ReturnType<typeof stubAllCanvases>

beforeEach(() => {
  stub = stubAllCanvases()
})

afterEach(() => {
  stub.restore()
})

const KEY: CacheKey = {
  barW: 3,
  p0: 100,
  p1: 200,
  i0: 400,
  span: 100,
  len: 1000,
  themeRev: 1,
  plotW: 300,
  plotH: 200,
  dpr: 2,
}

/** Records what the cache asked to be painted. */
function recorder() {
  const calls: { i0: number; i1: number; vpI0: number; vpSpan: number; plotW: number }[] = []
  const paint: CachePaint = (_ctx, vp, plot, i0, i1) => {
    calls.push({ i0, i1, vpI0: vp.i0, vpSpan: vp.span, plotW: plot.w })
  }
  return { calls, paint }
}

describe('geometry', () => {
  it('is three plot-widths wide — one of bleed on each side', () => {
    // That bleed is the entire reason a fling is free: a pan inside it is one
    // drawImage rather than a repaint of every candle.
    const c = createStaticCache()
    const { paint, calls } = recorder()
    c.rebuild(KEY, paint)

    expect(c.canvas.width).toBe(Math.round(300 * 3 * 2))
    expect(c.canvas.height).toBe(Math.round(200 * 2))
    expect(calls[0].plotW).toBe(900)
    expect(calls[0].vpSpan).toBe(300)
    // Centred on the visible window, so there is a screen of slack either way.
    expect(calls[0].vpI0).toBe(300)
  })

  it('sets its transform once per repaint and never inside a draw', () => {
    const c = createStaticCache()
    const fake = stub.ctxFor(c.canvas)
    c.rebuild(KEY, recorder().paint)
    const transforms = fake.of('setTransform')
    expect(transforms.length).toBe(1)
    expect(transforms[0].a).toEqual([2, 0, 0, 2, 0, 0])
  })

  it('clips the painted range to the data it actually has', () => {
    const { paint, calls } = recorder()
    const c = createStaticCache()
    c.rebuild({ ...KEY, i0: 0, len: 40 }, paint)
    expect(calls[0].i0).toBe(0)
    expect(calls[0].i1).toBe(39)
  })

  it('refuses to size itself from a degenerate plot', () => {
    const c = createStaticCache()
    const { paint, calls } = recorder()
    c.rebuild({ ...KEY, plotW: 0 }, paint)
    expect(calls.length).toBe(0)
    expect(c.stale(KEY)).toBe('empty')
  })
})

describe('what forces a repaint', () => {
  let c: ReturnType<typeof createStaticCache>

  beforeEach(() => {
    c = createStaticCache()
    c.rebuild(KEY, recorder().paint)
  })

  it('is nothing at all when the frame has not changed', () => {
    expect(c.stale(KEY)).toBe('')
  })

  it('a bar-width change, because that is a zoom', () => {
    expect(c.stale({ ...KEY, barW: 3.01 })).toBe('zoom')
  })

  it('a bar close, because every index shifted under the bitmap', () => {
    expect(c.stale({ ...KEY, len: 1001 })).toBe('bars')
  })

  it('a theme change', () => {
    expect(c.stale({ ...KEY, themeRev: 2 })).toBe('theme')
  })

  it('a resize or a change of device pixel ratio', () => {
    expect(c.stale({ ...KEY, plotW: 320 })).toBe('size')
    expect(c.stale({ ...KEY, plotH: 240 })).toBe('size')
    expect(c.stale({ ...KEY, dpr: 3 })).toBe('size')
  })

  it('a price move past the 2% deadband, but not one inside it', () => {
    // Without the deadband every step of the autoscale spring would repaint
    // three screens of candles, which is the exact opposite of the point.
    expect(c.stale({ ...KEY, p0: 101, p1: 201 })).toBe('')
    expect(c.stale({ ...KEY, p0: 101.9, p1: 201.9 })).toBe('')
    expect(c.stale({ ...KEY, p0: 103, p1: 203 })).toBe('range')
  })

  it('a pan that runs out of the bleed, but not one inside it', () => {
    // The bitmap covers [300, 600]; the window is 100 wide.
    expect(c.stale({ ...KEY, i0: 310 })).toBe('')
    expect(c.stale({ ...KEY, i0: 499 })).toBe('')
    expect(c.stale({ ...KEY, i0: 299 })).toBe('pan')
    expect(c.stale({ ...KEY, i0: 501 })).toBe('pan')
  })

  it('a whole fling inside the bleed costs no repaints at all', () => {
    // §C.1's claim, checked: ~2 repaints across a 1000px fling instead of ~40.
    let repaints = 0
    for (let px = 0; px <= 1000; px += 8) {
      const k = { ...KEY, i0: KEY.i0 - px / KEY.barW }
      if (c.stale(k)) {
        repaints++
        c.rebuild(k, recorder().paint)
      }
    }
    expect(repaints).toBeLessThanOrEqual(3)
  })
})

describe('blitting', () => {
  it('copies the visible slice onto the live context', () => {
    const c = createStaticCache()
    c.rebuild(KEY, recorder().paint)
    const live = createFakeCtx()
    const plot = { x: 0, y: 0, w: 300, h: 200 }

    expect(c.blit(live.ctx, plot, KEY.i0)).toBe(true)
    const [img] = live.of('drawImage')
    // Source in device px, destination in CSS px — the live context already
    // carries the dpr transform, so a 1:1 copy needs the two to differ.
    expect(img.a).toEqual([600, 0, 600, 400, 0, 0, 300, 200])
  })

  it('lands the offset on a whole device pixel', () => {
    // drawImage to a fractional destination RESAMPLES, and resampling a plot
    // full of 1px wicks turns the whole thing soft — which is the exact look
    // the bitmap exists to prevent. Half a device pixel of position error is
    // the price, and nobody can see it.
    const c = createStaticCache()
    const key = { ...KEY, barW: 2.7315 }
    c.rebuild(key, recorder().paint)
    const live = createFakeCtx()

    for (let i = 0; i < 40; i++) {
      live.reset()
      c.blit(live.ctx, { x: 0, y: 0, w: 300, h: 200 }, key.i0 + i * 0.37)
      const [sx] = live.of('drawImage')[0].a
      expect(Number.isInteger(sx)).toBe(true)
    }
  })

  it('never samples off the edge of the bitmap', () => {
    // A key that goes stale between the check and the blit would otherwise
    // sample past the end and paint a transparent stripe down the plot.
    const c = createStaticCache()
    c.rebuild(KEY, recorder().paint)
    const live = createFakeCtx()

    for (const i0 of [-5000, 0, 400, 5000]) {
      live.reset()
      c.blit(live.ctx, { x: 0, y: 0, w: 300, h: 200 }, i0)
      const [sx, , sw] = live.of('drawImage')[0].a
      expect(sx).toBeGreaterThanOrEqual(0)
      expect(sx + sw).toBeLessThanOrEqual(c.canvas.width)
    }
  })

  it('says so when there is nothing cached yet', () => {
    const c = createStaticCache()
    const live = createFakeCtx()
    expect(c.blit(live.ctx, { x: 0, y: 0, w: 300, h: 200 }, 0)).toBe(false)
    expect(live.of('drawImage').length).toBe(0)
  })
})

describe('patching the forming bar', () => {
  it('repaints only the newest bars, not three screens of them', () => {
    // The forming candle re-ticks several times a second. Rebuilding for each
    // would cancel the cache out entirely.
    const c = createStaticCache()
    c.rebuild({ ...KEY, i0: 890 }, recorder().paint)
    const { paint, calls } = recorder()

    expect(c.patchTail(paint)).toBe(true)
    expect(calls.length).toBe(1)
    expect(calls[0].i1).toBe(999)
    // Two bars, not one: a polyline indicator needs its previous point to draw
    // the final segment, and a one-bar column would erase it with nothing to
    // put back.
    expect(calls[0].i0).toBe(998)
  })

  it('clears the column before repainting it', () => {
    const c = createStaticCache()
    c.rebuild({ ...KEY, i0: 890 }, recorder().paint)
    const fake = stub.ctxFor(c.canvas)
    fake.reset()
    c.patchTail(recorder().paint)

    // Clipped, cleared, painted, restored — compositing a second 6%-alpha grid
    // line onto the first leaves a visibly darker band over the newest bars.
    const kinds = fake.ops.map((o: Op) => o.op)
    expect(kinds).toContain('clip')
    expect(kinds).toContain('clearRect')
    expect(kinds.indexOf('clearRect')).toBeGreaterThan(kinds.indexOf('clip'))
    expect(fake.of('save').length).toBe(1)
    expect(fake.of('restore').length).toBe(1)
  })

  it('clears a column wide enough to hold the bars it repaints', () => {
    const c = createStaticCache()
    c.rebuild({ ...KEY, i0: 890 }, recorder().paint)
    const fake = stub.ctxFor(c.canvas)
    fake.reset()
    c.patchTail(recorder().paint)

    const [x, , w] = fake.of('clearRect')[0].a
    // Rebuilt at i0 = 890, and the bitmap's viewport starts a screen early, so
    // bar `i`'s left edge sits at (i - (890 - span)) * barW.
    const at = (i: number) => (i - (890 - KEY.span)) * KEY.barW
    // Covers the centre of the first repainted bar through the right edge of
    // the last one — everything the repaint will actually draw.
    expect(x).toBeLessThanOrEqual(at(998) + KEY.barW / 2 + 1e-9)
    expect(x + w).toBeGreaterThanOrEqual(at(999) + KEY.barW - 1e-9)
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x + w).toBeLessThanOrEqual(KEY.plotW * 3 + 1e-9)
  })

  it('never erases a bar it is not going to repaint', () => {
    // It used to start a bar and a half further left, which cleared the whole
    // cell of bar `lo - 1` and then redrew nothing there: a closed candle three
    // bars from the right edge disappeared on the first tick after every bar
    // close and only came back at the next full rebuild.
    const c = createStaticCache()
    c.rebuild({ ...KEY, i0: 890 }, recorder().paint)
    const fake = stub.ctxFor(c.canvas)
    fake.reset()
    c.patchTail(recorder().paint)

    const [x] = fake.of('clearRect')[0].a
    // Rebuilt at i0 = 890, and the bitmap's viewport starts a screen early.
    const at = (i: number) => (i - (890 - KEY.span)) * KEY.barW
    // Bar 997 is repainted by nobody, so not one pixel of its cell may be
    // cleared. Its cell is [at(997), at(998)].
    expect(x).toBeGreaterThanOrEqual(at(998) - 1e-9)
  })

  it('clips to exactly the rectangle it clears', () => {
    // If the two ever drift apart, the difference is a band that is painted
    // without having been cleared — which is the darker band the clear exists
    // to prevent, composited once per tick.
    const c = createStaticCache()
    c.rebuild({ ...KEY, i0: 890 }, recorder().paint)
    const fake = stub.ctxFor(c.canvas)
    fake.reset()
    c.patchTail(recorder().paint)
    expect(fake.of('rect')[0].a).toEqual(fake.of('clearRect')[0].a)
  })

  it('covers whole device pixels, so the column edge cannot accumulate ink', () => {
    // THE BRIGHT SEAM AT THE NEWEST BARS.
    //
    // `clearRect` runs inside the clip, so on a partially-covered edge pixel it
    // is masked twice — its own antialiased edge and the clip's — while the
    // gridline painted immediately after is masked only by the clip. Emptied at
    // c², refilled at c: with c < 1 the pixel gains ink every tick and climbs
    // towards grid-alpha / c, which for the small coverages a fractional edge
    // produces saturates near solid --ink. It shows up only where a gridline
    // crosses the column (the grid is the only cached layer painting the full
    // width) and byte-identical on every row, because every row runs the same
    // recurrence.
    //
    // Whole device pixels make c either 0 or 1, and the recurrence has nowhere
    // to go. Fractions here on purpose: a round barW hides the whole thing.
    for (const dpr of [1, 2, 3]) {
      for (const barW of [2.7315, 3.1, 1.618, 0.379]) {
        for (const i0 of [890.4, 890.37, 512.5]) {
          const c = createStaticCache()
          const key = { ...KEY, barW, i0, dpr }
          c.rebuild(key, recorder().paint)
          const fake = stub.ctxFor(c.canvas)
          fake.reset()
          c.patchTail(recorder().paint)
          const cleared = fake.of('clearRect')
          if (cleared.length === 0) continue

          const [x, , w] = cleared[0].a
          for (const edge of [x, x + w]) {
            const dev = edge * dpr
            expect(Math.abs(dev - Math.round(dev))).toBeLessThan(1e-9)
          }
        }
      }
    }
  })

  it('snaps the column outward, never inward', () => {
    // Outward: rounding the edge INTO the column would leave a device pixel that
    // the repaint draws over without having cleared it — the same compositing
    // fault, with the sign flipped.
    const dpr = 2
    const key = { ...KEY, barW: 2.7315, i0: 890.4, dpr }
    const c = createStaticCache()
    c.rebuild(key, recorder().paint)
    const fake = stub.ctxFor(c.canvas)
    fake.reset()
    c.patchTail(recorder().paint)

    const [x, , w] = fake.of('clearRect')[0].a
    const vpI0 = key.i0 - key.span
    const wantLeft = (998 - vpI0 + 0.5) * key.barW
    const wantRight = (999 - vpI0 + 1) * key.barW + key.barW
    expect(x).toBeLessThanOrEqual(wantLeft + 1e-9)
    expect(x).toBeGreaterThan(wantLeft - 1 / dpr)
    expect(x + w).toBeGreaterThanOrEqual(wantRight - 1e-9)
    expect(x + w).toBeLessThan(wantRight + 1 / dpr)
  })

  it('does nothing when the newest bar is not on the bitmap', () => {
    // Scrolled far back into history: there is no forming bar in the bleed to
    // patch, and clearing a column there would punch a hole in the candles.
    const c = createStaticCache()
    c.rebuild({ ...KEY, i0: 100 }, recorder().paint)
    const { paint, calls } = recorder()
    expect(c.patchTail(paint)).toBe(true)
    expect(calls.length).toBe(0)
  })

  it('reports failure when there is no bitmap to patch', () => {
    const c = createStaticCache()
    expect(c.patchTail(recorder().paint)).toBe(false)
  })
})

describe('when the browser will not give a context', () => {
  it('reports itself unavailable rather than throwing', () => {
    // jsdom is exactly this case, and so is a browser that has run out of
    // canvas memory. The renderer then draws the cacheable layers live.
    stub.restore()
    const c = createStaticCache()
    expect(c.available).toBe(false)
    expect(c.stale(KEY)).toBe('empty')
    expect(() => c.rebuild(KEY, recorder().paint)).not.toThrow()
    expect(c.patchTail(recorder().paint)).toBe(false)
    expect(c.blit(createFakeCtx().ctx, { x: 0, y: 0, w: 10, h: 10 }, 0)).toBe(false)
  })
})

describe('dispose', () => {
  it('releases the backing store, which is several MB on a phone', () => {
    const c = createStaticCache()
    c.rebuild(KEY, recorder().paint)
    expect(c.canvas.width).toBeGreaterThan(0)
    c.dispose()
    expect(c.canvas.width).toBe(0)
    expect(c.canvas.height).toBe(0)
    expect(c.stale(KEY)).toBe('empty')
  })

  it('is safe to call twice', () => {
    const c = createStaticCache()
    c.rebuild(KEY, recorder().paint)
    c.dispose()
    expect(() => c.dispose()).not.toThrow()
  })
})
