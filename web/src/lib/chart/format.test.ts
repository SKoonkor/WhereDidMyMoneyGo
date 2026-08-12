import { describe, it, expect } from 'vitest'
import {
  formatCompactVolume, formatCountdown, formatPctForCanvas, formatPriceForCanvas,
  formatSignedForCanvas, precisionFromTick,
} from './format'

describe('formatPriceForCanvas', () => {
  it('groups thousands and keeps the instrument precision', () => {
    expect(formatPriceForCanvas(43210.5, 2, false)).toBe('43,210.50')
    expect(formatPriceForCanvas(7, 2, false)).toBe('7.00')
    expect(formatPriceForCanvas(1234567.891, 3, false)).toBe('1,234,567.891')
    expect(formatPriceForCanvas(999, 0, false)).toBe('999')
  })

  it('uses the same decimal count for every value on an axis', () => {
    // Deriving decimals per value is the classic mistake: it produces a ragged
    // axis where the decimal points do not line up.
    const labels = [100, 100.5, 101, 102.25].map((v) => formatPriceForCanvas(v, 2, false))
    const decimals = labels.map((s) => s.length - s.indexOf('.') - 1)
    expect(new Set(decimals).size).toBe(1)
  })

  it('keeps the minus sign outside the grouping', () => {
    expect(formatPriceForCanvas(-1234.5, 2, false)).toBe('-1,234.50')
  })

  it('masks under privacy mode without changing the width', () => {
    // If the mask were narrower, the price axis would reflow every time privacy
    // was toggled — nobody does this, and it is free.
    const real = formatPriceForCanvas(43210.5, 2, false)
    const hidden = formatPriceForCanvas(43210.5, 2, true)
    expect(hidden).not.toContain('4')
    expect(hidden.length).toBe(real.length)
  })

  it('does not print NaN or Infinity at the user', () => {
    expect(formatPriceForCanvas(NaN, 2, false)).toBe('—')
    expect(formatPriceForCanvas(Infinity, 2, false)).toBe('—')
    expect(formatPriceForCanvas(NaN, 2, true)).not.toContain('N')
  })
})

describe('formatSignedForCanvas', () => {
  it('shows a plus on gains', () => {
    // A P&L that only ever shows a minus reads as though nothing is ever up.
    expect(formatSignedForCanvas(1234.5, 2, false)).toBe('+1,234.50')
    expect(formatSignedForCanvas(-1234.5, 2, false)).toBe('-1,234.50')
    expect(formatSignedForCanvas(0, 2, false)).toBe('0.00')
  })

  it('masks at the same width', () => {
    const real = formatSignedForCanvas(-1234.5, 2, false)
    expect(formatSignedForCanvas(-1234.5, 2, true).length).toBe(real.length)
  })
})

describe('formatCompactVolume', () => {
  it('fits volume into axis-sized space', () => {
    expect(formatCompactVolume(0, false)).toBe('0')
    expect(formatCompactVolume(43, false)).toBe('43')
    expect(formatCompactVolume(812_000, false)).toBe('812K')
    expect(formatCompactVolume(1_240_000, false)).toBe('1.24M')
    expect(formatCompactVolume(3_400_000_000, false)).toBe('3.4B')
  })

  it('keeps the sign', () => {
    expect(formatCompactVolume(-812_000, false)).toBe('-812K')
  })

  it('masks', () => {
    expect(formatCompactVolume(1_240_000, true)).not.toContain('1')
  })
})

describe('formatPctForCanvas', () => {
  it('always carries a sign and two decimals', () => {
    expect(formatPctForCanvas(0.21, false)).toBe('+0.21%')
    expect(formatPctForCanvas(-3.4, false)).toBe('-3.40%')
    expect(formatPctForCanvas(0, false)).toBe('0.00%')
  })
})

describe('formatCountdown', () => {
  it('counts a bar down in mm:ss', () => {
    expect(formatCountdown(59_000)).toBe('0:59')
    expect(formatCountdown(61_000)).toBe('1:01')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-500)).toBe('0:00')
  })

  it('grows an hours field for the long timeframes', () => {
    expect(formatCountdown(3_723_000)).toBe('1:02:03')
  })
})

describe('precisionFromTick', () => {
  it('derives decimals from the tick size', () => {
    expect(precisionFromTick(1)).toBe(0)
    expect(precisionFromTick(0.5)).toBe(1)
    expect(precisionFromTick(0.01)).toBe(2)
    expect(precisionFromTick(0.0001)).toBe(4)
    // 2.5e-3 needs four places, not three — the mantissa pushes it right.
    expect(precisionFromTick(0.0025)).toBe(4)
    expect(precisionFromTick(0)).toBe(2)
  })
})
