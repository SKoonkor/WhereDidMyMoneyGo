import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

// Distinguish a long-press ("hold") from a tap on the same element. `onHold`
// fires once the finger has been down for `ms`; a release before then is treated
// as a tap (`onTap`). `pressing` reflects the in-progress hold for visual feedback.
//
// Spread the returned pointer handlers and `onClick` onto a <button>; pair with
// `touch-action:none` + `user-select:none` in CSS so the gesture doesn't scroll
// the page or select text.
export function useHold(onHold: () => void, onTap?: () => void, ms = 500) {
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const [pressing, setPressing] = useState(false)

  const clear = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  const end = () => { clear(); setPressing(false) }

  return {
    pressing,
    onPointerDown: (e: ReactPointerEvent) => {
      held.current = false
      setPressing(true)
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      timer.current = window.setTimeout(() => {
        held.current = true
        setPressing(false)
        onHold()
      }, ms)
    },
    onPointerUp: end,
    onPointerLeave: end,
    onPointerCancel: () => { held.current = false; end() },
    // Fires after pointerup; swallow it when the press was actually a hold.
    onClick: () => {
      if (held.current) { held.current = false; return }
      onTap?.()
    },
  }
}
