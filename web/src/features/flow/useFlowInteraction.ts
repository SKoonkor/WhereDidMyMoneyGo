// Pan, zoom and hold-to-inspect for the Money Flow chart.
//
// The paper-trading chart gets all of this from its own canvas renderer; this is
// the same behaviour expressed against Plotly. Two things drive the design:
//
//   1. None of it goes through React state. Panning re-runs `Plotly.relayout` on
//      a rAF loop; putting the range in state would rebuild the whole figure
//      sixty times a second. The live window lives in `viewRef` and in the
//      Plotly DOM, and is re-applied through `<Plot onRender>` after every react.
//   2. Plotly's own drag is switched off (`interactive` on the figure), because
//      a listener on the wrapper fires after Plotly's drag layer and the two
//      would pan the chart twice. `attachGestures` from the trading chart owns
//      the input instead — it already handles the iOS pinch/pointercancel/
//      context-menu cases that took two rounds to get right there.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlowData } from '../../lib/analytics/moneyflow'
import type { Forecast } from '../../lib/analytics/forecast'
import { attachGestures } from '../../lib/chart/gestures'
import { createSpring, easeOutCubic } from '../../lib/chart/physics'
import {
  buildFlowYSource, flowYRange, padFlowY, flowDefaultRange, flowDataBounds,
  type FlowHighlightSpec,
} from './figure'
import {
  plotBox, xFromPx, pxFromX, panView, zoomView, clampView, FLOW_MIN_SPAN_MS, flowMaxSpan,
  type FlowView, type PlotBox, type PlotMargin,
} from './view'
import { pickFlowPoint, flowDayMs, flowDayCentreMs, type FlowPoint } from './readout'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plotly = any

// Softer than the overscroll spring, so the axis eases rather than snaps.
const AUTOSCALE_K = 90
// Don't retarget for a move smaller than this fraction of the range. Without it
// the gridlines shimmer on every single frame of a pan.
const AUTOSCALE_DEADBAND = 0.0035
const WHEEL_ZOOM = 1.1
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 24
const RESET_MS = 250
/** The readout floats this far above the finger, or the finger covers it. */
export const READOUT_OFFSET_PX = 44
/** Below this the readout would hang off the top, so it flips under the finger. */
const READOUT_MIN_TOP_PX = 96
/** Keep the label's centre this far inside the plot box. Must be >= half of
 *  .flow-readout's max-width, or a wide readout can still overflow the card. */
const READOUT_INSET = 0.3
/** Stand-in day for a position with no bars to highlight (every forecast day).
 * Not a real day key — those are multiples of a day — so the Map lookup misses
 * and the selection comes out empty. The point is that ALL such positions share
 * ONE value, so scrubbing the length of the forecast costs a single restyle
 * instead of one per day for an identical empty selection. */
const NO_BARS_DAY = -1

export interface FlowReadout {
  point: FlowPoint
  /** Element-relative pixels, snapped to the picked day. */
  px: number
  /** Where the label sits: `px` pulled inside the box so it can't overflow the
   *  card at the edges. The crosshair still marks the true spot. */
  labelPx: number
  py: number
  /** Not enough room above the finger — render it below instead. */
  below: boolean
}

