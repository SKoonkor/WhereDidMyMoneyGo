import { describe, it, expect } from 'vitest'
import { duration, money, pct, signedMoney } from './fmt'

// Only the two formatters with a rule that is easy to regress and impossible to
// see in a diff: the sign has to be taken from the ROUNDED value, or a tiny
// negative prints as a signed zero. Everything else in fmt.ts is a thin wrapper
// over toLocaleString and is checked by looking at the screen.

describe('signedMoney', () => {
  it('is always two decimals, because a delta is not a rate', () => {
    // The bug this replaced: `money`'s sub-1.00 branch widens to four decimals,
    // so a day change of zero rendered as "0.0000" in the equity header.
    expect(signedMoney(0)).toBe('+0.00')
    expect(signedMoney(0.5)).toBe('+0.50')
    expect(signedMoney(1234.5)).toBe('+1,234.50')
  })

  it('always carries a sign, so a gain and a loss differ at a glance', () => {
    expect(signedMoney(12)).toBe('+12.00')
    expect(signedMoney(-12)).toBe('-12.00')
  })

  it('never prints a signed zero', () => {
    // -0.004 rounds to -0, and `-0 < 0` is false — which is exactly what makes
    // this work rather than something to guard around.
    expect(signedMoney(-0.004)).toBe('+0.00')
    expect(signedMoney(-0)).toBe('+0.00')
  })

  it('is an em dash for a non-number rather than NaN', () => {
    expect(signedMoney(Number.NaN)).toBe('—')
    expect(signedMoney(Infinity)).toBe('—')
  })
})

describe('pct', () => {
  it('signs the rounded value', () => {
    expect(pct(0)).toBe('+0.00%')
    expect(pct(-0.001)).toBe('+0.00%')
    expect(pct(-1.234)).toBe('-1.23%')
    expect(pct(2.5)).toBe('+2.50%')
  })
})

describe('money', () => {
  it('drops the decimals on large amounts and keeps them on small ones', () => {
    // Unchanged by the delta fix: a fee of 0.0004 is still worth seeing in full.
    expect(money(100_000)).toBe('100,000')
    expect(money(12.5)).toBe('12.50')
    expect(money(0.0004)).toBe('0.0004')
  })
})

describe('duration', () => {
  it('never shows more than two units', () => {
    expect(duration(3 * 3_600_000 + 12 * 60_000 + 6_000)).toBe('3h 12m')
    expect(duration(45_000)).toBe('45s')
    expect(duration(0)).toBe('0s')
  })
})
