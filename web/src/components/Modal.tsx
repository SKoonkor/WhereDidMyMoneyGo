import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '../lib/useScrollLock'
import { viewportFit } from './viewportFit'
import { allowsScroll, type DragScroller } from './touchDrag'

// The scroller the finger is actually on: the nearest ancestor of `target`, up to
// and including `root`, that both overflows and is allowed to scroll. Usually that
// is the sheet itself, but a modal is free to hold a scrolling list of its own.
// `null` means the drag has nothing to move — the dimmed area, or a sheet short
// enough not to scroll.
function scrollerAt(target: EventTarget | null, root: HTMLElement): DragScroller | null {
  let el = target instanceof Element ? target : null
  while (el) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight) {
      const overflow = getComputedStyle(el).overflowY
      if (overflow === 'auto' || overflow === 'scroll') {
        return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
      }
    }
    if (el === root) return null
    el = el.parentElement
  }
  return null
}

// A drag inside a text field is the browser's caret/selection business, never ours.
function inTextField(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, [contenteditable]')
}

// A lightweight bottom-sheet-style modal. Closes on backdrop click or Esc.
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const backdropRef = useRef<HTMLDivElement>(null)
  // Did the press that is about to become a click START on the dimmed area?
  //
  // A click alone is not enough to mean "dismiss". Anything that changes the
  // sheet's height between press and release — above all the number pad closing,
  // which hands ~270px of room back and drops the sheet by that much — moves the
  // control out from under the finger, and the release then lands on the backdrop.
  // The browser fires the click on the nearest common ancestor of the two, which
  // is this backdrop, and the whole form used to vanish on what the user
  // experienced as a tap on the date field. Requiring the press to have begun on
  // the backdrop as well makes dismissal mean what it looks like.
  const pressedBackdrop = useRef(false)

  // Freeze the page behind the sheet. Every modal in the app comes through here,
  // and the lock is reference-counted, so a picker opening inside another sheet
  // holds it rather than fighting over it.
  useScrollLock()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Keep the sheet inside the *visible* viewport: when the on-screen keyboard
  // opens it shrinks visualViewport (not always the layout viewport), so a
  // bottom-anchored fixed sheet can end up hidden behind the keyboard. Pin the
  // backdrop to the visual viewport's height/offset so the sheet rides above it.
  //
  // ONLY for the keyboard, though — viewportFit decides. Following every small
  // visual-viewport shift is what made the sheet drift up and down under a drag
  // even with the page behind it frozen; see the note in viewportFit.ts.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => {
      const el = backdropRef.current
      if (!el) return
      const fit = viewportFit(window.innerHeight, vv.height, vv.offsetTop)
      if (fit.height === null || fit.transform === null) {
        el.style.removeProperty('height')
        el.style.removeProperty('transform')
        return
      }
      el.style.height = fit.height
      el.style.transform = fit.transform
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [])

  // Cancel any drag the sheet itself can't use. With the keyboard open there is
  // room for the browser to pan the visual viewport, and that pan carries every
  // fixed element — this whole overlay — along with it; see touchDrag.ts.
  useEffect(() => {
    const el = backdropRef.current
    if (!el) return
    let startX = 0
    let startY = 0
    const onStart = (e: TouchEvent) => {
      startX = e.touches[0]?.clientX ?? 0
      startY = e.touches[0]?.clientY ?? 0
    }
    const onMove = (e: TouchEvent) => {
      // Leave pinch-zoom alone: two fingers are never a scroll.
      if (e.touches.length !== 1 || !e.cancelable) return
      if (inTextField(e.target)) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!allowsScroll(scrollerAt(e.target, el), dx, dy)) e.preventDefault()
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    // Non-passive: preventDefault is the entire point.
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
    }
  }, [])

  // Portal to <body>: the inline `transform` set above makes this backdrop a new
  // containing block for `position: fixed` descendants (CSS spec). A picker like
  // ChipPicker/CategoryPicker opens its own Modal *inside* the Add/Edit transaction
  // form's Modal — without the portal, that nested modal would be fixed relative to
  // this transformed ancestor instead of the real viewport, so it wouldn't track the
  // keyboard and could end up hidden behind it. Rendering every modal as a sibling of
  // its parent at the document root keeps each one independently viewport-fixed.
  return createPortal(
    <div
      className="modal-backdrop"
      ref={backdropRef}
      onPointerDown={(e) => { pressedBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => { if (e.target === e.currentTarget && pressedBackdrop.current) onClose() }}
    >
      <div className="modal-sheet" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
