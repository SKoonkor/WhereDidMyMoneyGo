import { describe, it, expect } from 'vitest'
import { sparklinePath } from './sparkline'

// Pull the "x,y" pairs back out of a path string.
const points = (d: string) =>
  d.replace(/^M/, '').split('L').map((p) => p.split(',').map(Number) as [number, number])

describe('sparklinePath', () => {
  it('needs at least two points', () => {
    expect(sparklinePath([], 100, 40)).toBeNull()
    expect(sparklinePath([5], 100, 40)).toBeNull()
    expect(sparklinePath([5, 6], 100, 40)).not.toBeNull()
  })

  it('rejects a series containing a non-finite value', () => {
    expect(sparklinePath([1, NaN, 3], 100, 40)).toBeNull()
    expect(sparklinePath([1, Infinity], 100, 40)).toBeNull()
  })

  it('maps a rising series to falling y (SVG y grows downward)', () => {
    const p = points(sparklinePath([1, 2, 3, 4], 100, 40)!.line)
    const ys = p.map(([, y]) => y)
    expect(ys).toEqual([...ys].sort((a, b) => b - a))
    expect(ys[0]).toBeGreaterThan(ys[3])
  })

  it('spreads x evenly across the full width', () => {
    const p = points(sparklinePath([1, 2, 3], 100, 40)!.line)
    expect(p.map(([x]) => x)).toEqual([0, 50, 100])
  })

  it('draws a flat series down the middle', () => {
    const p = points(sparklinePath([7, 7, 7], 100, 40)!.line)
    expect(p.map(([, y]) => y)).toEqual([20, 20, 20])
  })

  it('keeps every point inside the box, inset by pad', () => {
    const paths = sparklinePath([10, -5, 300, 42], 100, 40, 2)!
    for (const [x, y] of points(paths.line)) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(100)
      expect(y).toBeGreaterThanOrEqual(2)
      expect(y).toBeLessThanOrEqual(38)
    }
  })

  describe('zeroY', () => {
    it('is null when the series never reaches zero', () => {
      expect(sparklinePath([100, 200, 300], 100, 40)!.zeroY).toBeNull()
    })

    // min <= 0 alone would report a zeroY here, but zero is ABOVE an
    // all-negative range, so the line would land outside the box.
    it('is null when the series is entirely negative', () => {
      expect(sparklinePath([-30, -10], 100, 40)!.zeroY).toBeNull()
    })

    it('sits proportionally where zero falls in the range', () => {
      const { zeroY } = sparklinePath([-50, 50], 100, 40, 2)!
      expect(zeroY).toBe(20) // symmetric → dead centre of [pad, h-pad]
      const low = sparklinePath([-10, 90], 100, 40, 2)!.zeroY!
      expect(low).toBeGreaterThan(20) // zero near the bottom → larger y
      expect(low).toBeLessThanOrEqual(38)
    })

    it('handles a series that just touches zero', () => {
      expect(sparklinePath([0, 100], 100, 40, 2)!.zeroY).toBe(38) // at the floor
      expect(sparklinePath([-100, 0], 100, 40, 2)!.zeroY).toBe(2) // at the ceiling
    })

    it('centres a flat-at-zero series and skips a flat non-zero one', () => {
      expect(sparklinePath([0, 0, 0], 100, 40)!.zeroY).toBe(20)
      expect(sparklinePath([7, 7, 7], 100, 40)!.zeroY).toBeNull()
    })
  })

  it('closes the area path down to the baseline', () => {
    const { line, area } = sparklinePath([1, 5, 3], 100, 40)!
    expect(area.startsWith(line)).toBe(true)
    expect(area.endsWith('L100,40L0,40Z')).toBe(true)
  })
})
