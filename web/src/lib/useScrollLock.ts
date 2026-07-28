import { useEffect } from 'react'

// Freeze the page behind an overlay, and put it back exactly where it was.
//
// `body { overflow: hidden }` on its own is not enough: iOS Safari ignores it and
// happily scrolls the document under a fixed overlay — which is the one place this
// matters most, since the app is meant to be installed on a phone. Pinning the
// body with `position: fixed` at a negative offset is the technique that actually
// holds there; the offset is what keeps the page from jumping to the top, and it
// has to be undone with an explicit scrollTo on the way out.
//
// The depth counter is module-level ON PURPOSE. Pickers open a Modal *inside* the
// Add-transaction Modal (see the portal note in components/Modal.tsx), so two
// overlays are mounted at once; a per-instance flag would unlock the page when the
// inner picker closed, with the form still open, and would restore the scroll
// position twice. Only the outermost lock captures and restores it.
let depth = 0
let savedY = 0

// The properties we set, so unlock can clear exactly those and nothing else.
const PROPS = ['position', 'top', 'left', 'right', 'width', 'overflow', 'overscroll-behavior'] as const

export function lockScroll(): void {
  if (depth++ > 0) return
  savedY = window.scrollY
  const s = document.body.style
  s.position = 'fixed'
  s.top = `-${savedY}px`
  s.left = '0'
  s.right = '0'
  s.width = '100%'
  s.overflow = 'hidden'
  // A pinned document can still rubber-band on macOS and iOS, and Modal re-applies
  // its backdrop transform from visualViewport on every scroll event — so that
  // bounce would drag the sheet along with it. Set only while locked, so ordinary
  // pull-to-refresh keeps working the rest of the time.
  s.overscrollBehavior = 'none'
}

export function unlockScroll(): void {
  if (depth === 0) return // unbalanced call — never drive the counter negative
  if (--depth > 0) return
  const s = document.body.style
  for (const p of PROPS) s.removeProperty(p)
  window.scrollTo(0, savedY)
}

// Hold the lock for as long as the calling component is mounted.
export function useScrollLock(): void {
  useEffect(() => {
    lockScroll()
    return unlockScroll
  }, [])
}
