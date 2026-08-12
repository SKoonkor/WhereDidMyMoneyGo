import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createChart, type ChartController } from './renderer'
import { themeFromCss } from './theme'
import { createStaticCache, type CacheKey } from './offscreen'
import { createFakeCtx, unsnappedRects, type FakeCtx, type Op } from './testing/fakeCtx'
import type { ChartLayer, ChartOptions, OhlcvColumns, Rect, RenderCtx } from './types'

// ── Harness ─────────────────────────────────────────────────────────────────

/**
 * Every canvas gets its own recording context.
 *
 * The engine creates a second canvas internally for the static bitmap, so a
 * per-element stub is the only way to test the cache path AND read the live
 * canvas's ops without the two logs running together.
 */
function stubAllCanvases() {
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
    ctxFor: (el: HTMLCanvasElement) => byElement.get(el),
    restore: () =>
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        writable: true,
        value: original,
      }),
  }
}

/** A hand-driven rAF, because jsdom's never usefully fires. */
function stubRaf() {
  const pending = new Map<number, FrameRequestCallback>()
  let next = 1
  const request = vi.fn((cb: FrameRequestCallback) => {
    const id = next++
    pending.set(id, cb)
    return id
  })
  const cancel = vi.fn((id: number) => {
    pending.delete(id)
  })
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  return {
    request,
    cancel,
    get scheduled() {
      return pending.size
    },
    /** Run every queued callback once. */
    flush(t: number) {
      const due = [...pending.entries()]
      pending.clear()
      for (const [, cb] of due) cb(t)
    },
  }
}

/** A synthetic series laid out like the real ring buffer (logical 0 = oldest). */
function series(n: number, base = 100, rev = 1): OhlcvColumns {
  const o = new Float64Array(n)
  const h = new Float64Array(n)
  const l = new Float64Array(n)
  const c = new Float64Array(n)
  const v = new Float64Array(n)
  const t = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    // A gentle deterministic wobble — enough for autoRange to have work to do.
    const p = base + Math.sin(i / 7) * 5
    o[i] = p
    h[i] = p + 1
    l[i] = p - 1
    c[i] = p + 0.5
    v[i] = 1000 + i
    t[i] = i * 60_000
  }
  return { length: n, t, o, h, l, c, v, at: (i) => i, rev }
}

/**
 * The same series with the newest bar's high pushed `delta` above the visible
 * high — i.e. a move that autoRange is guaranteed to actually see.
 *
 * Adding delta to whatever h[last] happened to be would usually change nothing
 * at all: the last bar is rarely the highest one on screen, so the visible
 * maximum, and therefore the autoscale target, would be unmoved.
 */
function nudged(s: OhlcvColumns, delta: number, rev: number): OhlcvColumns {
  const h = Float64Array.from(s.h)
  let visibleMax = -Infinity
  for (let i = Math.max(0, s.length - 150); i < s.length; i++) visibleMax = Math.max(visibleMax, s.h[i])
  h[s.length - 1] = visibleMax + delta
  return { ...s, h, rev }
}

function options(over: Partial<ChartOptions> = {}): ChartOptions {
  const el = document.createElement('div')
  return {
    theme: themeFromCss(el, false, false),
    tickSize: 0.01,
    pricePrecision: 2,
    minSpan: 12,
    maxSpan: 2000,
    rightGapFrac: 0.12,
    volumeFrac: 0.16,
    priceAxisMinW: 56,
    timeAxisH: 26,
    ...over,
  }
}

/** A layer that records how it was called. */
function probeLayer(
  id: string,
  z: number,
  flags: { volatile?: boolean; cacheable?: boolean } = {},
) {
  const calls: {
    i0: number
    i1: number
    plotW: number
    plotH: number
    plotY: number
    vol: Rect | null
    dt: number
  }[] = []
  const order: string[] = []
  const layer: ChartLayer = {
    id,
    z,
    volatile: flags.volatile ?? false,
    cacheable: flags.cacheable ?? false,
    draw(c: RenderCtx) {
      calls.push({
        i0: c.i0,
        i1: c.i1,
        plotW: c.plot.w,
        plotH: c.plot.h,
        plotY: c.plot.y,
        // Copied, not referenced: the renderer hands out one preallocated rect
        // and mutates it, so a stored reference would report the LAST layout.
        vol: c.volumePane ? { ...c.volumePane } : null,
        dt: c.dt,
      })
      order.push(id)
    },
    dispose: vi.fn(),
  }
  return { layer, calls, order }
}

let stub: ReturnType<typeof stubAllCanvases>
let raf: ReturnType<typeof stubRaf>
let canvas: HTMLCanvasElement
let chart: ChartController | null = null

beforeEach(() => {
  stub = stubAllCanvases()
  raf = stubRaf()
  canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
})

afterEach(() => {
  chart?.destroy()
  chart = null
  canvas.remove()
  stub.restore()
  vi.unstubAllGlobals()
})

/** A chart already sized and holding data, the state most tests want. */
function mounted(over: Partial<ChartOptions> = {}, bars = 400, dpr = 2) {
  const c = createChart(canvas, options(over))
  c.resize(390, 300, dpr)
  c.setData(series(bars))
  c.renderNow(0)
  chart = c
  return c
}

