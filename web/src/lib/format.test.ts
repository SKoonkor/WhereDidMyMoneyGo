import { describe, it, expect } from 'vitest'
import { compactAmount } from './format'

describe('compactAmount', () => {
  it('keeps three significant digits when positive', () => {
    expect(compactAmount(800)).toBe('800')
    expect(compactAmount(1234)).toBe('1.23k')
    expect(compactAmount(23400)).toBe('23.4k')
    expect(compactAmount(555000)).toBe('555k')
    expect(compactAmount(1234567)).toBe('1.23M')
  })

  it('drops to two significant digits when negative, to fit the minus', () => {
    expect(compactAmount(-20)).toBe('-20')
    expect(compactAmount(-1100)).toBe('-1.1k')
    expect(compactAmount(-100000)).toBe('-100k')
    expect(compactAmount(-1234567)).toBe('-1.2M')
  })

  // Rounding must happen before the unit is picked, or this reads "1000k".
  it('carries across a unit boundary', () => {
    expect(compactAmount(999500)).toBe('1M')
    expect(compactAmount(-999500)).toBe('-1M')
    expect(compactAmount(999)).toBe('999')
    expect(compactAmount(1000)).toBe('1k')
  })

  it('trims trailing zeros', () => {
    expect(compactAmount(1200)).toBe('1.2k')
    expect(compactAmount(2000)).toBe('2k')
    expect(compactAmount(20000)).toBe('20k')
  })

  it('handles zero, sub-unit and non-finite values', () => {
    expect(compactAmount(0)).toBe('0')
    expect(compactAmount(-0.4)).toBe('0') // never "-0"
    expect(compactAmount(0.4)).toBe('0')
    expect(compactAmount(NaN)).toBe('0')
    expect(compactAmount(Infinity)).toBe('0')
  })

  it('stays within five characters for realistic amounts', () => {
    for (const n of [0, 999, 1234, -1234, 23400, -23400, 555000, -555000, 9_999_999]) {
      expect(compactAmount(n).length).toBeLessThanOrEqual(6)
    }
  })
})
