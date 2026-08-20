// Touch, mouse and wheel input for the chart canvas.
//
// Everything here is a native listener registered with `{ passive: false }`, and
// that is not a style preference — it is the difference between the chart working
// on iOS and not.
//
// React attaches `touchstart` and `touchmove` PASSIVELY at the root container, so
// an `onTouchStart` handler calling `preventDefault()` does nothing at all: the
// browser has already committed to scrolling. This repo has been bitten by it
// twice (Keypad.tsx:176-186, Modal.tsx:118-120), and a chart is the worst place
// for it — every pan would scroll the page instead of the candles.
//
// Three more iOS specifics, each of which looks like a different bug:
//
//   gesturestart/gesturechange   Safari fires these for pinch INDEPENDENTLY of
//                                touch-action, so without swallowing them the
//                                whole PAGE zooms while the chart also zooms.
//   pointercancel                Safari reclaims a gesture it decides is a
//                                scroll. Ignoring the event leaves the crosshair
//                                painted on screen with nothing driving it, so
//                                it is treated as a zero-velocity release.
//   touch-action / callout       Set on the element here rather than in CSS, so
//                                that attaching the gestures and suppressing the
//                                behaviours they fight can never drift apart.
//                                It goes on the canvas ONLY: touchDrag.ts:16-17
//                                notes that an ancestor with touch-action:none
//                                also forbids panning its descendants, which
//                                would kill the page's own scrolling.

export interface GestureHandlers {
  onPanStart?(): void
  onPan(dx: number, dy: number): void
  /** Velocity in CSS px/s, measured over the last `flingWindowMs`. */
  onPanEnd(vx: number, vy: number): void
  /** `scale` is CUMULATIVE since onPinchStart, low-passed. `cx`/`cy` are the
   *  current centroid in element coordinates. */
  onPinch(scale: number, cx: number, cy: number): void
  /** Not in the §A.4 sketch. Without it the consumer cannot capture the
   *  viewport the cumulative scale is relative to, and would have to infer the
   *  start of a pinch from a scale that happens to be near 1. */
  onPinchStart?(cx: number, cy: number): void
  onPinchEnd?(): void
  onTap?(x: number, y: number): void
  onLongPress?(x: number, y: number): void
  onHoverMove?(x: number, y: number): void
  onHoverEnd?(): void
  onWheel?(dy: number, x: number, ctrl: boolean): void
}

export interface GestureOptions {
  /** Movement before a press is a pan and not a tap or a long press. */
  slop: number
  longPressMs: number
  flingWindowMs: number
  /**
   * `touch-action` to impose while attached. The default 'none' claims every
   * touch, which is right for a chart that owns the screen. A chart embedded in
   * a scrollable page wants 'pan-y': the browser keeps vertical page scroll,
   * horizontal drags still reach us, and pinch-zoom stays disabled either way.
   */
  touchAction?: string
}

export const DEFAULT_GESTURE_OPTIONS: Readonly<GestureOptions> = Object.freeze({
  slop: 6,
  longPressMs: 260,
  flingWindowMs: 100,
  touchAction: 'none',
})

/**
 * Raw touch distance is jittery enough to be visible as a shimmer in the bar
 * width, so the pinch scale is low-passed. 0.7/0.3 is heavy enough to kill the
 * jitter and light enough that the zoom still tracks the fingers.
 */
const PINCH_SMOOTHING = 0.7

/** Samples kept for the fling velocity window. A 100ms window at 120Hz is 12. */
const MAX_SAMPLES = 16

interface Sample {
  t: number
  x: number
  y: number
}

interface Pointer {
  x: number
  y: number
}

/**
 * Attach the chart's gestures. The returned disposer is IDEMPOTENT — React 19
 * StrictMode mounts, unmounts and remounts, and a disposer that throws or
 * half-removes on the second call leaves duplicate listeners behind, which shows
 * up as a pan that moves at double speed.
 */