const liveOps = () => stub.ctxFor(canvas)!

// ── Tests ───────────────────────────────────────────────────────────────────

describe('resize and device pixels', () => {
  it('sizes the backing store to whole device pixels', () => {
    const c = createChart(canvas, options())
    chart = c
    c.resize(390, 300, 2)
    expect(canvas.width).toBe(Math.round(390 * 2))
    expect(canvas.height).toBe(Math.round(300 * 2))
    expect(canvas.style.width).toBe('390px')
    expect(canvas.style.height).toBe('300px')
  })

  it('caps the ratio at 2', () => {
    // §C.1: a 3x phone pays 2.25x the fill cost for a difference nobody can see
    // on 1px geometry.
    const c = createChart(canvas, options())
    chart = c
    c.resize(390, 300, 3)
    expect(canvas.width).toBe(780)
  })

  it('sets the transform exactly once per resize, and never in a draw', () => {
    // ctx.scale() inside a draw compounds, and one missed restore turns the
    // whole chart into a slow continuous zoom.
    const c = createChart(canvas, options())
    chart = c
    const fake = liveOps()
    fake.reset()
    c.resize(390, 300, 2)
    expect(fake.of('setTransform').length).toBe(1)
    expect(fake.of('setTransform')[0].a).toEqual([2, 0, 0, 2, 0, 0])

    c.setData(series(400))
    fake.reset()
    for (let f = 0; f < 10; f++) c.renderNow(f * 16)
    expect(fake.of('setTransform').length).toBe(0)
  })

  it('survives being rendered before it has a size', () => {
    const c = createChart(canvas, options())
    chart = c
    expect(() => c.renderNow(0)).not.toThrow()
  })
})

describe('pixel snapping', () => {
  it('puts every rect it emits on a device-pixel boundary at 1x, 2x and 3x', () => {
    // One unsnapped edge is the grey half-pixel halo that gives a hobby chart
    // away, and it is the single most common tell in the whole feature.
    for (const dpr of [1, 2, 3]) {
      const el = document.createElement('canvas')
      document.body.appendChild(el)
      const c = createChart(el, options())
      const fake = stub.ctxFor(el)!
      // Awkward sizes on purpose: a round 390x300 hides fractional layout.
      c.resize(393.7, 301.3, dpr)
      c.setData(series(400))
      fake.reset()
      c.renderNow(0)
      c.panBy(37.4)
      c.renderNow(16)

      expect(unsnappedRects(fake.ops, Math.min(dpr, 2))).toEqual([])
      c.destroy()
      el.remove()
    }
  })
})

describe('layer registry', () => {
  it('draws in z order regardless of the order they were added', () => {
    const c = mounted()
    const seen: string[] = []
    for (const [id, z] of [
      ['crosshair', 900],
      ['grid', 10],
      ['axes', 800],
      ['candles', 100],
    ] as const) {
      c.addLayer({
        id,
        z,
        volatile: false,
        cacheable: false,
        draw: () => seen.push(id),
      })
    }
    c.renderNow(16)
    expect(seen).toEqual(['grid', 'candles', 'axes', 'crosshair'])
  })

  it('replaces a layer of the same id rather than duplicating it', () => {
    // StrictMode's double mount adds every layer twice, and two crosshairs at
    // 35% alpha each is a subtly wrong 58%.
    const c = mounted()
    const a = probeLayer('grid', 10)
    const b = probeLayer('grid', 10)
    c.addLayer(a.layer)
    c.addLayer(b.layer)
    c.renderNow(16)
    expect(a.calls.length).toBe(0)
    expect(b.calls.length).toBe(1)
  })

  it('disposes a layer when it is removed and when the chart is destroyed', () => {
    const c = mounted()
    const a = probeLayer('a', 10)
    const b = probeLayer('b', 20)
    c.addLayer(a.layer)
    c.addLayer(b.layer)
    c.removeLayer('a')
    expect(a.layer.dispose).toHaveBeenCalledTimes(1)
    c.destroy()
    expect(b.layer.dispose).toHaveBeenCalledTimes(1)
  })

  it('hands layers a clipped visible range', () => {
    const c = mounted(undefined, 40)
    const p = probeLayer('x', 10)
    c.addLayer(p.layer)
    c.renderNow(16)
    expect(p.calls[0].i0).toBeGreaterThanOrEqual(0)
    expect(p.calls[0].i1).toBeLessThanOrEqual(39)
  })
})

