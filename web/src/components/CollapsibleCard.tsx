import { useCallback, useRef, useState } from 'react'

// Home-dashboard boxes can be folded away with a long-press and reopened with a
// tap. The collapsed set is persisted in localStorage (keyed by box id) so the
// layout the user arranges survives reloads.
const STORE_KEY = 'home-collapsed'

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

export function useCollapsed(id: string): [boolean, (next: boolean) => void] {
  const [collapsed, set] = useState(() => readCollapsed().has(id))
  const update = useCallback((next: boolean) => {
    const s = readCollapsed()
    if (next) s.add(id)
    else s.delete(id)
    localStorage.setItem(STORE_KEY, JSON.stringify([...s]))
    set(next)
  }, [id])
  return [collapsed, update]
}

// A dashboard box that folds to just its header on a long-press. When collapsed a
// "›" appears top-right and a tap reopens it. The gesture cancels on movement, so
// scrolling the page (and panning a chart inside) still works normally — only a
// stationary press folds the box. `onNavigate` (Step 3) fires on a double-tap.
const HOLD_MS = 500
const MOVE_CANCEL_PX = 10

export function CollapsibleCard({
  id, title, className, children, onNavigate,
}: {
  id: string
  title: string
  className?: string
  children: React.ReactNode
  onNavigate?: () => void
}) {
  const [collapsed, setCollapsed] = useCollapsed(id)
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
      setCollapsed(!collapsed) // a stationary hold folds/unfolds
    }, HOLD_MS)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!origin.current) return
    if (Math.abs(e.clientX - origin.current.x) > MOVE_CANCEL_PX || Math.abs(e.clientY - origin.current.y) > MOVE_CANCEL_PX) {
      moved.current = true
      clearTimer() // a scroll / chart-pan is not a hold
    }
  }
  const onPointerUp = () => {
    clearTimer()
    if (held.current || moved.current) return // the hold already acted; a drag is ignored
    // A clean tap: expand when collapsed; otherwise count it toward a double-tap.
    if (collapsed) { setCollapsed(false); return }
    const now = Date.now()
    if (onNavigate && now - lastTap.current < 300) { lastTap.current = 0; onNavigate() }
    else lastTap.current = now
  }
  const cancel = () => clearTimer()

  return (
    <section
      className={`card collapsible ${className || ''} ${collapsed ? 'is-collapsed' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      <div className="dash-title collapse-head">
        <span>{title}</span>
        {collapsed && <span className="collapse-caret" aria-hidden="true">›</span>}
      </div>
      {!collapsed && children}
    </section>
  )
}
