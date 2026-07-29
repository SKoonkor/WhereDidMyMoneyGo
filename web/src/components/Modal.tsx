import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '../lib/useScrollLock'
import { viewportFit } from './viewportFit'

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

  // Portal to <body>: the inline `transform` set above makes this backdrop a new
  // containing block for `position: fixed` descendants (CSS spec). A picker like
  // ChipPicker/CategoryPicker opens its own Modal *inside* the Add/Edit transaction
  // form's Modal — without the portal, that nested modal would be fixed relative to
  // this transformed ancestor instead of the real viewport, so it wouldn't track the
  // keyboard and could end up hidden behind it. Rendering every modal as a sibling of
  // its parent at the document root keeps each one independently viewport-fixed.
  return createPortal(
    <div className="modal-backdrop" ref={backdropRef} onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
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
