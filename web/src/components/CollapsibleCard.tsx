import { useRef } from 'react'

// A dashboard box on the Home screen.
//
// Gestures (swapped in 0.4 — collapsing is the frequent action, so it gets the
// lighter gesture):
//   double-tap  → fold / unfold
//   tap         → unfold, when already folded
//   hold 500 ms → `onHold`, which opens the widget's action sheet
// The gesture cancels once the finger moves more than MOVE_CANCEL_PX, so page
// scrolling and panning a chart inside the box still work normally.
//
// Presentational and fully controlled: the fold state and the ordering live in
// the persisted Home layout, so this component owns nothing but the pointer
// state machine.
const HOLD_MS = 500
const MOVE_CANCEL_PX = 10
const DOUBLE_TAP_MS = 300

export function CollapsibleCard({
  title, className, children, header = true,
  collapsed, collapsible = true, onToggleCollapse, onHold,
  gesturesOff = false, editChrome,
}: {
  title: string
  className?: string
  children: React.ReactNode
  /** Render the "TITLE" bar. A box without one (the net-worth hero) can't fold. */
  header?: boolean
  collapsed: boolean
  collapsible?: boolean
  onToggleCollapse: () => void
  onHold?: () => void
  /** Edit mode: no gestures at all, so nothing can fire mid-drag. */
  gesturesOff?: boolean
  /** The ⠿ / ✕ strip, rendered above the header in edit mode. */
  editChrome?: React.ReactNode
}) {
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const moved = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const lastTap = useRef(0)

  const clearTimer = () => {
    if (timer.current != null) { clearTimeout(timer.current); timer.current = null }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    held.current = false
    moved.current = false
    origin.current = { x: e.clientX, y: e.clientY }
    timer.current = window.setTimeout(() => {
      timer.current = null
      held.current = true
      // Forget any tap that preceded the hold, or the release would count as the
      // second half of a double-tap and fold the box behind the sheet.
      lastTap.current = 0
      onHold?.()
    }, HOLD_MS)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!origin.current) return
    if (Math.abs(e.clientX - origin.current.x) > MOVE_CANCEL_PX
      || Math.abs(e.clientY - origin.current.y) > MOVE_CANCEL_PX) {
      moved.current = true
      clearTimer() // a scroll / chart-pan is not a hold
    }
  }
  const onPointerUp = () => {
    clearTimer()
    if (held.current || moved.current) return // the hold already acted; a drag is ignored
    if (collapsed) { lastTap.current = 0; onToggleCollapse(); return } // a tap unfolds
    if (!collapsible) return
    const now = Date.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) { lastTap.current = 0; onToggleCollapse() }
    else lastTap.current = now
  }
  const cancel = () => clearTimer()

  // Deliberately no setPointerCapture here (unlike useHold, which captures on a
  // leaf <button>): capturing on a <section> that wraps a Plotly graph retargets
  // the compat mouse-move stream away from Plotly's own drag handlers and breaks
  // chart panning.
  const gestures = gesturesOff ? {} : {
    onPointerDown, onPointerMove, onPointerUp, onPointerLeave: cancel, onPointerCancel: cancel,
  }

  const folded = collapsed && collapsible
  return (
    <section
      className={`card collapsible ${className || ''} ${folded ? 'is-collapsed' : ''}`}
      {...gestures}
    >
      {editChrome}
      {header && (
        <div className="dash-title collapse-head">
          <span>{title}</span>
          {folded && <span className="collapse-caret" aria-hidden="true">›</span>}
        </div>
      )}
      {!folded && children}
    </section>
  )
}
