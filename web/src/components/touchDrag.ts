// Whether a touch drag inside an overlay should be left to the browser.
//
// A drag that nothing on the page consumes falls through to the browser, which
// pans the *visual* viewport. Normally there is nowhere to pan to, so nothing
// happens — but while the on-screen keyboard is open on iOS the layout viewport
// stays full height and only the visual one shrinks, which leaves several hundred
// pixels of slack. Dragging then slides the visual viewport inside the layout
// viewport, and every `position: fixed` element — the whole modal — travels with
// it. That is the sheet moving under the finger with the keyboard up.
//
// Neither `overscroll-behavior` nor useScrollLock's pinned body stops this: there
// is no scroll to chain and no document movement involved. Cancelling the gesture
// does, so Modal calls this to decide whether to preventDefault.
//
// `touch-action: none` in CSS would be the tidier version of the same idea, but
// it can only go on the backdrop, and touch-action on an ancestor also forbids
// panning its descendants — it would take the sheet's own scrolling with it.

/** The metrics of the scroller under the finger; `null` when there isn't one. */
export interface DragScroller {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

// Scroll positions are fractional on zoomed/hidpi screens, so "at the end" needs
// a little slack rather than an exact comparison.
const EPS = 1

/**
 * @param dx Pixels the finger has moved sideways since touchstart.
 * @param dy Pixels it has moved vertically; positive = downward, which scrolls a
 *           list back toward its top.
 * @returns true to let the browser scroll, false to cancel the gesture.
 */
export function allowsScroll(scroller: DragScroller | null, dx: number, dy: number): boolean {
  // A sideways gesture — a chip row, a slider — can't pan the viewport vertically,
  // so it is never ours to cancel whether or not we found a vertical scroller.
  if (Math.abs(dx) > Math.abs(dy)) return true
  // The dimmed area beside the sheet, or a sheet short enough to need no scrolling
  // at all: there is nothing here for the drag to move.
  if (!scroller) return false
  const max = scroller.scrollHeight - scroller.clientHeight
  if (max <= EPS) return false
  // At either end the browser would hand the leftover movement onward, which is
  // exactly the pan we are trying to avoid.
  if (dy > 0) return scroller.scrollTop > EPS
  if (dy < 0) return scroller.scrollTop < max - EPS
  return true
}