export function attachGestures(
  el: HTMLElement,
  h: GestureHandlers,
  o?: Partial<GestureOptions>,
): () => void {
  const opts: GestureOptions = { ...DEFAULT_GESTURE_OPTIONS, ...o }

  // Every listener is registered through this so that dispose() cannot miss one.
  // A missed listener on a remount is invisible until the pan runs at 2x.
  const bound: [string, EventListener][] = []
  const on = (type: string, fn: EventListener) => {
    // passive:false everywhere, including on the pointer events that do not
    // strictly need it. Uniformity is the point: the one listener someone later
    // adds without thinking inherits the right default from its neighbours.
    el.addEventListener(type, fn, { passive: false })
    bound.push([type, fn])
  }

  const pointers = new Map<number, Pointer>()
  const samples: Sample[] = []

  let mode: 'none' | 'press' | 'pan' | 'pinch' | 'hover' = 'none'
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastY = 0
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let pinchStartDist = 0
  let pinchScale = 1
  let capturedId: number | null = null
  let disposed = false

  /**
   * Event time, in the same clock the velocity window uses.
   *
   * NOT `e.timeStamp || Date.now()`. A timeStamp of 0 is legitimate — it is an
   * event dispatched at the document's time origin — and falling through to
   * Date.now() for it mixes an epoch timestamp into a window of high-resolution
   * ones. The window then spans ~1.7e12 ms, every sample looks recent, and the
   * fling velocity comes out as exactly zero.
   */
  const stamp = (e: Event) => (Number.isFinite(e.timeStamp) ? e.timeStamp : Date.now())

  const pos = (e: { clientX: number; clientY: number }) => {
    // getBoundingClientRect rather than offsetX/offsetY: offsetX is relative to
    // whatever the event's target turned out to be, which for a canvas with
    // overlaid DOM chrome is not always the canvas.
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const clearLongPress = () => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  const pushSample = (t: number, x: number, y: number) => {
    samples.push({ t, x, y })
    if (samples.length > MAX_SAMPLES) samples.shift()
  }

  /**
   * Velocity over the fling window, in px/s.
   *
   * Measured across the window rather than from the last two events on purpose:
   * consecutive pointermoves can be 2ms apart, and dividing a 1px move by 2ms
   * produces 500 px/s of noise that sends the chart flying off a gesture the
   * user experienced as a stop.
   */
  const velocity = (now: number): { vx: number; vy: number } => {
    let oldest: Sample | null = null
    for (const s of samples) {
      if (now - s.t <= opts.flingWindowMs) {
        oldest = s
        break
      }
    }
    const last = samples[samples.length - 1]
    if (!oldest || !last || last === oldest) return { vx: 0, vy: 0 }
    const dt = (last.t - oldest.t) / 1000
    if (dt <= 0) return { vx: 0, vy: 0 }
    return { vx: (last.x - oldest.x) / dt, vy: (last.y - oldest.y) / dt }
  }

  const centroid = () => {
    let x = 0
    let y = 0
    for (const p of pointers.values()) {
      x += p.x
      y += p.y
    }
    const n = pointers.size || 1
    return { x: x / n, y: y / n }
  }

  const spread = () => {
    const it = pointers.values()
    const a = it.next().value
    const b = it.next().value
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const beginPinch = () => {
    clearLongPress()
    // A pan already in flight is ended cleanly rather than abandoned, or the
    // consumer is left with an open drag it will never see the end of.
    if (mode === 'pan') h.onPanEnd(0, 0)
    if (mode === 'hover') h.onHoverEnd?.()
    mode = 'pinch'
    pinchStartDist = spread()
    pinchScale = 1
    const c = centroid()
    h.onPinchStart?.(c.x, c.y)
  }

  /** The single exit path for every way an interaction can end. */
  const finish = (vx: number, vy: number) => {
    clearLongPress()
    if (mode === 'pan') h.onPanEnd(vx, vy)
    else if (mode === 'pinch') h.onPinchEnd?.()
    else if (mode === 'hover') h.onHoverEnd?.()
    mode = 'none'
    samples.length = 0
  }

  const onPointerDown = (ev: Event) => {
    const e = ev as PointerEvent
    // Ignore a second mouse button; only touch and the primary button drive the
    // chart. A right-click must be free to open a context menu.
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const p = pos(e)
    pointers.set(e.pointerId, p)

    if (pointers.size === 2) {
      beginPinch()
      return
    }
    if (pointers.size > 2) return

    // Capture so a drag that leaves the canvas keeps delivering moves. jsdom has
    // no pointer capture at all, and neither do older Safaris, so it is probed
    // rather than assumed — the same guard Plot.tsx:39 uses for ResizeObserver.
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId)
        capturedId = e.pointerId
      } catch {
        // Safari throws if the pointer is already gone. Not fatal: without
        // capture the gesture still works as long as the finger stays put.
        capturedId = null
      }
    }

    mode = 'press'
    startX = p.x
    startY = p.y
    lastX = p.x
    lastY = p.y
    samples.length = 0
    pushSample(stamp(e), p.x, p.y)

    clearLongPress()
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      // Only promotes if the finger never travelled: a long press that moved is
      // a slow pan, and turning that into a crosshair would be maddening.
      if (mode !== 'press') return
      mode = 'hover'
      h.onLongPress?.(startX, startY)
    }, opts.longPressMs)
  }

  const onPointerMove = (ev: Event) => {
    const e = ev as PointerEvent

    // A mouse moving with no button down is a hover, which drives the crosshair
    // directly — desktop has no long press and should not need one.
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && mode === 'none') {
        const p = pos(e)
        h.onHoverMove?.(p.x, p.y)
      }
      return
    }

    const p = pos(e)
    pointers.set(e.pointerId, p)
    const t = stamp(e)

    if (mode === 'pinch') {
      if (ev.cancelable) ev.preventDefault()
      const d = spread()
      if (pinchStartDist > 0 && d > 0) {
        const raw = d / pinchStartDist
        pinchScale = PINCH_SMOOTHING * pinchScale + (1 - PINCH_SMOOTHING) * raw
        const c = centroid()
        h.onPinch(pinchScale, c.x, c.y)
      }
      return
    }

    pushSample(t, p.x, p.y)

    if (mode === 'press') {
      // Slop: a finger never presses without moving a couple of pixels, and
      // without this every tap would emit a tiny pan and cancel its own tap.
      if (Math.hypot(p.x - startX, p.y - startY) < opts.slop) return
      clearLongPress()
      mode = 'pan'
      h.onPanStart?.()
    }

    if (mode === 'pan') {
      if (ev.cancelable) ev.preventDefault()
      h.onPan(p.x - lastX, p.y - lastY)
    } else if (mode === 'hover') {
      if (ev.cancelable) ev.preventDefault()
      h.onHoverMove?.(p.x, p.y)
    }
    lastX = p.x
    lastY = p.y
  }

  const releasePointer = (id: number) => {
    pointers.delete(id)
    if (capturedId === id && typeof el.releasePointerCapture === 'function') {
      try {
        el.releasePointerCapture(id)
      } catch {
        // Already released by the browser; nothing to undo.
      }
      capturedId = null
    }
  }

  const onPointerUp = (ev: Event) => {
    const e = ev as PointerEvent
    if (!pointers.has(e.pointerId)) return
    const t = stamp(e)
    releasePointer(e.pointerId)

    if (mode === 'pinch') {
      // One finger lifted from a pinch. Ending outright rather than degrading
      // into a pan, because the remaining finger is almost never where the user
      // thinks it is and the chart would lurch.
      finish(0, 0)
      // The still-down finger must not start a new gesture on its next move.
      pointers.clear()
      return
    }

    if (mode === 'press') {
      clearLongPress()
      mode = 'none'
      h.onTap?.(startX, startY)
      samples.length = 0
      return
    }

    const v = mode === 'pan' ? velocity(t) : { vx: 0, vy: 0 }
    finish(v.vx, v.vy)
  }

  const onPointerCancel = (ev: Event) => {
    const e = ev as PointerEvent
    if (!pointers.has(e.pointerId)) return
    releasePointer(e.pointerId)
    // Zero velocity, never a dropped interaction. Safari fires this the moment
    // it decides the gesture was a page scroll, and simply returning here is
    // what strands a crosshair on screen with nothing left to dismiss it.
    finish(0, 0)
    pointers.clear()
  }

  const onPointerLeave = () => {
    // Only a hovering mouse cares; a touch that leaves the element is still
    // captured and still panning.
    if (mode === 'none') h.onHoverEnd?.()
  }

  const onWheel = (ev: Event) => {
    const e = ev as WheelEvent
    if (!h.onWheel) return
    // Non-passive so this can actually be prevented: a trackpad pinch arrives as
    // wheel+ctrlKey, and without preventDefault the browser page zooms.
    if (ev.cancelable) ev.preventDefault()
    const p = pos(e)
    // deltaMode 1 is lines, 2 is pages. Firefox uses lines; treating 3 lines as
    // 3 pixels would make the wheel almost inert there.
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
    h.onWheel(e.deltaY * scale, p.x, e.ctrlKey || e.metaKey)
  }

  /** iOS pinch. Must be swallowed or the PAGE zooms even with touch-action:none. */
  const swallow = (ev: Event) => {
    if (ev.cancelable) ev.preventDefault()
  }

  // touchstart/touchmove are swallowed on top of the pointer handling above.
  // Pointer events on iOS do not reliably suppress the scroll on their own, and
  // this is the listener React cannot give us — see the file header.
  const onTouch = (ev: Event) => {
    const e = ev as TouchEvent
    // A single touch is left alone until it becomes a pan, so that a tap can
    // still focus something and the page can still scroll off a stray graze
    // that the chart is not using.
    if (mode === 'pan' || mode === 'pinch' || mode === 'hover' || e.touches.length > 1) {
      if (ev.cancelable) ev.preventDefault()
    }
  }

  on('pointerdown', onPointerDown)
  on('pointermove', onPointerMove)
  on('pointerup', onPointerUp)
  on('pointercancel', onPointerCancel)
  on('pointerleave', onPointerLeave)
  on('wheel', onWheel)
  on('touchstart', onTouch)
  on('touchmove', onTouch)
  on('gesturestart', swallow)
  on('gesturechange', swallow)
  on('gestureend', swallow)
  // A long press on Android and desktop raises the context menu over the
  // crosshair the same long press just opened.
  on('contextmenu', swallow)

  // Style the element for gestures here rather than in a stylesheet, so the
  // suppressions can never be separated from the handlers that need them.
  const prevTouchAction = el.style.touchAction
  const prevUserSelect = el.style.userSelect
  const prevCallout = el.style.getPropertyValue('-webkit-touch-callout')
  el.style.touchAction = opts.touchAction ?? 'none'
  el.style.userSelect = 'none'
  el.style.setProperty('-webkit-touch-callout', 'none')

  return () => {
    if (disposed) return
    disposed = true
    clearLongPress()
    for (const [type, fn] of bound) el.removeEventListener(type, fn)
    bound.length = 0
    pointers.clear()
    samples.length = 0
    mode = 'none'
    el.style.touchAction = prevTouchAction
    el.style.userSelect = prevUserSelect
    if (prevCallout) el.style.setProperty('-webkit-touch-callout', prevCallout)
    else el.style.removeProperty('-webkit-touch-callout')
  }
}