describe('cacheable vs volatile routing', () => {
  it('does not redraw a cached layer on a pure crosshair move', () => {
    // The whole point of the bitmap. A crosshair move changes nothing the
    // candles depend on, so it must cost one drawImage and zero candle work.
    const c = mounted()
    const cachedLayer = probeLayer('candles', 100, { cacheable: true })
    const crosshairLayer = probeLayer('crosshair', 900, { volatile: true })
    c.addLayer(cachedLayer.layer)
    c.addLayer(crosshairLayer.layer)
    c.renderNow(16)
    const after = cachedLayer.calls.length
    expect(after).toBeGreaterThan(0)

    for (let f = 2; f < 12; f++) {
      c.setCrosshair(100 + f, 120)
      c.renderNow(f * 16)
    }
    expect(cachedLayer.calls.length).toBe(after)
    // The volatile one, meanwhile, is redrawn on every one of those frames.
    expect(crosshairLayer.calls.length).toBeGreaterThan(10)
  })

  it('blits the bitmap instead of repainting it', () => {
    const c = mounted()
    c.addLayer(probeLayer('candles', 100, { cacheable: true }).layer)
    c.renderNow(16)
    const fake = liveOps()
    fake.reset()
    c.setCrosshair(150, 120)
    c.renderNow(32)
    expect(fake.of('drawImage').length).toBe(1)
  })

  it('repaints the bitmap when the bar width changes', () => {
    const c = mounted()
    const p = probeLayer('candles', 100, { cacheable: true })
    c.addLayer(p.layer)
    c.renderNow(16)
    const before = p.calls.length
    c.setSpan(60)
    c.renderNow(32)
    expect(p.calls.length).toBeGreaterThan(before)
  })

  it('patches only the newest bars when the forming candle re-ticks', () => {
    // A tick must not repaint three screens of candles: at 4 ticks a second
    // that would undo the cache entirely.
    const c = mounted()
    const p = probeLayer('candles', 100, { cacheable: true })
    c.addLayer(p.layer)
    c.renderNow(16)
    const base = series(400)
    p.calls.length = 0

    c.setData(nudged(base, 0.02, 2))
    c.renderNow(32)
    expect(p.calls.length).toBe(1)
    // Two bars, not the whole screen.
    expect(p.calls[0].i1 - p.calls[0].i0).toBeLessThanOrEqual(1)
  })

  it('paints cacheable layers into a bitmap three plot-widths wide', () => {
    const c = mounted()
    const p = probeLayer('candles', 100, { cacheable: true })
    c.addLayer(p.layer)
    c.renderNow(16)
    expect(p.calls[0].plotW).toBeCloseTo(c.plot.w * 3, 6)
    // And with no elapsed time: nothing in the bitmap animates.
    expect(p.calls[0].dt).toBe(0)
  })

  it('falls back to drawing live when the browser will not give a context', () => {
    // jsdom without the stub is exactly this, and so is a phone out of canvas
    // memory. A chart that renders nothing at all is a far worse outcome.
    stub.restore()
    const el = document.createElement('canvas')
    const fake = createFakeCtx()
    Object.defineProperty(el, 'getContext', { value: () => fake.ctx })
    const c = createChart(el, options())
    chart = c
    c.resize(390, 300, 2)
    c.setData(series(200))
    const p = probeLayer('candles', 100, { cacheable: true })
    c.addLayer(p.layer)
    c.renderNow(0)
    c.renderNow(16)
    expect(p.calls.length).toBe(2)
    expect(p.calls[1].plotW).toBeCloseTo(c.plot.w, 6)
  })
})

describe('autoscale', () => {
  /** Run frames until the springs stop moving. */
  const settle = (c: ChartController, from = 0) => {
    for (let f = 0; f < 120; f++) c.renderNow(from + f * 16)
  }

  it('snaps to the first data rather than swooping in from nowhere', () => {
    const c = mounted()
    const s = series(400)
    let lo = Infinity
    let hi = -Infinity
    for (let i = 280; i < 400; i++) {
      lo = Math.min(lo, s.l[i])
      hi = Math.max(hi, s.h[i])
    }
    expect(c.viewport.p0).toBeLessThan(lo)
    expect(c.viewport.p1).toBeGreaterThan(hi)
  })

  it('ignores a move smaller than 0.35% of the range', () => {
    // Without the deadband the axis retargets on every tick and the gridlines
    // shimmer continuously — instantly legible as amateur.
    const c = mounted()
    settle(c)
    const p1 = c.viewport.p1
    const range = c.viewport.p1 - c.viewport.p0

    c.setData(nudged(series(400), range * 0.002, 2))
    settle(c, 4000)
    expect(c.viewport.p1).toBeCloseTo(p1, 9)
  })

  it('retargets for a move larger than 0.35% of the range', () => {
    const c = mounted()
    settle(c)
    const p1 = c.viewport.p1
    const range = c.viewport.p1 - c.viewport.p0

    c.setData(nudged(series(400), range * 0.02, 2))
    settle(c, 4000)
    expect(c.viewport.p1).toBeGreaterThan(p1 + range * 0.005)
  })

  it('moves the two bounds independently', () => {
    // One spring on the midpoint and one on the height would translate the
    // whole chart when only the high moved. The low is not perfectly still —
    // autoRange pads by 6% of the range, so a taller range does push it down a
    // little — but it must move by a small fraction of what the high does.
    const c = mounted()
    settle(c)
    const p0 = c.viewport.p0
    const p1 = c.viewport.p1
    c.setData(nudged(series(400), 20, 2))
    settle(c, 4000)
    const up = c.viewport.p1 - p1
    const down = Math.abs(c.viewport.p0 - p0)
    expect(up).toBeGreaterThan(10)
    expect(down).toBeLessThan(up / 10)
  })

  it('animates rather than jumping', () => {
    const c = mounted()
    settle(c)
    const before = c.viewport.p1
    c.setData(nudged(series(400), 30, 2))
    c.renderNow(4000)
    c.renderNow(4016)
    const mid = c.viewport.p1
    settle(c, 4032)
    // A frame or two in it is on its way, not already there.
    expect(mid).toBeGreaterThan(before)
    expect(mid).toBeLessThan(c.viewport.p1)
  })

  it('snaps instead of animating under reduced motion', () => {
    const el = document.createElement('div')
    const c = mounted({ theme: themeFromCss(el, false, true) })
    settle(c)
    const before = c.viewport.p1
    c.setData(nudged(series(400), 30, 2))
    c.renderNow(4000)
    expect(c.viewport.p1).toBeGreaterThan(before)
    // Arrived in one frame, not eased into over 470ms.
    const arrived = c.viewport.p1
    c.renderNow(4016)
    expect(c.viewport.p1).toBeCloseTo(arrived, 9)
  })
})