export function useFlowInteraction(args: {
  flow: FlowData
  fc: Forecast | null
  /** The figure's layout — margins and height are read from it so the pixel
   *  mapping always matches what Plotly actually drew (the left margin flips
   *  with censor mode). */
  layout: Record<string, unknown>
  /** Which traces the held-day highlight drives (buildFlowFigure emits it). */
  highlight: FlowHighlightSpec
  defaultDays: number
  /** False for the empty figure, which has no axes to drive. */
  enabled: boolean
  /** Changing this drops the live view: a new default window has taken over. */
  resetKey: string
}): {
  wrapRef: React.RefObject<HTMLDivElement | null>
  onRender: (gd: HTMLDivElement, plotly: Plotly) => void
  readout: FlowReadout | null
  inspecting: boolean
} {
  const { flow, fc, layout, highlight, defaultDays, enabled, resetKey } = args

  const wrapRef = useRef<HTMLDivElement>(null)
  const gdRef = useRef<HTMLDivElement | null>(null)
  const plotlyRef = useRef<Plotly>(null)
  const viewRef = useRef<FlowView | null>(null)

  const [readout, setReadout] = useState<FlowReadout | null>(null)
  // Latched by the long press and cleared only by a tap or a new gesture.
  // Deriving it from `readout !== null` instead looked equivalent but was not:
  // dragging across a gap in the data clears the readout, which would then read
  // as "this is a desktop mouse" and arm Plotly's own tooltip mid-touch.
  const inspectingRef = useRef(false)

  const reducedMotion = useMemo(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const ySrc = useMemo(() => buildFlowYSource(flow, fc), [flow, fc])
  const bounds = useMemo(() => flowDataBounds(flow, fc), [flow, fc])
  const defaults = useMemo(() => flowDefaultRange(flow, fc, defaultDays), [flow, fc, defaultDays])
  const hasIncome = useMemo(() => flow.bars.some((b) => b.type === 'Income'), [flow])
  const maxSpan = useMemo(
    () => flowMaxSpan(bounds, defaults.x1 - defaults.x0),
    [bounds, defaults],
  )

  // Everything the rAF loop and the gesture handlers read, held in refs so the
  // listeners can be attached once and never re-bound mid-gesture.
  // day -> the point indices on that day, per bar trace. Built once per figure so
  // that moving the crosshair onto a new day is a map lookup, not a scan over
  // every bar in the ledger.
  const dayIndex = useMemo(
    () => highlight.barDays.map((days) => {
      const m = new Map<number, number[]>()
      days.forEach((d, i) => {
        const hit = m.get(d)
        if (hit) hit.push(i)
        else m.set(d, [i])
      })
      return m
    }),
    [highlight],
  )

  // The forecast restyles, grouped by property. Plotly maps an ARRAY value across
  // the trace list it is given, so the two fan fills go in a single call — two
  // restyles per crossing instead of three, measured at 35-40% cheaper. Grouped
  // once here rather than per crossing.
  const fcGroups = useMemo(() => {
    const by = new Map<string, { traces: number[]; dim: string[]; normal: string[] }>()
    for (const f of highlight.forecast) {
      const g = by.get(f.prop) ?? { traces: [], dim: [], normal: [] }
      g.traces.push(f.trace)
      g.dim.push(f.dim)
      g.normal.push(f.normal)
      by.set(f.prop, g)
    }
    return [...by.entries()]
  }, [highlight])

  const live = useRef({ ySrc, bounds, defaults, hasIncome, maxSpan, flow, fc, layout, highlight, dayIndex, fcGroups })
  live.current = { ySrc, bounds, defaults, hasIncome, maxSpan, flow, fc, layout, highlight, dayIndex, fcGroups }

  /** The day currently painted. `undefined` means Plotly re-rendered under us
   *  and wiped the highlight, which is why it differs from a deliberate null. */
  const appliedDay = useRef<number | null | undefined>(null)
  /** Whether the forecast is currently painted dim. Tracked separately from the
   *  day because it does NOT follow it one-for-one — see applyHighlight. */
  const appliedFcDim = useRef<boolean | undefined>(false)
  /** The day the readout is showing, so onRender can repaint after a react(). */
  const readoutDay = useRef<number | null>(null)

  const springLo = useMemo(() => createSpring(AUTOSCALE_K), [])
  const springHi = useMemo(() => createSpring(AUTOSCALE_K), [])
  const primed = useRef(false)
  const rafRef = useRef(0)
  const lastTs = useRef(0)
  const resetRaf = useRef(0)
  const hoverMode = useRef<false | 'closest'>(false)

  const boxOf = useCallback((): PlotBox | null => {
    const el = wrapRef.current
    const m = live.current.layout.margin as PlotMargin | undefined
    const figH = live.current.layout.height as number | undefined
    if (!el || !m || typeof figH !== 'number') return null
    const w = el.clientWidth
    if (w <= 0) return null
    return plotBox(w, figH, m)
  }, [])

  const viewOf = useCallback((): FlowView => viewRef.current ?? { ...live.current.defaults }, [])

  // ── The render loop ────────────────────────────────────────────────────────
  // x tracks the finger exactly (a sprung x would lag the gesture); y is sprung,
  // so the axis eases into its new fit instead of jumping on every frame.
  const tick = useCallback((ts: number) => {
    const v = viewRef.current
    const gd = gdRef.current
    const P = plotlyRef.current
    if (!v || !gd || !P) { rafRef.current = 0; lastTs.current = 0; return }

    const dt = lastTs.current ? ts - lastTs.current : 16
    lastTs.current = ts

    const box = boxOf()
    const areaPx = box ? box.height : 1
    const fit = flowYRange(live.current.ySrc, v.x0, v.x1)
    if (fit) {
      const [t0, t1] = padFlowY(fit.lo, fit.hi, areaPx, live.current.hasIncome)
      if (!primed.current) {
        springLo.snap(t0)
        springHi.snap(t1)
        primed.current = true
      } else {
        const range = Math.max(1e-12, springHi.target - springLo.target)
        const band = range * AUTOSCALE_DEADBAND
        if (Math.abs(t0 - springLo.target) > band) springLo.target = t0
        if (Math.abs(t1 - springHi.target) > band) springHi.target = t1
      }
    }

    // Settle once the remaining error is under half a pixel on screen — below
    // that the spring is holding the loop awake for something nobody can see.
    const range = Math.max(1e-12, springHi.value - springLo.value)
    const eps = areaPx > 0 ? (range / areaPx) * 0.5 : range * 1e-4
    springLo.epsilon = eps
    springHi.epsilon = eps

    let alive = false
    if (reducedMotion) {
      springLo.snap(springLo.target)
      springHi.snap(springHi.target)
    } else {
      // Both, every frame — `||` would short-circuit and leave one un-stepped.
      const a = springLo.update(dt)
      const b = springHi.update(dt)
      alive = a || b
    }

    P.relayout(gd, {
      'xaxis.range': [v.x0, v.x1],
      'yaxis.range': [springLo.value, springHi.value],
    })

    if (alive) rafRef.current = requestAnimationFrame(tick)
    else { rafRef.current = 0; lastTs.current = 0 }
  }, [boxOf, reducedMotion, springLo, springHi])

  const kick = useCallback(() => {
    if (rafRef.current) return
    lastTs.current = 0
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  // ── Held-day highlight ─────────────────────────────────────────────────────
  // The whole reason this stays affordable: it returns immediately unless the
  // day changed, capping the work at one restyle per pointermove rather than one
  // unconditionally. Don't read more into the margin than that — at the default
  // 90-day window on a phone a day is only ~4px, so a brisk drag crosses days
  // about as fast as the pointer reports.
  //
  // `selectedpoints` is editType "calc", NOT style: Plotly rebuilds the trace's
  // calcdata and does not short-circuit an unchanged value. Measured ~8ms at 400
  // bars to ~37ms at 5000 — comparable to one frame of the pan loop that already
  // ships. Setting marker.color arrays instead measured no cheaper, so this is
  // the right mechanism and the guard is what makes it affordable.
  const applyHighlight = useCallback((day: number | null) => {
    if (day === appliedDay.current) return
    const gd = gdRef.current
    const P = plotlyRef.current
    const spec = live.current.highlight
    if (!gd || !P || spec.barTraces.length === 0) return

    appliedDay.current = day

    P.restyle(
      gd,
      {
        selectedpoints: day === null
          ? spec.barTraces.map(() => null)
          // sliced: Plotly's selection code appends to this array in some modes,
          // which would grow the cached entry permanently.
          : live.current.dayIndex.map((m) => (m.get(day) ?? []).slice()),
      },
      spec.barTraces,
    )

    // The forecast dims only while a REAL day is held. On a forecast day the
    // crosshair is ON the forecast, so dimming it would grey out the very thing
    // being inspected — there the bars grey and the forecast keeps its colour.
    // Tracked on its own flag rather than derived from the day, so crossing
    // between two real days still costs nothing.
    const dim = day !== null && day !== NO_BARS_DAY
    if (dim !== appliedFcDim.current) {
      appliedFcDim.current = dim
      for (const [prop, g] of live.current.fcGroups) {
        P.restyle(gd, { [prop]: dim ? g.dim : g.normal }, g.traces)
      }
    }
  }, [])

  // ── Readout ────────────────────────────────────────────────────────────────
  /** True when it found something to show. */
  const showAt = useCallback((x: number, y: number): boolean => {
    const box = boxOf()
    if (!box) return false
    const v = viewOf()
    const point = pickFlowPoint(live.current.flow, live.current.fc, xFromPx(x, v.x0, v.x1, box))
    // Off the end of the data: hold what is on screen rather than tearing the
    // readout down, so dragging back onto the data picks up where it left off.
    if (!point) return false
    readoutDay.current = point.isForecast ? NO_BARS_DAY : flowDayMs(point.dateIso)
    applyHighlight(readoutDay.current)
    // Bars are packed ACROSS their day, so the crosshair belongs at the day's
    // centre or it sits half a day to the left of what it points at. The
    // forecast is different: its traces are plotted at the date itself
    // (midnight), so there the centre would miss the very point whose value the
    // readout is printing.
    const px = pxFromX(
      point.isForecast ? flowDayMs(point.dateIso) : flowDayCentreMs(point.dateIso),
      v.x0, v.x1, box,
    )
    // Pairs with .flow-readout's max-width: 60%. Half of 60% is 30%, so a
    // centred label clamped to this inset provably stays inside the box —
    // no measuring the rendered element.
    const inset = box.width * READOUT_INSET
    setReadout({
      point,
      px,
      labelPx: Math.min(Math.max(px, box.left + inset), box.left + box.width - inset),
      py: y,
      below: y - READOUT_OFFSET_PX < READOUT_MIN_TOP_PX,
    })
    return true
  }, [boxOf, viewOf, applyHighlight])

  const dismiss = useCallback(() => {
    inspectingRef.current = false
    readoutDay.current = null
    applyHighlight(null)
    setReadout(null)
  }, [applyHighlight])

  // Plotly's own hover is built off (`hovermode: false`) so it can't fire on
  // touchstart alongside the readout. A real mouse turns it back on — that is
  // the one input where the native tooltip is the better answer.
  const enableMouseHover = useCallback(() => {
    if (hoverMode.current === 'closest') return
    hoverMode.current = 'closest'
    const gd = gdRef.current
    const P = plotlyRef.current
    if (gd && P) P.relayout(gd, { hovermode: 'closest' })
  }, [])

  const resetView = useCallback(() => {
    const from = viewRef.current
    const to = live.current.defaults
    if (!from) return
    if (resetRaf.current) { cancelAnimationFrame(resetRaf.current); resetRaf.current = 0 }
    if (reducedMotion) { viewRef.current = { ...to }; kick(); return }
    const t0 = performance.now()
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / RESET_MS)
      const e = easeOutCubic(p)
      viewRef.current = {
        x0: from.x0 + (to.x0 - from.x0) * e,
        x1: from.x1 + (to.x1 - from.x1) * e,
      }
      kick()
      resetRaf.current = p < 1 ? requestAnimationFrame(step) : 0
    }
    step()
  }, [kick, reducedMotion])

  const stopReset = useCallback(() => {
    if (resetRaf.current) { cancelAnimationFrame(resetRaf.current); resetRaf.current = 0 }
  }, [])

  // ── Gestures ───────────────────────────────────────────────────────────────
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const pinch = useRef<{ v: FlowView; } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || !enabled) return

    const detach = attachGestures(el, {
      onPanStart: () => { stopReset(); dismiss() },
      onPan: (dx) => {
        const box = boxOf()
        if (!box) return
        viewRef.current = clampView(panView(viewOf(), dx, box), live.current.bounds)
        kick()
      },
      onPanEnd: () => {},
      onPinchStart: () => { stopReset(); dismiss(); pinch.current = { v: viewOf() } },
      onPinch: (scale, cx) => {
        const box = boxOf()
        const p = pinch.current
        if (!box || !p) return
        // `scale` is cumulative since the pinch began, so it must be applied to
        // the snapshot, never to the live view — compounding it per event zooms
        // exponentially. The anchor is where the fingers are NOW, so the zoom
        // follows the centroid as it moves.
        const next = zoomView(p.v, scale, cx, box, FLOW_MIN_SPAN_MS, live.current.maxSpan)
        viewRef.current = clampView(next, live.current.bounds)
        kick()
      },
      onPinchEnd: () => { pinch.current = null },
      // Only latch when there was something to show: a press on blank chart
      // would otherwise hold inspect mode open and keep the desktop tooltip
      // suppressed until the next tap.
      onLongPress: (x, y) => { stopReset(); if (showAt(x, y)) inspectingRef.current = true },
      onHoverMove: (x, y) => {
        // Two callers: a promoted long press dragging the readout, or a bare
        // desktop mouse move. Only the first should draw our own readout.
        if (inspectingRef.current) showAt(x, y)
        else enableMouseHover()
      },
      onTap: (x, y) => {
        const now = performance.now()
        const prev = lastTap.current
        if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_PX) {
          lastTap.current = null
          dismiss()
          resetView()
          return
        }
        lastTap.current = { t: now, x, y }
        dismiss()
      },
      // No onWheel: gestures.ts returns before preventDefault when it is absent,
      // which leaves plain wheel scrolling the page. Only a pinch-modified wheel
      // is claimed, below.
    }, {
      // The chart sits in a long scrollable page, unlike the trading chart which
      // owns the screen. 'pan-y' keeps vertical page scroll while still routing
      // horizontal drags here and still blocking browser pinch-zoom.
      touchAction: 'pan-y',
    })

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return // plain wheel belongs to the page
      e.preventDefault()
      const box = boxOf()
      if (!box) return
      stopReset()
      const x = e.clientX - el.getBoundingClientRect().left
      const factor = e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM
      const next = zoomView(viewOf(), factor, x, box, FLOW_MIN_SPAN_MS, live.current.maxSpan)
      viewRef.current = clampView(next, live.current.bounds)
      kick()
    }
    el.addEventListener('wheel', onWheel, { passive: false })

    // Any non-mouse press takes Plotly's hover back off, so a touch user never
    // gets the native tooltip competing with the held readout.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || hoverMode.current === false) return
      hoverMode.current = false
      const gd = gdRef.current
      const P = plotlyRef.current
      if (gd && P) P.relayout(gd, { hovermode: false })
    }
    el.addEventListener('pointerdown', onDown, { passive: true })

    return () => {
      detach()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
    }
  }, [enabled, boxOf, viewOf, kick, dismiss, showAt, enableMouseHover, resetView, stopReset])

  // A new default window (account or horizon changed) supersedes the live view.
  // Theme and censor deliberately do NOT reset it — they must preserve the zoom.
  useEffect(() => {
    stopReset() // a reset in flight still holds the OLD default window
    viewRef.current = null
    primed.current = false
    inspectingRef.current = false
    readoutDay.current = null
    applyHighlight(null) // else the old day stays painted under the new figure
    setReadout(null)
  }, [resetKey, stopReset, applyHighlight])

  // A gesture is not the only thing that invalidates the fit: the ledger can
  // change under a zoomed view (an import, another tab), and a container resize
  // changes the pixel headroom the pad is computed from.
  useEffect(() => { if (viewRef.current) kick() }, [ySrc, kick])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || !enabled || typeof ResizeObserver === 'undefined') return
    // Width only, for the reason Plot.tsx gives: Plots.resize mutates the graph
    // div's height, which propagates to this wrapper and would otherwise fire a
    // second, pointless kick on every resize.
    let lastW = el.getBoundingClientRect().width
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (!w || Math.abs(w - lastW) <= 1) return
      lastW = w
      if (viewRef.current) kick()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled, kick])

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (resetRaf.current) cancelAnimationFrame(resetRaf.current)
  }, [])

  const onRender = useCallback((gd: HTMLDivElement, P: Plotly) => {
    gdRef.current = gd
    plotlyRef.current = P
    // react() has just reset the axes to the figure's own range; put the live
    // window back before the browser paints.
    const v = viewRef.current
    const patch: Record<string, unknown> = {}
    if (v && primed.current) {
      patch['xaxis.range'] = [v.x0, v.x1]
      patch['yaxis.range'] = [springLo.value, springHi.value]
    }
    if (hoverMode.current === 'closest') patch.hovermode = 'closest'
    if (Object.keys(patch).length) P.relayout(gd, patch)

    // A react() with FRESH trace objects wipes selectedpoints and the dimmed
    // forecast colours, so the highlight has to be repainted. (With the same
    // trace objects it survives — restyle writes selectedpoints back onto them.)
    // The undefined sentinel stops applyHighlight short-circuiting on a day it
    // thinks is already painted.
    //
    // But only when there is something to paint or something to clear: this runs
    // on EVERY react, and the slider scrubs one per tick. Repainting an empty
    // highlight there cost a full calc-recalc plus three forecast restyles, 60
    // times a second, for no visible change.
    const day = readoutDay.current
    if (day !== null || appliedDay.current !== null) {
      appliedDay.current = undefined
      appliedFcDim.current = undefined
      applyHighlight(day)
    }
  }, [springLo, springHi, applyHighlight])

  return { wrapRef, onRender, readout, inspecting: readout !== null }
}
