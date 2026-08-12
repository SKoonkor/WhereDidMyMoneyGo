import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { attachGestures, type GestureHandlers } from './gestures'

/** Every handler, recorded. Tests assert on the calls, which is the only thing
 *  the consumer ever sees. */
function spies() {
  return {
    onPanStart: vi.fn(),
    onPan: vi.fn(),
    onPanEnd: vi.fn(),
    onPinch: vi.fn(),
    onPinchStart: vi.fn(),
    onPinchEnd: vi.fn(),
    onTap: vi.fn(),
    onLongPress: vi.fn(),
    onHoverMove: vi.fn(),
    onHoverEnd: vi.fn(),
    onWheel: vi.fn(),
  } satisfies GestureHandlers
}

/**
 * A pointer event with a timestamp we control.
 *
 * `timeStamp` is read-only on a real Event, and the fling velocity is measured
 * from it — so without pinning it the velocity tests would be measuring how fast
 * vitest happened to run.
 */
function pointer(
  type: string,
  id: number,
  x: number,
  y: number,
  t: number,
  init: PointerEventInit = {},
): PointerEvent {
  const e = new PointerEvent(type, {
    pointerId: id,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    pointerType: 'touch',
    ...init,
  })
  Object.defineProperty(e, 'timeStamp', { value: t })
  return e
}

let el: HTMLElement
let dispose: () => void

beforeEach(() => {
  el = document.createElement('canvas')
  document.body.appendChild(el)
})

afterEach(() => {
  dispose?.()
  el.remove()
  vi.useRealTimers()
})

describe('listener registration', () => {
  it('registers every listener natively and non-passively', () => {
    // The whole reason this module exists. React registers touchstart PASSIVELY
    // at the root, so preventDefault() from an onTouchStart prop is a no-op and
    // every pan would scroll the page instead of the chart.
    const add = vi.spyOn(el, 'addEventListener')
    dispose = attachGestures(el, spies())

    expect(add.mock.calls.length).toBeGreaterThan(0)
    for (const [, , options] of add.mock.calls) {
      expect(options).toMatchObject({ passive: false })
    }
  })

  it('listens for the events iOS needs swallowed', () => {
    const add = vi.spyOn(el, 'addEventListener')
    dispose = attachGestures(el, spies())
    const types = add.mock.calls.map((c) => c[0])
    // gesturestart/gesturechange are Safari-only and fire for pinch regardless
    // of touch-action; without these the PAGE zooms under the chart.
    expect(types).toContain('gesturestart')
    expect(types).toContain('gesturechange')
    expect(types).toContain('touchstart')
    expect(types).toContain('touchmove')
    expect(types).toContain('pointercancel')
    expect(types).toContain('contextmenu')
  })

  it('takes the element out of the browser gesture system', () => {
    dispose = attachGestures(el, spies())
    expect(el.style.touchAction).toBe('none')
    expect(el.style.userSelect).toBe('none')
    // -webkit-touch-callout is set too — a long press on iOS otherwise raises
    // the callout menu over the crosshair that same press just opened — but
    // jsdom's CSS engine drops vendor properties it does not know, so there is
    // nothing here to read back.
  })

  it('swallows the iOS pinch events', () => {
    dispose = attachGestures(el, spies())
    const e = new Event('gesturestart', { cancelable: true })
    el.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })
})