describe('follow mode', () => {
  it('starts pinned to the newest bar with a right-hand gap', () => {
    // §E: a chart glued to its price axis reads as amateur instantly, and this
    // gap is the highest quality-per-line ratio in the feature.
    const c = mounted(undefined, 400)
    expect(c.following).toBe(true)
    const rightEdgeBar = c.viewport.i0 + c.viewport.span
    expect(rightEdgeBar).toBeGreaterThan(399)
    expect(rightEdgeBar).toBeCloseTo(400 + c.viewport.span * 0.12, 6)
  })

  it('is cleared by a pan away and restored by panning back', () => {
    const c = mounted()
    c.panBy(200)
    expect(c.following).toBe(false)
    c.endPan(0)
    for (let f = 1; f < 60; f++) c.renderNow(f * 16)
    expect(c.following).toBe(false)

    c.panBy(-4000)
    c.endPan(0)
    for (let f = 60; f < 200; f++) c.renderNow(f * 16)
    expect(c.following).toBe(true)
  })

  it('breathes by one bar when a candle closes instead of stepping', () => {
    const c = mounted(undefined, 400)
    const pinned = c.viewport.i0
    c.setData(series(401))
    c.renderNow(16)
    // Mid-animation it is between the old position and the new one.
    expect(c.viewport.i0).toBeGreaterThan(pinned)
    expect(c.viewport.i0).toBeLessThan(pinned + 1)
    for (let f = 2; f < 30; f++) c.renderNow(f * 16)
    expect(c.viewport.i0).toBeCloseTo(pinned + 1, 6)
  })

  it('steps rather than breathing under reduced motion', () => {
    const el = document.createElement('div')
    const c = mounted({ theme: themeFromCss(el, false, true) }, 400)
    const pinned = c.viewport.i0
    c.setData(series(401))
    c.renderNow(16)
    expect(c.viewport.i0).toBeCloseTo(pinned + 1, 6)
  })
})

describe('pan, zoom and the crosshair', () => {
  it('pans in the direction of the finger', () => {
    const c = mounted()
    const before = c.viewport.i0
    // Dragging right reveals older bars.
    c.panBy(60)
    expect(c.viewport.i0).toBeLessThan(before)
  })

  it('rubber-bands past the newest bar rather than stopping dead', () => {
    const c = mounted()
    const limit = c.viewport.i0
    c.panBy(-400)
    expect(c.viewport.i0).toBeGreaterThan(limit)
    // But saturating: it gives up far less than the drag asked for.
    const asked = (400 * c.viewport.span) / c.plot.w
    expect(c.viewport.i0 - limit).toBeLessThan(asked)
    // overscrollX is derived during the frame, alongside everything else a
    // layer reads — so it reports the state the last frame actually drew.
    c.renderNow(16)
    expect(c.interaction.overscrollX).toBeGreaterThan(0)
  })

  it('holds the anchor bar still through a zoom', () => {
    // Not while following: pinning to the newest bar deliberately outranks the
    // anchor, because a chart that drifts off the right edge as you zoom is
    // worse than one that ignores where your fingers were.
    const c = mounted()
    c.setFollow(false)
    c.renderNow(16)
    const anchor = c.scales.iOf(120)
    c.setSpan(60, anchor)
    c.renderNow(32)
    expect(c.scales.iOf(120)).toBeCloseTo(anchor, 6)
  })

  it('keeps the pinched bar under the fingers as they move', () => {
    const c = mounted()
    c.setFollow(false)
    c.renderNow(16)
    const anchor = c.scales.iOf(100)
    c.beginPinch(100)
    c.pinchTo(2, 140)
    c.renderNow(32)
    expect(c.viewport.span).toBeCloseTo(120 / 2, 6)
    expect(c.scales.iOf(140)).toBeCloseTo(anchor, 6)
  })

  it('holds the zoom inside its configured bounds', () => {
    const c = mounted()
    c.setSpan(1)
    expect(c.viewport.span).toBe(12)
    c.setSpan(99999)
    expect(c.viewport.span).toBe(2000)
  })

  it('snaps the crosshair to a bar and magnetises it to the close', () => {
    const c = mounted()
    const i = 350
    const s = series(400)
    const y = c.scales.yOf(s.c[i])
    c.setCrosshair(c.scales.xOf(i), y + 4)
    expect(c.interaction.crosshair?.i).toBe(i)
    // §E: within 12px it reads the candle's own close, not the pixel under the
    // finger — which is what makes the readout agree with what is being pointed
    // at.
    expect(c.interaction.crosshair?.p).toBeCloseTo(s.c[i], 9)
  })

  it('leaves the price alone outside the magnet radius', () => {
    const c = mounted()
    const s = series(400)
    const y = c.scales.yOf(s.c[350]) + 40
    c.setCrosshair(c.scales.xOf(350), y)
    expect(c.interaction.crosshair?.p).not.toBeCloseTo(s.c[350], 6)
  })

  it('clears the crosshair', () => {
    const c = mounted()
    c.setCrosshair(100, 100)
    expect(c.interaction.crosshair).not.toBeNull()
    c.setCrosshair(null)
    expect(c.interaction.crosshair).toBeNull()
  })
})

