import { describe, it, expect } from 'vitest'
import { allowsScroll, type DragScroller } from './touchDrag'

// A sheet 600px of content in a 400px box: 200px of room to scroll.
const sheet = (scrollTop: number): DragScroller => ({
  scrollTop,
  scrollHeight: 600,
  clientHeight: 400,
})

describe('allowsScroll', () => {
  it('cancels a drag with no scroller under it (the dimmed backdrop)', () => {
    expect(allowsScroll(null, 0, -40)).toBe(false)
    expect(allowsScroll(null, 0, 40)).toBe(false)
  })

  it('cancels a drag on a sheet that has nothing to scroll', () => {
    const short = { scrollTop: 0, scrollHeight: 400, clientHeight: 400 }
    expect(allowsScroll(short, 0, -40)).toBe(false)
    expect(allowsScroll(short, 0, 40)).toBe(false)
  })

  it('leaves a scroll in the middle of the sheet alone', () => {
    expect(allowsScroll(sheet(100), 0, -40)).toBe(true)
    expect(allowsScroll(sheet(100), 0, 40)).toBe(true)
  })

  it('cancels a pull-down at the top but allows a push-up', () => {
    expect(allowsScroll(sheet(0), 0, 40)).toBe(false)
    expect(allowsScroll(sheet(0), 0, -40)).toBe(true)
  })

  it('cancels a push-up at the bottom but allows a pull-down', () => {
    expect(allowsScroll(sheet(200), 0, -40)).toBe(false)
    expect(allowsScroll(sheet(200), 0, 40)).toBe(true)
  })

  it('treats a sub-pixel distance from an end as being at that end', () => {
    expect(allowsScroll(sheet(0.4), 0, 40)).toBe(false)
    expect(allowsScroll(sheet(199.6), 0, -40)).toBe(false)
  })

  it('allows a gesture that has not moved yet', () => {
    expect(allowsScroll(sheet(100), 0, 0)).toBe(true)
  })

  it('leaves a sideways swipe alone, even over the dimmed area', () => {
    expect(allowsScroll(null, -80, 10)).toBe(true)
    expect(allowsScroll(sheet(0), 80, 40)).toBe(true)
  })
})
