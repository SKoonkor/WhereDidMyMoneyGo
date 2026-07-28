import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { lockScroll, unlockScroll } from './useScrollLock'

// jsdom never actually scrolls, so drive window.scrollY by hand and watch the
// restore call instead.
let scrollTo: ReturnType<typeof vi.fn>

const setScrollY = (y: number) => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
}

beforeEach(() => {
  document.body.removeAttribute('style')
  setScrollY(0)
  scrollTo = vi.fn()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
})

afterEach(() => {
  // Leave the counter balanced for the next test even if one failed mid-way.
  for (let i = 0; i < 5; i++) unlockScroll()
})

describe('lockScroll / unlockScroll', () => {
  it('pins the body at the current scroll position', () => {
    setScrollY(640)
    lockScroll()
    const s = document.body.style
    expect(s.position).toBe('fixed')
    expect(s.top).toBe('-640px')
    expect(s.width).toBe('100%')
    expect(s.overflow).toBe('hidden')
  })

  it('restores the exact position and clears every property it set', () => {
    setScrollY(640)
    lockScroll()
    unlockScroll()
    const s = document.body.style
    expect(s.position).toBe('')
    expect(s.top).toBe('')
    expect(s.left).toBe('')
    expect(s.right).toBe('')
    expect(s.width).toBe('')
    expect(s.overflow).toBe('')
    expect(scrollTo).toHaveBeenCalledWith(0, 640)
  })

  it('stays locked while a nested overlay opens and closes', () => {
    // A picker Modal opening inside the Add-transaction Modal: closing only the
    // picker must NOT release the page.
    setScrollY(300)
    lockScroll() // form
    lockScroll() // picker
    unlockScroll() // picker closes
    expect(document.body.style.position).toBe('fixed')
    expect(scrollTo).not.toHaveBeenCalled()

    unlockScroll() // form closes
    expect(document.body.style.position).toBe('')
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(0, 300)
  })

  it('keeps the OUTERMOST position, ignoring where the page sat when the inner one opened', () => {
    setScrollY(300)
    lockScroll()
    setScrollY(0) // the pin itself reports the document at the top
    lockScroll()
    unlockScroll()
    unlockScroll()
    expect(scrollTo).toHaveBeenCalledWith(0, 300)
  })

  it('ignores an unbalanced unlock rather than going negative', () => {
    unlockScroll() // nothing is locked
    expect(scrollTo).not.toHaveBeenCalled()

    // The counter must still be at zero, so the next lock actually locks.
    setScrollY(120)
    lockScroll()
    expect(document.body.style.position).toBe('fixed')
    unlockScroll()
    expect(document.body.style.position).toBe('')
    expect(scrollTo).toHaveBeenCalledWith(0, 120)
  })

  it('survives StrictMode’s mount → cleanup → mount in development', () => {
    setScrollY(500)
    lockScroll()
    unlockScroll() // React 18 dev double-invoke
    lockScroll()
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-500px')
    unlockScroll()
    expect(document.body.style.position).toBe('')
  })
})