describe('the render loop', () => {
  it('stops scheduling itself once nothing is dirty or animating', () => {
    // §D.6, and the whole battery story. Without this the chart burns 60 frames
    // a second staring at a market that has not moved.
    const c = createChart(canvas, options())
    chart = c
    c.resize(390, 300, 2)
    c.setData(series(400))

    // Let the initial autoscale settle out.
    for (let f = 0; f < 200 && raf.scheduled > 0; f++) raf.flush(f * 16)
    expect(raf.scheduled).toBe(0)

    const before = raf.request.mock.calls.length
    raf.flush(9999)
    expect(raf.request.mock.calls.length).toBe(before)
  })

  it('wakes again on invalidate', () => {
    const c = createChart(canvas, options())
    chart = c
    c.resize(390, 300, 2)
    c.setData(series(400))
    for (let f = 0; f < 200 && raf.scheduled > 0; f++) raf.flush(f * 16)
    expect(raf.scheduled).toBe(0)

    c.invalidate()
    expect(raf.scheduled).toBe(1)
  })

  it('keeps running while a spring is still moving', () => {
    const c = createChart(canvas, options())
    chart = c
    c.resize(390, 300, 2)
    c.setData(series(400))
    for (let f = 0; f < 200 && raf.scheduled > 0; f++) raf.flush(f * 16)

    c.setData(nudged(series(400), 40, 2))
    let frames = 0
    for (let f = 0; f < 300 && raf.scheduled > 0; f++) {
      raf.flush(4000 + f * 16)
      frames++
    }
    // It animated for a while and then stopped on its own.
    expect(frames).toBeGreaterThan(5)
    expect(raf.scheduled).toBe(0)
  })

  it('does not integrate a backgrounded tab in one wild frame', () => {
    // A hidden tab hands back a dt of many seconds on resume.
    const c = mounted()
    for (let f = 0; f < 120; f++) c.renderNow(f * 16)
    c.setData(nudged(series(400), 40, 2))
    c.renderNow(600_000)
    const afterResume = c.viewport.p1
    c.renderNow(600_016)
    // Still easing, not teleported to the target by a 10-minute dt.
    expect(c.viewport.p1).toBeGreaterThan(afterResume)
  })
})

describe('destroy', () => {
  it('is idempotent and leaves no frame scheduled', () => {
    // React 19 StrictMode mounts, unmounts and remounts. A teardown that is not
    // safe twice leaves a second loop running against an invisible canvas.
    const c = createChart(canvas, options())
    c.resize(390, 300, 2)
    c.setData(series(400))
    expect(raf.scheduled).toBe(1)

    c.destroy()
    expect(raf.scheduled).toBe(0)
    expect(() => c.destroy()).not.toThrow()
    expect(() => c.destroy()).not.toThrow()
    expect(raf.scheduled).toBe(0)
  })

  it('ignores everything asked of it afterwards', () => {
    const c = createChart(canvas, options())
    c.resize(390, 300, 2)
    c.setData(series(400))
    c.destroy()

    const p = probeLayer('x', 10)
    expect(() => {
      c.invalidate()
      c.addLayer(p.layer)
      c.renderNow(16)
      c.setCrosshair(10, 10)
    }).not.toThrow()
    expect(raf.scheduled).toBe(0)
    expect(p.calls.length).toBe(0)
  })

  it('survives a StrictMode mount / unmount / remount on one canvas', () => {
    const first = createChart(canvas, options())
    first.resize(390, 300, 2)
    first.destroy()

    const second = createChart(canvas, options())
    chart = second
    second.resize(390, 300, 2)
    second.setData(series(400))
    second.renderNow(0)
    expect(canvas.width).toBe(780)
    expect(second.viewport.span).toBe(120)
  })
})