describe('the disposer', () => {
  it('removes every listener it added', () => {
    const add = vi.spyOn(el, 'addEventListener')
    const remove = vi.spyOn(el, 'removeEventListener')
    dispose = attachGestures(el, spies())
    const added = add.mock.calls.map((c) => `${c[0]}`)
    dispose()

    const removed = remove.mock.calls.map((c) => `${c[0]}`)
    expect(removed.sort()).toEqual(added.sort())
    // And the same function objects, not merely the same event names.
    for (const [type, fn] of add.mock.calls) {
      expect(remove.mock.calls).toContainEqual([type, fn])
    }
  })

  it('is idempotent', () => {
    // React 19 StrictMode mounts, unmounts and remounts. A disposer that throws
    // or half-removes on the second call leaves duplicate listeners, and the
    // symptom is a pan that runs at exactly double speed.
    const remove = vi.spyOn(el, 'removeEventListener')
    dispose = attachGestures(el, spies())
    dispose()
    const after = remove.mock.calls.length
    expect(() => dispose()).not.toThrow()
    expect(() => dispose()).not.toThrow()
    expect(remove.mock.calls.length).toBe(after)
  })

  it('stops delivering gestures once disposed', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    dispose()
    el.dispatchEvent(pointer('pointerdown', 1, 10, 10, 0))
    el.dispatchEvent(pointer('pointermove', 1, 90, 10, 20))
    expect(h.onPan).not.toHaveBeenCalled()
  })

  it('restores the styles it changed', () => {
    el.style.touchAction = 'pan-y'
    dispose = attachGestures(el, spies())
    dispose()
    expect(el.style.touchAction).toBe('pan-y')
  })
})

describe('pan', () => {
  it('waits for 6px of slop before a press becomes a pan', () => {
    // Without slop every tap emits a one-pixel pan and cancels its own tap.
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100, 0))
    el.dispatchEvent(pointer('pointermove', 1, 104, 100, 10))
    expect(h.onPanStart).not.toHaveBeenCalled()
    expect(h.onPan).not.toHaveBeenCalled()

    el.dispatchEvent(pointer('pointermove', 1, 110, 100, 20))
    expect(h.onPanStart).toHaveBeenCalledTimes(1)
    expect(h.onPan).toHaveBeenCalledTimes(1)
  })

  it('reports deltas from the previous move, not from the start', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100, 0))
    el.dispatchEvent(pointer('pointermove', 1, 120, 105, 10))
    el.dispatchEvent(pointer('pointermove', 1, 130, 110, 20))
    expect(h.onPan.mock.calls[0]).toEqual([20, 5])
    expect(h.onPan.mock.calls[1]).toEqual([10, 5])
  })

  it('measures fling velocity over the 100ms window', () => {
    // Not from the last two events: consecutive pointermoves can be 2ms apart,
    // and 1px in 2ms is 500px/s of pure noise on a gesture that had stopped.
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 0, 0, 0))
    el.dispatchEvent(pointer('pointermove', 1, 100, 0, 50))
    el.dispatchEvent(pointer('pointermove', 1, 200, 0, 100))
    el.dispatchEvent(pointer('pointerup', 1, 200, 0, 100))

    expect(h.onPanEnd).toHaveBeenCalledTimes(1)
    const [vx, vy] = h.onPanEnd.mock.calls[0]
    expect(vx).toBeCloseTo(2000, 3)
    expect(vy).toBeCloseTo(0, 6)
  })

  it('ignores movement older than the window', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 0, 0, 0))
    el.dispatchEvent(pointer('pointermove', 1, 500, 0, 30))
    // Then a slow crawl. A finger that raced and then stopped must not fling.
    el.dispatchEvent(pointer('pointermove', 1, 502, 0, 200))
    el.dispatchEvent(pointer('pointermove', 1, 504, 0, 300))
    el.dispatchEvent(pointer('pointerup', 1, 504, 0, 300))
    const [vx] = h.onPanEnd.mock.calls[0]
    expect(Math.abs(vx)).toBeLessThan(50)
  })

  it('emits a tap when the finger never left the slop', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 40, 60, 0))
    el.dispatchEvent(pointer('pointerup', 1, 42, 61, 30))
    expect(h.onTap).toHaveBeenCalledWith(40, 60)
    expect(h.onPanEnd).not.toHaveBeenCalled()
  })
})

