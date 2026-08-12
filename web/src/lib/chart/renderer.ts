// The engine: viewport, follow mode, autoscale, layer routing, and the frame loop.
//
// It owns four things that no layer is allowed to touch:
//
//   the viewport      where we are in time and price, including overscroll
//   the two springs   p0 and p1 animate INDEPENDENTLY, so a range that expands
//                     on one side does not translate the whole chart
//   the routing       which layers go into the static bitmap and which are
//                     painted live every frame
//   the loop          demand-driven rAF that STOPS SCHEDULING ITSELF when
//                     nothing is dirty and nothing is animating (§D.6 — an idle
//                     chart at 1x costs about four frames a second, not sixty)
//
// `renderNow(nowMs)` renders one frame synchronously and is how the tests drive
// all of this: jsdom's requestAnimationFrame never usefully fires.

import { formatPriceForCanvas } from './format'
import { createStaticCache, type CacheKey } from './offscreen'
import { createKinetic, createSpring, easeOutCubic } from './physics'
import { autoRange, clampViewport, followI0, makeScales } from './scale'
import type {
  ChartEngine,
  ChartLayer,
  ChartOptions,
  ChartTheme,
  InteractionState,
  OhlcvColumns,
  Rect,
  RenderCtx,
  Scales,
  Viewport,
} from './types'

/**
 * Price-axis autoscale spring. §C.2 pins it at k = 90, deliberately softer than
 * the k = 220 used for overscroll: a price axis that snaps feels twitchy, while
 * an overscroll that lingers feels broken.
 */
const AUTOSCALE_K = 90

/**
 * §C.2's 0.35%-of-range deadband, and the single highest-value constant in this
 * file. The visible high and low move a fraction of a tick several times a
 * second; without a deadband the axis retargets on every one of them and the
 * gridlines shimmer continuously. It is instantly legible as amateur, and it is
 * the kind of thing a screenshot cannot show but a screen recording makes
 * impossible to miss.
 */
const AUTOSCALE_DEADBAND = 0.0035

/** Headroom above and below the visible extremes. */
const AUTOSCALE_PAD = 0.06

/** §C.2: when a bar closes while following, the right gap grows by exactly one
 *  bar width over 200ms so the chart breathes instead of stepping. */
const BREATHE_MS = 200

/**
 * Longest frame the animations will honour.
 *
 * A backgrounded tab hands back a dt of many seconds on resume, and integrating
 * that produces one wild frame that looks like a glitch. Clamping loses a little
 * animation time in exchange for never showing that frame.
 */
const MAX_FRAME_MS = 100

/** Opening zoom, in bars, when the caller has not chosen one. */
const DEFAULT_SPAN = 120

/** §E: price-axis width is the widest label plus 16px. */
const PRICE_LABEL_PAD = 16

/**
 * Ceiling on the volume pane's share of the body.
 *
 * Volume gets its OWN pane now — four independent reviewers picked the old
 * translucent overlay out as the weakest thing on the chart — but the price pane
 * is still the subject, and on a 390px phone the body is only ~270px to begin
 * with. Clamped here rather than trusted from options: a caller that passes 0.5
 * gets a chart whose candles have nowhere to be, and the failure is silent.
 */
const MAX_VOLUME_FRAC = 0.3

/** How close to the right edge counts as "still following", in bars. */
const FOLLOW_EPS = 1e-6

/** §E: magnetise the crosshair to the candle's close within 12px. */
const MAGNET_PX = 12

const EMPTY_ARRAY = new Float64Array(0)

/** A series with nothing in it, so `data` is never null and no layer needs a
 *  guard. §E's loading state depends on this: grid and axes draw from frame 1. */
const EMPTY_DATA: OhlcvColumns = {
  length: 0,
  t: EMPTY_ARRAY,
  o: EMPTY_ARRAY,
  h: EMPTY_ARRAY,
  l: EMPTY_ARRAY,
  c: EMPTY_ARRAY,
  v: EMPTY_ARRAY,
  at: (i) => i,
  rev: 0,
}