describe('chrome from the first frame', () => {
  it('paints the background and both axis bands before any layer exists', () => {
    // §E: never a spinner over an empty box. Grid and axes need no data, so the
    // real chrome is on screen from frame 1.
    const c = createChart(canvas, options())
    chart = c
    const fake = liveOps()
    c.resize(390, 300, 2)
    fake.reset()
    c.renderNow(0)

    const rects = fake.of('fillRect')
    expect(rects.length).toBeGreaterThanOrEqual(3)
    // Full-bleed background first.
    expect(rects[0].a).toEqual([0, 0, 390, 300])
    expect(unsnappedRects(fake.ops, 2)).toEqual([])
  })

  it('lays the plot out with the axes inset', () => {
    const c = mounted()
    expect(c.plot.x).toBe(0)
    expect(c.plot.y).toBe(0)
    expect(c.plot.w).toBeLessThan(390)
    // The body is 300 - 26; the price pane is what is left of it once volume has
    // its own pane.
    expect(c.plot.h).toBe(300 - 26 - c.volumePane!.h)
  })

  it('widens the price axis for bigger numbers', () => {
    // §E: widest label + 16px. A four-figure instrument and a six-figure one
    // must not share an axis width.
    const small = mounted(undefined, 400)
    const narrow = small.plot.w
    small.destroy()

    const el = document.createElement('canvas')
    document.body.appendChild(el)
    const big = createChart(el, options())
    chart = big
    big.resize(390, 300, 2)
    big.setData(series(400, 480_000))
    big.renderNow(0)
    expect(big.plot.w).toBeLessThan(narrow)
    el.remove()
  })

  it('never narrows the axis below its configured minimum', () => {
    const c = mounted({ priceAxisMinW: 80 }, 400)
    expect(390 - c.plot.w).toBeGreaterThanOrEqual(80)
  })
})

describe('the volume pane', () => {
  /**
   * The three vertical bands, and the number they have to add up to.
   *
   * `snap(cssH)` rather than cssH: the engine rounds the canvas to whole device
   * pixels, and the backing store divided by the (capped) ratio is that height
   * without re-deriving the rounding rule here.
   */
  const bands = (c: ChartController, el: HTMLCanvasElement, dpr: number) => {
    const eff = Math.min(dpr, 2)
    return {
      price: c.plot.h,
      volume: c.volumePane?.h ?? 0,
      // The time axis is whatever is left under both panes.
      axis: el.height / eff - c.plot.h - (c.volumePane?.h ?? 0),
      total: el.height / eff,
    }
  }

  it('gives volume no pane at all when volumeFrac is 0', () => {
    // Null rather than a zero-height rect: `volumePane === null` is the only
    // check a layer should ever need, and a 0-height rect makes it two.
    const c = mounted({ volumeFrac: 0 })
    expect(c.volumePane).toBeNull()
    // And the price pane then takes the whole body.
    expect(c.plot.h).toBe(300 - 26)
  })

  it('hands every layer the same pane the controller reports', () => {
    const c = mounted()
    const p = probeLayer('x', 10)
    c.addLayer(p.layer)
    c.renderNow(16)
    expect(p.calls[0].vol).toEqual({ ...c.volumePane! })
    expect(p.calls[0].plotH).toBe(c.plot.h)
  })

  it('hands a null pane through when volume is off', () => {
    const c = mounted({ volumeFrac: 0 })
    const p = probeLayer('x', 10)
    c.addLayer(p.layer)
    c.renderNow(16)
    expect(p.calls[0].vol).toBeNull()
  })

  it('tiles the canvas exactly — price, volume, time axis, no gap and no overlap', () => {
    // A rounding error here is either a hairline of background showing between
    // two panes or a row of volume painted under the time axis. Both are the
    // kind of thing a screenshot review picks out immediately.
    for (const dpr of [1, 2, 3]) {
      for (const volumeFrac of [0, 0.08, 0.16, 0.25]) {
        const el = document.createElement('canvas')
        document.body.appendChild(el)
        const c = createChart(el, options({ volumeFrac }))
        // An awkward height on purpose: a round 300 hides fractional layout.
        c.resize(393.7, 301.3, dpr)
        c.setData(series(400))
        c.renderNow(0)

        const b = bands(c, el, dpr)
        expect(b.price + b.volume + b.axis).toBeCloseTo(b.total, 9)
        expect(b.price).toBeGreaterThan(0)
        expect(b.axis).toBeGreaterThan(0)
        // Butted up against each other, in order.
        if (c.volumePane) {
          expect(c.volumePane.y).toBe(c.plot.y + c.plot.h)
          expect(c.volumePane.x).toBe(c.plot.x)
          expect(c.volumePane.w).toBe(c.plot.w)
        }
        c.destroy()
        el.remove()
      }
    }
  })

  it('keeps the large majority of the body for price however greedy the option is', () => {
    // A caller that passes 0.8 gets a chart whose candles have nowhere to be,
    // and the failure would be silent.
    const c = mounted({ volumeFrac: 0.8 })
    const bodyH = 300 - 26
    expect(c.volumePane).not.toBeNull()
    expect(c.volumePane!.h / bodyH).toBeLessThanOrEqual(0.3 + 1e-9)
    expect(c.plot.h / bodyH).toBeGreaterThanOrEqual(0.7 - 1e-9)
  })

  it('ignores a negative fraction rather than inverting the split', () => {
    const c = mounted({ volumeFrac: -0.5 })
    expect(c.volumePane).toBeNull()
    expect(c.plot.h).toBe(300 - 26)
  })

  it('maps the price band onto the PRICE pane, not the old full body', () => {
    // The one thing that keeps every existing layer correct: `scales` is still
    // built from `plot`, and `plot` simply got shorter.
    const c = mounted()
    c.renderNow(16)
    expect(c.scales.yOf(c.viewport.p0)).toBeCloseTo(c.plot.y + c.plot.h, 9)
    expect(c.scales.yOf(c.viewport.p1)).toBeCloseTo(c.plot.y, 9)
    // Which is strictly above the volume pane, not through it.
    expect(c.scales.yOf(c.viewport.p0)).toBeCloseTo(c.volumePane!.y, 9)
  })

  it('leaves the autoscale untouched by the split', () => {
    // The springs settle to autoRange's band whatever the pane heights are; only
    // the pixels the band is drawn into changed.
    const tall = mounted({ volumeFrac: 0 })
    for (let f = 0; f < 200; f++) tall.renderNow(f * 16)
    const p0 = tall.viewport.p0
    const p1 = tall.viewport.p1
    tall.destroy()

    const el = document.createElement('canvas')
    document.body.appendChild(el)
    const split = createChart(el, options({ volumeFrac: 0.25 }))
    chart = split
    split.resize(390, 300, 2)
    split.setData(series(400))
    for (let f = 0; f < 200; f++) split.renderNow(f * 16)
    expect(split.viewport.p0).toBeCloseTo(p0, 9)
    expect(split.viewport.p1).toBeCloseTo(p1, 9)
    el.remove()
  })

  it('preserves the split proportionally across a resize', () => {
    const c = mounted()
    const before = c.volumePane!.h / (300 - 26)
    expect(before).toBeCloseTo(0.16, 2)

    c.resize(390, 600, 2)
    c.renderNow(16)
    expect(c.volumePane!.h / (600 - 26)).toBeCloseTo(before, 2)
    expect(c.plot.h + c.volumePane!.h).toBe(600 - 26)
  })

  it('draws the pane divider as chrome, from the first frame and with no data', () => {
    // The rule under the candles is the single line four reviewers said was
    // missing, and the volume layer draws nothing at all on an empty series —
    // so it cannot be the volume layer's job alone.
    const c = createChart(canvas, options())
    chart = c
    const fake = liveOps()
    c.resize(390, 300, 2)
    fake.reset()
    c.renderNow(0)

    const v = c.volumePane!
    const divider = fake.of('fillRect').filter((r) => r.a[1] === v.y && r.a[3] === 0.5)
    expect(divider.length).toBe(1)
    expect(divider[0].a).toEqual([v.x, v.y, v.w, 0.5])
  })
})