describe('long press', () => {
  beforeEach(() => vi.useFakeTimers())

  it('opens the crosshair after 260ms and then follows the finger', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 50, 50, 0))
    vi.advanceTimersByTime(259)
    expect(h.onLongPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(h.onLongPress).toHaveBeenCalledWith(50, 50)

    el.dispatchEvent(pointer('pointermove', 1, 80, 90, 300))
    expect(h.onHoverMove).toHaveBeenCalledWith(80, 90)
    // A hover move is NOT a pan: the chart must stay still under the crosshair.
    expect(h.onPan).not.toHaveBeenCalled()
  })

  it('does not fire once the press has become a pan', () => {
    // A slow drag is a pan, not a long press. Promoting it would swap the
    // chart out from under a finger that was already moving it.
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 50, 50, 0))
    el.dispatchEvent(pointer('pointermove', 1, 80, 50, 100))
    vi.advanceTimersByTime(500)
    expect(h.onLongPress).not.toHaveBeenCalled()
  })

  it('ends the hover on release', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 50, 50, 0))
    vi.advanceTimersByTime(300)
    el.dispatchEvent(pointer('pointerup', 1, 50, 50, 300))
    expect(h.onHoverEnd).toHaveBeenCalledTimes(1)
  })

  it('does not leave a timer running after disposal', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 50, 50, 0))
    dispose()
    vi.advanceTimersByTime(1000)
    expect(h.onLongPress).not.toHaveBeenCalled()
  })
})

describe('pointercancel', () => {
  it('is a zero-velocity release, never a dropped interaction', () => {
    // Safari fires this the moment it reclaims the gesture as a page scroll.
    // Returning early here is what strands a crosshair on screen forever.
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 0, 0, 0))
    el.dispatchEvent(pointer('pointermove', 1, 200, 0, 50))
    el.dispatchEvent(pointer('pointercancel', 1, 200, 0, 60))

    expect(h.onPanEnd).toHaveBeenCalledTimes(1)
    expect(h.onPanEnd).toHaveBeenCalledWith(0, 0)
  })

  it('dismisses an open crosshair', () => {
    vi.useFakeTimers()
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 50, 50, 0))
    vi.advanceTimersByTime(300)
    el.dispatchEvent(pointer('pointercancel', 1, 50, 50, 300))
    expect(h.onHoverEnd).toHaveBeenCalledTimes(1)
  })

  it('leaves no pointer behind to poison the next gesture', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 0, 0, 0))
    el.dispatchEvent(pointer('pointercancel', 1, 0, 0, 10))
    // If the cancelled pointer were still in the map this second press would be
    // counted as a second finger and start a pinch out of nowhere.
    el.dispatchEvent(pointer('pointerdown', 2, 10, 10, 20))
    el.dispatchEvent(pointer('pointermove', 2, 60, 10, 30))
    expect(h.onPinchStart).not.toHaveBeenCalled()
    expect(h.onPan).toHaveBeenCalledTimes(1)
  })
})

