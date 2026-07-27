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

  it('closes the area path down to the baseline', () => {
    const { line, area } = sparklinePath([1, 5, 3], 100, 40)!
    expect(area.startsWith(line)).toBe(true)
    expect(area.endsWith('L100,40L0,40Z')).toBe(true)
  })
})