describe('the bitmap and the split', () => {
  it('covers both panes, so a cacheable volume layer is not clipped away', () => {
    // Volume is a pure function of (data, viewport, theme) exactly like the
    // candles, so it belongs in the bitmap. A bitmap cut to the price pane would
    // silently discard everything it drew.
    const c = mounted()
    const p = probeLayer('volume', 50, { cacheable: true })
    c.addLayer(p.layer)
    c.renderNow(16)

    const call = p.calls[0]
    expect(call.plotW).toBeCloseTo(c.plot.w * 3, 6)
    expect(call.plotH).toBe(c.plot.h)
    // Same pane, three screens wide, sitting directly under the price pane.
    expect(call.vol).toEqual({ x: 0, y: call.plotY + call.plotH, w: call.plotW, h: c.volumePane!.h })
  })

  it('blits both panes back in one drawImage', () => {
    const c = mounted()
    c.addLayer(probeLayer('candles', 100, { cacheable: true }).layer)
    c.renderNow(16)
    const fake = liveOps()
    fake.reset()
    c.setCrosshair(150, 120)
    c.renderNow(32)

    const [img] = fake.of('drawImage')
    expect(img).toBeDefined()
    // Destination height is the body, not the price pane.
    expect(img.a[7]).toBe(c.plot.h + c.volumePane!.h)
  })

  it('blits one exact 1:1 device-pixel copy per frame, never two', () => {
    // The suspected home of a reported vertical seam. It is not: there is one
    // drawImage per frame and it is a whole-device-pixel 1:1 copy, so it can
    // neither resample nor overlap itself. Asserted every frame across the tick
    // path, which is the one that runs thousands of times between rebuilds.
    const c = mounted()
    c.addLayer(probeLayer('candles', 100, { cacheable: true }).layer)
    c.renderNow(16)
    const fake = liveOps()

    for (let f = 2; f < 20; f++) {
      c.setData(nudged(series(400), 0.001 * f, f))
      fake.reset()
      c.renderNow(f * 16)

      const imgs = fake.of('drawImage')
      expect(imgs.length).toBe(1)
      const [sx, sy, sw, sh, dx, dy, dw, dh] = imgs[0].a
      expect(sw).toBe(Math.round(dw * 2))
      expect(sh).toBe(Math.round(dh * 2))
      // Source on whole device pixels, destination on whole device pixels.
      expect(Number.isInteger(sx)).toBe(true)
      expect(sy).toBe(0)
      expect(Number.isInteger(dx * 2)).toBe(true)
      expect(Number.isInteger((dy + dh) * 2)).toBe(true)
      // And it covers both panes, exactly.
      expect(dh).toBe(c.plot.h + c.volumePane!.h)
    }
  })

  it('throws the bitmap away when the pane heights change', () => {
    const c = mounted()
    const p = probeLayer('candles', 100, { cacheable: true })
    c.addLayer(p.layer)
    c.renderNow(16)
    const before = p.calls.length
    expect(before).toBeGreaterThan(0)

    // Same width, taller canvas: both panes change height under the bitmap.
    c.resize(390, 360, 2)
    c.renderNow(32)
    expect(p.calls.length).toBeGreaterThan(before)
  })

  it('counts the split itself as part of what the bitmap is keyed on', () => {
    // plotH moves whenever volumeH does at a FIXED body height, but a resize
    // that grows the canvas by exactly the pane's growth would leave plotH
    // unchanged — so the volume height is compared in its own right.
    const cache = createStaticCache()
    const key: CacheKey = {
      barW: 3, p0: 100, p1: 200, i0: 400, span: 100, len: 1000,
      themeRev: 1, plotW: 300, plotH: 200, volumeH: 40, dpr: 2,
    }
    cache.rebuild(key, () => {})
    expect(cache.stale(key)).toBe('')
    expect(cache.stale({ ...key, volumeH: 44 })).toBe('size')
    // And the bitmap is tall enough to hold both panes.
    expect(cache.canvas.height).toBe(Math.round((200 + 40) * 2))
    cache.dispose()
  })
})