/**
 * What `createChart` actually returns.
 *
 * `ChartEngine` is frozen and has no way to pan, zoom about a point, or place
 * the crosshair — so a gesture layer wired only to `ChartEngine` could not
 * drive the chart at all. These are added on top rather than by editing
 * types.ts; the result is still assignable to `ChartEngine`, so the seam with
 * the layer workstream is untouched.
 */
export interface ChartController extends ChartEngine {
  /** Drag horizontally by CSS px. Clears follow mode and rubber-bands at the
   *  ends. Call `endPan` on release, even for a release with no velocity. */
  panBy(dxPx: number): void
  endPan(vxPx: number): void
  /** Pinch, in the cumulative-scale form `attachGestures` emits. */
  beginPinch(cxPx: number): void
  pinchTo(scale: number, cxPx: number): void
  endPinch(): void
  /** Zoom about a point, for the wheel. `factor > 1` zooms in. */
  zoomAt(factor: number, xPx: number): void
  /** Place or clear the crosshair. Snaps to the bar and magnetises to its close. */
  setCrosshair(x: number | null, y?: number): void
  /** The PRICE pane the last frame used. Exposed for hit-testing outside the
   *  canvas. Already shortened by the volume pane, if there is one. */
  readonly plot: Readonly<Rect>
  /** The volume pane, or null when `volumeFrac` is 0 (or too small to be worth a
   *  pane at this size). */
  readonly volumePane: Readonly<Rect> | null
  readonly scales: Scales
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

const clock = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

export function createChart(canvas: HTMLCanvasElement, options: ChartOptions): ChartController {
  const opts = { ...options }
  const ctx = canvas.getContext('2d')

  let theme: ChartTheme = opts.theme
  let themeRev = 1
  let data: OhlcvColumns = EMPTY_DATA
  let destroyed = false

  // ── Geometry ──────────────────────────────────────────────────────────────
  let dpr = 1
  let cssW = 0
  let cssH = 0
  // The price pane. `scales` is built from THIS, so every layer that draws price
  // geometry against `plot` stays correct without knowing volume exists.
  const plot: Rect = { x: 0, y: 0, w: 0, h: 0 }
  // Preallocated and pointed at (or away from) by `volumePane`, so a frame never
  // allocates a rect and a layer that held on to one still sees live numbers.
  const volumeRect: Rect = { x: 0, y: 0, w: 0, h: 0 }
  let volumePane: Rect | null = null
  // Price pane + volume pane together: what the static bitmap covers and what
  // the cacheable layers are clipped to. Not part of RenderCtx — a layer works
  // in one pane or the other, never across the seam.
  const body: Rect = { x: 0, y: 0, w: 0, h: 0 }
  const priceAxis: Rect = { x: 0, y: 0, w: 0, h: 0 }
  const timeAxis: Rect = { x: 0, y: 0, w: 0, h: 0 }
  let layoutDirty = true
  // The magnitude the axis width was last measured for. Rebuilding the label
  // string every frame would allocate per frame for no reason (§C.1 rule 5).
  let labelBucket = Number.NaN
  let labelCensor = theme.censor
  let priceAxisW = opts.priceAxisMinW

  /** Every coordinate the renderer emits goes through this. One unsnapped edge
   *  is the grey half-pixel halo that gives a hobby chart away. */
  const snap = (v: number) => Math.round(v * dpr) / dpr

  // ── Viewport and motion ───────────────────────────────────────────────────
  const vp: Viewport = {
    i0: 0,
    span: clamp(DEFAULT_SPAN, opts.minSpan, opts.maxSpan),
    p0: 0,
    p1: 1,
  }
  let following = true
  // Two springs, not one on the midpoint plus one on the height: an expanding
  // range must grow from the side that moved, or the whole chart slides.
  const springP0 = createSpring(AUTOSCALE_K)
  const springP1 = createSpring(AUTOSCALE_K)
  let primed = false
  const pan = createKinetic()
  let breatheMs = -1
  let pinchSpan0 = 0
  let pinchAnchor = 0

  const interaction: InteractionState = { crosshair: null, pressed: false, overscrollX: 0 }
  // Preallocated: the crosshair moves every frame during a drag, and a fresh
  // object per move is garbage on the interaction path.
  const crosshair = { x: 0, y: 0, i: 0, p: 0 }

  // ── Layers ────────────────────────────────────────────────────────────────
  const layers: ChartLayer[] = []
  let cached: ChartLayer[] = []
  let live: ChartLayer[] = []

  /**
   * A layer goes into the static bitmap only if it is cacheable AND not
   * volatile. Both flags mean something that way: `cacheable` says its output is
   * a pure function of (data, viewport, theme), and `volatile` overrides it for
   * anything that animates on its own clock.
   */
  const resort = () => {
    layers.sort((a, b) => a.z - b.z)
    cached = layers.filter((l) => l.cacheable && !l.volatile)
    live = layers.filter((l) => !(l.cacheable && !l.volatile))
  }

  const cache = createStaticCache(canvas.ownerDocument ?? document)
  let cachedRev = -1

  // ── The per-frame context handed to layers ────────────────────────────────
  // One object, mutated in place and reused. §C.1 rule 1: no allocation inside
  // a draw, and this is the object every draw receives.
  const rc = {
    ctx: ctx as CanvasRenderingContext2D,
    plot,
    volumePane: null as Rect | null,
    priceAxis,
    timeAxis,
    scales: makeScales(vp, plot, 1),
    data,
    i0: 0,
    i1: 0,
    dpr,
    theme,
    dt: 0,
    now: 0,
    interaction,
    snap,
  }
  // A second one for painting into the bitmap, whose plot rect is three screens
  // wide and whose dt is always zero.
  const cacheRc = { ...rc }

  // ── Loop state ────────────────────────────────────────────────────────────
  let dirty = true
  let animating = false
  let rafId: number | null = null
  let lastMs = -1

  // ── Bounds ────────────────────────────────────────────────────────────────
  const rightGapBars = () => vp.span * opts.rightGapFrac
  /** Where i0 rests with the newest bar at the right edge, gap included. */
  const maxI0 = () => Math.max(0, followI0(data.length, vp.span, rightGapBars()))
  const minI0 = () => Math.min(0, maxI0())

  const clampVp = () => {
    const c = clampViewport(vp, data.length, opts.minSpan, opts.maxSpan, rightGapBars())
    vp.i0 = c.i0
    vp.span = c.span
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  /**
   * Re-measure the price axis if the numbers on it changed order of magnitude.
   *
   * The width lives here rather than in the axis layer because the plot rect has
   * to be settled before any layer draws.
   *
   * Checked every frame but measured almost never: `Math.log10` is free and
   * `measureText` costs about as much as a `fillText`. It has to be a separate
   * pass from `relayout` because the price range is not known until the springs
   * have run — on the first frame with data the viewport is still the 0..1
   * placeholder, so a width measured during layout would be the width for a
   * one-digit instrument and would never be revisited.
   */
  const checkAxisWidth = () => {
    if (!ctx) return
    const mag = Math.max(Math.abs(vp.p0), Math.abs(vp.p1))
    const bucket = mag > 0 ? Math.floor(Math.log10(mag)) : 0
    if (bucket === labelBucket && theme.censor === labelCensor) return
    labelBucket = bucket
    labelCensor = theme.censor
    // The widest label an axis at this magnitude can produce, sign included.
    const sample = formatPriceForCanvas(
      -(10 ** (bucket + 1) - 1),
      opts.pricePrecision,
      theme.censor,
    )
    ctx.font = `600 ${theme.axisFontPx}px ${theme.fontMono}`
    // §E: widest label + 16px.
    const w = Math.max(opts.priceAxisMinW, ctx.measureText(sample).width + PRICE_LABEL_PAD)
    if (w !== priceAxisW) {
      priceAxisW = w
      layoutDirty = true
    }
  }

  /**
   * The whole geometry, in one pass.
   *
   * Insets first — right = price axis, bottom = time axis — which leaves the
   * BODY. The body is then split: price pane on top, volume pane below it. The
   * three vertical bands (price, volume, time axis) tile the canvas exactly, and
   * they have to: a rounding error here is either a hairline of background
   * showing between two panes or a row of volume painted under the time axis.
   *
   * Both heights are snapped to device pixels BEFORE the subtraction, so their
   * sum is the body to the last pixel rather than to the last float.
   */
  const relayout = () => {
    const w = Math.max(0, snap(cssW))
    const h = Math.max(0, snap(cssH))
    const axisW = Math.min(w, snap(priceAxisW))
    const axisH = Math.min(h, snap(opts.timeAxisH))
    const bodyW = Math.max(0, w - axisW)
    const bodyH = Math.max(0, h - axisH)

    // Clamped, not trusted: price keeps at least 70% of the body whatever the
    // caller asked for. A volume pane that rounds away to nothing gets no pane
    // at all rather than a zero-height one — `volumePane` is null exactly when
    // there is nowhere to draw volume, which is the only check a layer needs.
    const frac = clamp(opts.volumeFrac, 0, MAX_VOLUME_FRAC)
    const volH = frac > 0 ? clamp(snap(bodyH * frac), 0, bodyH) : 0

    plot.x = 0
    plot.y = 0
    plot.w = bodyW
    plot.h = bodyH - volH

    if (volH > 0) {
      volumeRect.x = plot.x
      volumeRect.y = plot.y + plot.h
      volumeRect.w = plot.w
      volumeRect.h = volH
      volumePane = volumeRect
    } else {
      volumePane = null
    }

    body.x = plot.x
    body.y = plot.y
    body.w = plot.w
    body.h = bodyH

    // The price axis spans the PRICE pane only: its labels are prices, and the
    // layer's own "would this label hang off the edge" test is against plot.
    // The strip beside the volume pane is painted as chrome below.
    priceAxis.x = plot.w
    priceAxis.y = 0
    priceAxis.w = Math.max(0, w - plot.w)
    priceAxis.h = plot.h

    timeAxis.x = 0
    timeAxis.y = bodyH
    timeAxis.w = plot.w
    timeAxis.h = Math.max(0, h - bodyH)
    layoutDirty = false
  }

  // ── Autoscale ─────────────────────────────────────────────────────────────
  const visibleLo = () => Math.max(0, Math.floor(vp.i0))
  const visibleHi = () => Math.min(data.length - 1, Math.ceil(vp.i0 + vp.span))

  const autoscale = (dt: number): boolean => {
    const lo = visibleLo()
    const hi = visibleHi()
    if (data.length > 0 && hi >= lo) {
      const r = autoRange(data, lo, hi, AUTOSCALE_PAD, opts.tickSize)
      if (!primed) {
        // First data. Snapping rather than animating from the placeholder 0..1
        // band, which would otherwise play a half-second swoop on load.
        springP0.snap(r.p0)
        springP1.snap(r.p1)
        primed = true
      } else {
        const range = Math.max(1e-12, springP1.target - springP0.target)
        const band = range * AUTOSCALE_DEADBAND
        if (Math.abs(r.p0 - springP0.target) > band) springP0.target = r.p0
        if (Math.abs(r.p1 - springP1.target) > band) springP1.target = r.p1
      }
    }

    // Settle when the remaining error is under half a CSS pixel on screen. An
    // epsilon in price units cannot be a constant: 0.5 is sensible for an index
    // and absurd for an instrument quoted in satang.
    const range = Math.max(1e-12, springP1.value - springP0.value)
    const eps = plot.h > 0 ? (range / plot.h) * 0.5 : range * 1e-4
    springP0.epsilon = eps
    springP1.epsilon = eps

    let alive = false
    if (theme.reducedMotion) {
      springP0.snap(springP0.target)
      springP1.snap(springP1.target)
    } else {
      // Both, every frame — `||` would short-circuit and leave one spring
      // un-stepped whenever the other finished first.
      const a0 = springP0.update(dt)
      const a1 = springP1.update(dt)
      alive = a0 || a1
    }
    vp.p0 = springP0.value
    vp.p1 = springP1.value
    return alive
  }

  // ── One frame's worth of motion ───────────────────────────────────────────
  const step = (dt: number): boolean => {
    let alive = false

    if (following) {
      const target = maxI0()
      if (breatheMs >= 0) {
        breatheMs += dt
        const t = clamp(breatheMs / BREATHE_MS, 0, 1)
        // Starts one bar back and eases in, so a new candle slides into the gap
        // instead of the whole chart jumping a bar width.
        vp.i0 = target - (1 - easeOutCubic(t))
        if (t >= 1) breatheMs = -1
        else alive = true
      } else {
        vp.i0 = target
      }
      // Keep the kinetic's own coordinate in step, or the next drag starts from
      // wherever the chart was when following was switched on.
      pan.value = vp.i0
      pan.stop()
    } else if (pan.mode !== 'idle' && pan.mode !== 'drag') {
      const lo = minI0()
      const hi = maxI0()
      pan.dim = vp.span
      alive = pan.update(dt, lo, hi) || alive
      vp.i0 = pan.value
      // Panning back to the right edge restores follow mode, which is what makes
      // the chart feel like it is tracking the market rather than parked.
      if (!alive && vp.i0 >= hi - FOLLOW_EPS) following = true
    }

    // -1..1, for a layer that wants to show the edge being pulled.
    const lo = minI0()
    const hi = maxI0()
    const slack = Math.max(1e-9, vp.span * 0.5)
    interaction.overscrollX =
      vp.i0 < lo ? clamp((vp.i0 - lo) / slack, -1, 0) : vp.i0 > hi ? clamp((vp.i0 - hi) / slack, 0, 1) : 0

    return autoscale(dt) || alive
  }

  // ── Painting ──────────────────────────────────────────────────────────────
  /**
   * Cacheable layers are clipped to the BODY, not to the price pane.
   *
   * Volume is a pure function of (data, viewport, theme) and belongs in the
   * bitmap like the candles do; clipping the bitmap to the price pane would
   * silently discard everything a cacheable volume layer drew.
   */
  const clipToBody = (c: CanvasRenderingContext2D) => {
    c.beginPath()
    c.rect(body.x, body.y, body.w, body.h)
    c.clip()
  }

  /** Paint the cacheable layers into the bitmap. `p` is the PRICE pane inside the
   *  bitmap — three screens wide, same height as on the live canvas — and the
   *  volume pane sits directly below it, exactly as it does on screen. */
  const cachePaint = (
    c: CanvasRenderingContext2D,
    v: Viewport,
    p: Rect,
    i0: number,
    i1: number,
  ) => {
    cacheRc.ctx = c
    cacheRc.plot = p
    cacheRc.volumePane = volumePane
      ? { x: p.x, y: p.y + p.h, w: p.w, h: volumePane.h }
      : null
    // Zero-size, on purpose: no cacheable layer has any business drawing into
    // an axis, and a zero rect makes that a no-op rather than a stripe painted
    // three screens wide.
    cacheRc.priceAxis = { x: p.w, y: 0, w: 0, h: p.h }
    cacheRc.timeAxis = { x: 0, y: p.h, w: p.w, h: 0 }
    cacheRc.scales = makeScales(v, p, dpr)
    cacheRc.data = data
    cacheRc.i0 = i0
    cacheRc.i1 = i1
    cacheRc.dpr = dpr
    cacheRc.theme = theme
    cacheRc.dt = 0
    cacheRc.now = rc.now
    for (const l of cached) l.draw(cacheRc as RenderCtx)
  }

  /** Fallback when there is no bitmap — jsdom, or a refused context. */
  const drawCachedLive = () => {
    for (const l of cached) l.draw(rc as RenderCtx)
  }

  const paint = (dt: number, now: number) => {
    if (!ctx) return
    const w = snap(cssW)
    const h = snap(cssH)

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, w, h)
    if (plot.w <= 0 || plot.h <= 0) return

    rc.ctx = ctx
    rc.plot = plot
    rc.volumePane = volumePane
    rc.priceAxis = priceAxis
    rc.timeAxis = timeAxis
    rc.scales = makeScales(vp, plot, dpr)
    rc.data = data
    rc.i0 = visibleLo()
    rc.i1 = visibleHi()
    rc.dpr = dpr
    rc.theme = theme
    rc.dt = dt
    rc.now = now

    // Axis chrome before anything else. §E's loading state turns on this: grid
    // and axes need no data, so real chrome is on screen from frame 1 rather
    // than a spinner over an empty box.
    if (priceAxis.w > 0 || timeAxis.h > 0) {
      ctx.fillStyle = theme.axisBg
      if (priceAxis.w > 0) ctx.fillRect(priceAxis.x, priceAxis.y, priceAxis.w, h - priceAxis.y)
      if (timeAxis.h > 0) ctx.fillRect(timeAxis.x, timeAxis.y, timeAxis.w, timeAxis.h)
      ctx.fillStyle = theme.axisBorder
      const hair = 1 / dpr
      if (priceAxis.w > 0) ctx.fillRect(priceAxis.x, 0, hair, h)
      if (timeAxis.h > 0) ctx.fillRect(0, timeAxis.y, plot.w, hair)
    }

    // The pane divider, drawn as chrome for the same reason the axis bands are:
    // it must be there on frame 1, before there is any data, and the volume
    // layer draws nothing at all when the series is empty. It is also the single
    // line four reviewers said was missing — with the strip merely tinted and no
    // rule under the candles, bar heights read as texture and a red wick
    // descending into red bars becomes genuinely ambiguous.
    if (volumePane && volumePane.h > 0 && volumePane.w > 0) {
      ctx.fillStyle = theme.axisBorder
      ctx.fillRect(volumePane.x, volumePane.y, volumePane.w, 1 / dpr)
    }

    if (cached.length) {
      ctx.save()
      clipToBody(ctx)
      if (cache.available) {
        const key: CacheKey = {
          barW: rc.scales.barW,
          p0: vp.p0,
          p1: vp.p1,
          i0: vp.i0,
          span: vp.span,
          len: data.length,
          themeRev,
          plotW: plot.w,
          plotH: plot.h,
          // Carried separately from plotH so the bitmap is sized for both panes
          // and any change to the split throws it away. Moving a pixel from the
          // price pane to the volume pane changes plotH too, but not every
          // resize that changes one changes the other.
          volumeH: volumePane ? volumePane.h : 0,
          dpr,
        }
        const reason = cache.stale(key)
        if (reason) {
          cache.rebuild(key, cachePaint)
          cachedRev = data.rev
        } else if (data.rev !== cachedRev) {
          // Only the forming bar changed. Patching its column inside the bitmap
          // keeps the live frame a pure blit — which is why a crosshair move
          // redraws no cacheable layer at all.
          cache.patchTail(cachePaint)
          cachedRev = data.rev
        }
        // Blitted over the body: one drawImage puts both panes back.
        if (!cache.blit(ctx, body, vp.i0)) drawCachedLive()
      } else {
        drawCachedLive()
      }
      ctx.restore()
    }

    // Live layers draw unclipped: the axes and the crosshair readout need the
    // axis rects, which are outside the plot by definition.
    for (const l of live) l.draw(rc as RenderCtx)
  }

  // ── The loop ──────────────────────────────────────────────────────────────
  const frame = (t: number) => {
    rafId = null
    renderNow(t)
    schedule()
  }

  /**
   * Schedule a frame only if there is a reason to.
   *
   * This early return is the whole of §D.6's battery story. Without it the chart
   * burns 60 frames a second staring at a market that has not moved.
   */
  const schedule = () => {
    if (destroyed || rafId !== null) return
    if (!dirty && !animating && !interaction.pressed) return
    if (typeof requestAnimationFrame !== 'function') return
    rafId = requestAnimationFrame(frame)
  }

  function renderNow(nowMs?: number) {
    if (destroyed) return
    const now = nowMs ?? clock()
    // First frame has no previous one to measure from; a dt of "now" would
    // integrate every spring straight to its target.
    const dt = lastMs < 0 ? 0 : clamp(now - lastMs, 0, MAX_FRAME_MS)
    lastMs = now

    if (layoutDirty) relayout()
    animating = step(dt)
    // The autoscale may have taken the price past an order of ten, which is a
    // wider axis and therefore a narrower plot.
    checkAxisWidth()
    if (layoutDirty) relayout()
    paint(dt, now)
    dirty = false
  }

  const invalidate = () => {
    if (destroyed) return
    dirty = true
    schedule()
  }

  // ── Public surface ────────────────────────────────────────────────────────
  const engine: ChartController = {
    get viewport() {
      return vp
    },
    get following() {
      return following
    },
    get interaction() {
      return interaction
    },
    get plot() {
      return plot
    },
    get volumePane() {
      return volumePane
    },
    get scales() {
      return rc.scales
    },

    setData(d: OhlcvColumns) {
      const grew = d.length > data.length && data.length > 0
      data = d
      if (d.length === 0) primed = false
      // A bar closed while pinned to the right edge: breathe by one bar rather
      // than stepping. Reduced motion takes the step.
      if (grew && following && !theme.reducedMotion) breatheMs = 0
      invalidate()
    },

    setTheme(t: ChartTheme) {
      theme = t
      themeRev++
      rc.theme = t
      // Colours are baked into the bitmap, so it has to go.
      labelBucket = Number.NaN
      layoutDirty = true
      invalidate()
    },

    addLayer(l: ChartLayer) {
      // Replace rather than duplicate: StrictMode's double mount adds every
      // layer twice, and two crosshairs at different alphas is a subtle mess.
      const at = layers.findIndex((x) => x.id === l.id)
      if (at >= 0) layers.splice(at, 1)
      layers.push(l)
      resort()
      invalidate()
    },

    removeLayer(id: string) {
      const at = layers.findIndex((x) => x.id === id)
      if (at < 0) return
      layers[at].dispose?.()
      layers.splice(at, 1)
      resort()
      invalidate()
    },

    setFollow(on: boolean) {
      following = on
      if (on) {
        breatheMs = -1
        pan.stop()
      }
      invalidate()
    },

    setSpan(span: number, anchorI?: number) {
      const next = clamp(span, opts.minSpan, opts.maxSpan)
      if (next === vp.span) return
      const anchor = anchorI ?? (following ? Math.max(0, data.length - 1) : vp.i0 + vp.span / 2)
      // Hold the anchor bar at the same pixel while the span changes around it.
      //
      // §C.2 writes this as `i0' = iC - (iC - i0)·(span'/span)`, which is right
      // only for an index convention with no half-bar offset. `scale.ts` puts
      // bar i's CENTRE at `(i - i0 + 0.5)·barW`, so the half has to be carried
      // through — without it a 2x zoom slides the chart by a quarter of a bar,
      // which is small enough to look like drift rather than a bug.
      vp.i0 = anchor + 0.5 - (anchor - vp.i0 + 0.5) * (next / vp.span)
      vp.span = next
      clampVp()
      invalidate()
    },

    invalidate,

    resize(w: number, hgt: number, ratio: number) {
      // §C.1: capped at 2. A 3x phone pays 2.25x the fill cost for a difference
      // nobody can see on 1px geometry.
      dpr = Math.min(Math.max(ratio || 1, 0.5), 2)
      cssW = Math.max(0, w)
      cssH = Math.max(0, hgt)
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      // Once, here. NEVER ctx.scale() inside a draw: it compounds, and one
      // missed restore turns the whole chart into a slow zoom.
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      labelBucket = Number.NaN
      layoutDirty = true
      invalidate()
    },

    renderNow,

    destroy() {
      // Idempotent. React 19 StrictMode mounts, unmounts and remounts, and a
      // teardown that is not safe twice leaves a second rAF loop running
      // forever against a canvas nobody can see.
      if (destroyed) return
      destroyed = true
      if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
      rafId = null
      for (const l of layers) l.dispose?.()
      layers.length = 0
      cached = []
      live = []
      cache.dispose()
      interaction.crosshair = null
      interaction.pressed = false
    },

    panBy(dxPx: number) {
      if (plot.w <= 0) return
      following = false
      breatheMs = -1
      pan.dim = vp.span
      if (pan.mode !== 'drag') {
        pan.value = vp.i0
        pan.stop()
        pan.beginDrag()
      }
      // Dragging right shows older bars, so i0 decreases — hence the sign.
      pan.drag((-dxPx * vp.span) / plot.w, minI0(), maxI0())
      vp.i0 = pan.value
      invalidate()
    },

    endPan(vxPx: number) {
      if (plot.w <= 0) return
      pan.dim = vp.span
      pan.endDrag((-vxPx * vp.span) / plot.w, minI0(), maxI0())
      if (pan.mode === 'idle' && vp.i0 >= maxI0() - FOLLOW_EPS) following = true
      invalidate()
    },

    beginPinch(cxPx: number) {
      pinchSpan0 = vp.span
      // The bar under the fingers at the START. Re-deriving it per event from
      // the live scales would let it drift as the zoom changes underneath.
      pinchAnchor = rc.scales.iOf(cxPx)
    },

    pinchTo(scale: number, cxPx: number) {
      if (plot.w <= 0 || !(scale > 0)) return
      following = false
      const next = clamp(pinchSpan0 / scale, opts.minSpan, opts.maxSpan)
      const barW = plot.w / next
      // Keep the anchor bar under the fingers wherever they have moved to, so
      // the gesture zooms and pans in one motion the way a map does.
      vp.span = next
      vp.i0 = pinchAnchor - (cxPx - plot.x) / barW + 0.5
      clampVp()
      invalidate()
    },

    endPinch() {
      pan.value = vp.i0
      pan.stop()
      if (vp.i0 >= maxI0() - FOLLOW_EPS) following = true
      invalidate()
    },

    zoomAt(factor: number, xPx: number) {
      if (!(factor > 0)) return
      engine.setSpan(vp.span / factor, rc.scales.iOf(xPx))
    },

    setCrosshair(x: number | null, y = 0) {
      if (x === null || plot.w <= 0) {
        interaction.crosshair = null
        invalidate()
        return
      }
      const i = clamp(Math.round(rc.scales.iOf(x)), 0, Math.max(0, data.length - 1))
      let p = rc.scales.pOf(y)
      if (data.length > 0) {
        const close = data.c[data.at(i)]
        // §E: magnetise to the close within 12px. It is what makes the readout
        // agree with the candle the user is obviously pointing at.
        if (Math.abs(rc.scales.yOf(close) - y) <= MAGNET_PX) p = close
      }
      crosshair.x = x
      crosshair.y = y
      crosshair.i = i
      crosshair.p = p
      interaction.crosshair = crosshair
      invalidate()
    },
  }

  return engine
}
