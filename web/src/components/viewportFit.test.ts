import { describe, it, expect } from 'vitest'
import { viewportFit, KEYBOARD_MIN_PX } from './viewportFit'

describe('viewportFit', () => {
  it('leaves the CSS alone when nothing is covering the viewport', () => {
    expect(viewportFit(877, 877, 0)).toEqual({ height: null, transform: null })
  })

  it('ignores a rubber-band drag on a pinned page', () => {
    // The bug: the page behind is frozen, but a drag still shifts the visual
    // viewport — and we were translating the sheet by exactly that offset.
    expect(viewportFit(877, 877, -60)).toEqual({ height: null, transform: null })
    expect(viewportFit(877, 860, 40)).toEqual({ height: null, transform: null })
  })

  it('ignores a collapsing browser URL bar', () => {
    // Just under the threshold: real, but not the keyboard.
    expect(viewportFit(877, 877 - (KEYBOARD_MIN_PX - 1), 0)).toEqual({ height: null, transform: null })
  })

  it('fits the sheet above the on-screen keyboard', () => {
    expect(viewportFit(877, 500, 0)).toEqual({ height: '500px', transform: 'translateY(0px)' })
  })

  it('follows the offset while the keyboard is open', () => {
    expect(viewportFit(877, 500, 120)).toEqual({ height: '500px', transform: 'translateY(120px)' })
  })

  it('rounds, so sub-pixel viewport reports do not churn the style', () => {
    expect(viewportFit(877, 500.4, 12.6)).toEqual({ height: '500px', transform: 'translateY(13px)' })
  })

  it('does nothing when the layout viewport shrinks with the keyboard (Android)', () => {
    expect(viewportFit(500, 500, 0)).toEqual({ height: null, transform: null })
  })
})
