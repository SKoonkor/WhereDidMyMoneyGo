import { useEffect } from 'react'

// A brief, auto-dismissing in-app message pinned above the bottom nav. Optional
// `action` renders a trailing button (e.g. "Settings"); tapping it runs the
// handler and closes the toast. Announced politely for screen readers.
export function Toast({
  message,
  action,
  onClose,
  duration = 4000,
}: {
  message: string
  action?: { label: string; onClick: () => void }
  onClose: () => void
  duration?: number
}) {
  useEffect(() => {
    const id = window.setTimeout(onClose, duration)
    return () => window.clearTimeout(id)
  }, [onClose, duration])

  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast-msg">{message}</span>
      {action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => { action.onClick(); onClose() }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