describe('theme changes', () => {
  it('repaints the bitmap, because colours are baked into it', () => {
    const c = mounted()
    const p = probeLayer('candles', 100, { cacheable: true })
    c.addLayer(p.layer)
    c.renderNow(16)
    const before = p.calls.length

    const el = document.createElement('div')
    el.style.setProperty('--bg', '#ffffff')
    el.style.setProperty('--ink', '#2c3e50')
    c.setTheme(themeFromCss(el, false, false))
    c.renderNow(32)
    expect(p.calls.length).toBeGreaterThan(before)
  })

  it('hands the new theme to every layer', () => {
    const c = mounted()
    let seen = ''
    c.addLayer({
      id: 'x',
      z: 10,
      volatile: true,
      cacheable: false,
      draw: (rc) => {
        seen = rc.theme.bg
      },
    })
    const el = document.createElement('div')
    el.style.setProperty('--bg', '#ffffff')
    c.setTheme(themeFromCss(el, false, false))
    c.renderNow(32)
    expect(seen).toBe('#ffffff')
  })
})

describe('empty and degenerate states', () => {
  it('renders with no data at all', () => {
    const c = createChart(canvas, options())
    chart = c
    c.resize(390, 300, 2)
    const p = probeLayer('grid', 10)
    c.addLayer(p.layer)
    expect(() => c.renderNow(0)).not.toThrow()
    expect(p.calls.length).toBe(1)
  })

  it('survives a zero-sized container', () => {
    const c = createChart(canvas, options())
    chart = c
    c.resize(0, 0, 2)
    c.setData(series(100))
    expect(() => c.renderNow(0)).not.toThrow()
    expect(() => c.panBy(50)).not.toThrow()
    expect(() => c.setCrosshair(10, 10)).not.toThrow()
  })

  it('survives fewer bars than one screen', () => {
    const c = mounted(undefined, 5)
    expect(Number.isFinite(c.viewport.i0)).toBe(true)
    expect(Number.isFinite(c.viewport.p0)).toBe(true)
    expect(c.viewport.p1).toBeGreaterThan(c.viewport.p0)
  })

  it('does not allocate a new crosshair object per move', () => {
    // The crosshair moves every frame during a drag; a fresh object per move is
    // garbage on the one path that must never stutter.
    const c = mounted()
    c.setCrosshair(100, 100)
    const first = c.interaction.crosshair
    c.setCrosshair(101, 100)
    expect(c.interaction.crosshair).toBe(first)
  })
})

describe('the ops log holds the performance rules', () => {
  it('emits no stroke at all from the renderer itself', () => {
    // §E: wicks and hairlines are rects. A 1px stroke off a half-pixel boundary
    // is the grey blur that gives a hobby chart away.
    const c = mounted()
    const fake = liveOps()
    fake.reset()
    c.renderNow(16)
    expect(fake.of('stroke').length).toBe(0)
  })

  it('balances every save with a restore', () => {
    const c = mounted()
    c.addLayer(probeLayer('candles', 100, { cacheable: true }).layer)
    const fake = liveOps()
    fake.reset()
    c.renderNow(16)
    const kinds = fake.ops.map((o: Op) => o.op)
    expect(kinds.filter((k) => k === 'save').length).toBe(
      kinds.filter((k) => k === 'restore').length,
    )
  })

  it('measures text only when the label set could have changed', () => {
    // measureText costs about as much as fillText; doing it per frame would
    // spend a third of the budget on a number that rarely changes.
    const c = mounted()
    const fake = liveOps()
    fake.reset()
    for (let f = 1; f < 30; f++) c.renderNow(f * 16)
    expect(fake.of('measureText').length).toBe(0)
  })
})