describe('pinch', () => {
  it('reports a cumulative scale about the centroid', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100, 0))
    el.dispatchEvent(pointer('pointerdown', 2, 200, 100, 5))
    expect(h.onPinchStart).toHaveBeenCalledWith(150, 100)

    el.dispatchEvent(pointer('pointermove', 2, 300, 100, 20))
    const [scale, cx, cy] = h.onPinch.mock.calls[0]
    // Raw scale is 2; low-passed from 1 that is 0.7*1 + 0.3*2.
    expect(scale).toBeCloseTo(1.3, 9)
    expect(cx).toBeCloseTo(200, 9)
    expect(cy).toBeCloseTo(100, 9)
  })

  it('low-passes the scale, because raw touch distance visibly jitters', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100, 0))
    el.dispatchEvent(pointer('pointerdown', 2, 200, 100, 5))
    // Hold the fingers at a steady 2x and let the filter converge. It is a
    // one-pole filter, so it approaches rather than arrives: 0.7^30 is 2e-5.
    for (let i = 0; i < 30; i++) {
      el.dispatchEvent(pointer('pointermove', 2, 300, 100, 20 + i))
    }
    const scales = h.onPinch.mock.calls.map((c) => c[0] as number)
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThan(scales[i - 1])
    expect(scales[scales.length - 1]).toBeCloseTo(2, 3)
  })

  it('ends a pan cleanly when a second finger lands', () => {
    // Otherwise the consumer is left holding an open drag it never sees the end
    // of, and the next fling inherits its velocity.
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100, 0))
    el.dispatchEvent(pointer('pointermove', 1, 140, 100, 10))
    expect(h.onPan).toHaveBeenCalled()
    el.dispatchEvent(pointer('pointerdown', 2, 240, 100, 20))
    expect(h.onPanEnd).toHaveBeenCalledWith(0, 0)
    expect(h.onPinchStart).toHaveBeenCalledTimes(1)
  })

  it('ends outright when a finger lifts rather than lurching into a pan', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100, 0))
    el.dispatchEvent(pointer('pointerdown', 2, 200, 100, 5))
    el.dispatchEvent(pointer('pointerup', 2, 200, 100, 30))
    expect(h.onPinchEnd).toHaveBeenCalledTimes(1)

    // The finger still down must not resume panning from wherever it now is.
    el.dispatchEvent(pointer('pointermove', 1, 400, 100, 40))
    expect(h.onPan).not.toHaveBeenCalled()
  })
})

describe('mouse', () => {
  it('hovers without a button held', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointermove', 1, 33, 44, 0, { pointerType: 'mouse' }))
    expect(h.onHoverMove).toHaveBeenCalledWith(33, 44)
  })

  it('ignores a non-primary button so right-click still works', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    el.dispatchEvent(pointer('pointerdown', 1, 10, 10, 0, { pointerType: 'mouse', button: 2 }))
    el.dispatchEvent(pointer('pointermove', 1, 90, 10, 10, { pointerType: 'mouse' }))
    expect(h.onPan).not.toHaveBeenCalled()
  })

  it('reports wheel deltas in pixels whatever unit the browser used', () => {
    // Firefox reports lines. Treating 3 lines as 3 pixels makes the wheel inert.
    const h = spies()
    dispose = attachGestures(el, h)
    const px = new WheelEvent('wheel', { deltaY: 100, deltaMode: 0, clientX: 20, cancelable: true })
    el.dispatchEvent(px)
    expect(h.onWheel).toHaveBeenCalledWith(100, 20, false)

    const lines = new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, clientX: 20, cancelable: true })
    el.dispatchEvent(lines)
    expect(h.onWheel).toHaveBeenLastCalledWith(48, 20, false)
  })

  it('prevents the browser zooming on a trackpad pinch', () => {
    const h = spies()
    dispose = attachGestures(el, h)
    const e = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, cancelable: true })
    el.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(h.onWheel).toHaveBeenLastCalledWith(-10, 0, true)
  })
})

describe('scroll suppression', () => {
  /** touchstart/touchmove carry only what the handler reads: touches.length. */
  const touch = (type: string, n: number) => {
    const e = new Event(type, { cancelable: true, bubbles: true })
    Object.defineProperty(e, 'touches', { value: { length: n } })
    return e
  }

  it('leaves a stray single touch alone', () => {
    // The page must still scroll off a graze the chart is not using.
    dispose = attachGestures(el, spies())
    const e = touch('touchstart', 1)
    el.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
  })

  it('swallows the touch once a pan owns the gesture', () => {
    dispose = attachGestures(el, spies())
    el.dispatchEvent(pointer('pointerdown', 1, 0, 0, 0))
    el.dispatchEvent(pointer('pointermove', 1, 60, 0, 10))
    const e = touch('touchmove', 1)
    el.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('swallows any multi-touch outright', () => {
    dispose = attachGestures(el, spies())
    const e = touch('touchstart', 2)
    el.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })
})
