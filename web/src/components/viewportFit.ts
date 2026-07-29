// How a bottom-anchored overlay should size itself to the *visible* viewport.
//
// The only thing that justifies overriding the layout viewport is the on-screen
// keyboard: it shrinks `visualViewport` without always shrinking the layout
// viewport, so a sheet anchored to the bottom ends up hidden behind it.
//
// Everything else that moves the visual viewport must be ignored. A collapsing
// URL bar, or a rubber-band drag on a page that useScrollLock has pinned, shifts
// it by a few pixels — and following THAT is what used to make the sheet slide
// up and down under the finger while the page behind it stayed still.
//
// `null` means "leave the CSS alone", which is the common case.

/** Pixels the visible viewport must lose before we treat it as the keyboard. */
export const KEYBOARD_MIN_PX = 120

export interface ViewportFit {
  height: string | null
  transform: string | null
}

const IGNORE: ViewportFit = { height: null, transform: null }

export function viewportFit(
  layoutHeight: number,
  visualHeight: number,
  offsetTop: number,
): ViewportFit {
  // Android Chrome resizes the layout viewport for the keyboard instead, so the
  // difference stays ~0 there and this correctly does nothing at all.
  if (layoutHeight - visualHeight < KEYBOARD_MIN_PX) return IGNORE
  return {
    height: `${Math.round(visualHeight)}px`,
    transform: `translateY(${Math.round(offsetTop)}px)`,
  }
}
