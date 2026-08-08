import { describe, it, expect } from 'vitest'
import { parseAmountExpr, exprText } from './amountExpr'

describe('parseAmountExpr', () => {
  it('reads a plain amount as a single term', () => {
    const e = parseAmountExpr('250')
    expect(e).toMatchObject({ net: 250, positive: 250, negative: 0, multi: false, valid: true })
    // `multi: false` is what keeps the confirmation dialog out of the common case.
    expect(e.terms).toEqual([250])
  })

  it('splits the worked example into net and set-aside', () => {
    const e = parseAmountExpr('500 - 75 + 25 - 12 - 5 + 33')
    expect(e.terms).toEqual([500, '-', 75, '+', 25, '-', 12, '-', 5, '+', 33])
    expect(e.positive).toBe(558)
    expect(e.negative).toBe(92)
    expect(e.net).toBe(466)
    expect(e.multi).toBe(true)
  })

  it('handles decimals without floating-point dust', () => {
    expect(parseAmountExpr('0.1 + 0.2').net).toBe(0.3)
    expect(parseAmountExpr('19.99 - 0.99').net).toBe(19)
    expect(parseAmountExpr('.5 + .25').net).toBe(0.75)
    // A dot with nothing after it yet — mid-typing "12.5".
    expect(parseAmountExpr('12.')).toMatchObject({ net: 12, valid: true })
  })

  it('accepts a leading sign', () => {
    expect(parseAmountExpr('+500').net).toBe(500)
    // A single negative is well-formed but unsaveable; the form's `> 0` rule rejects it.
    expect(parseAmountExpr('-500')).toMatchObject({ net: -500, negative: 500, valid: true })
  })

  it('strips thousands separators but not a decimal comma', () => {
    expect(parseAmountExpr('1,250 - 50').net).toBe(1200)
    expect(parseAmountExpr('1,234,567').net).toBe(1234567)
    // "1,5" is 1.5 to some keyboards and 15 to this parser — refuse rather than guess.
    expect(parseAmountExpr('1,5').valid).toBe(false)
  })

  it('accepts the dashes and plus signs phone keyboards produce', () => {
    expect(parseAmountExpr('500 − 75').net).toBe(425) // U+2212 minus
    expect(parseAmountExpr('500 – 75').net).toBe(425) // en dash
    expect(parseAmountExpr('500 ＋ 75').net).toBe(575) // full-width plus
  })

  it('ignores a dangling operator so the preview survives typing', () => {
    expect(parseAmountExpr('500 -')).toMatchObject({ net: 500, multi: false, valid: true })
    expect(parseAmountExpr('500 - 75 +')).toMatchObject({ net: 425, valid: true })
  })

  it('rejects anything it cannot read', () => {
    // "500x" and "500 * 2" used to live here; × and ÷ arrived in 0.8.0, so the
    // first is now a trailing operator mid-typing and the second is 1000.
    for (const bad of ['', '   ', '-', '+', 'abc', '500y', '500 75', '500 -- 75', '× 5', '.', '5..5']) {
      expect(parseAmountExpr(bad)).toMatchObject({ net: 0, valid: false, multi: false })
    }
  })

  it('reports a net that can be zero or negative, and lets the form judge it', () => {
    expect(parseAmountExpr('100 - 200')).toMatchObject({ net: -100, positive: 100, negative: 200, valid: true })
    expect(parseAmountExpr('100 - 100')).toMatchObject({ net: 0, valid: true })
  })

  it('keeps the breakdown self-consistent to the satang', () => {
    const e = parseAmountExpr('10.005 + 10.005 - 0.001')
    expect(e.net).toBe(round(e.positive - e.negative))
  })
})

describe('parseAmountExpr — × and ÷ (0.8.0)', () => {
  it('multiplies before it adds', () => {
    expect(parseAmountExpr('500 - 3 × 45').net).toBe(365)
    expect(parseAmountExpr('3 × 45 + 20').net).toBe(155)
    // Not 22,275: the whole point of the two-pass evaluator.
    expect(parseAmountExpr('500 - 3 × 45').net).not.toBe(22275)
  })

  it('chains × and ÷ left to right', () => {
    expect(parseAmountExpr('2 × 3 × 4').net).toBe(24)
    expect(parseAmountExpr('100 ÷ 4 ÷ 5').net).toBe(5)
    expect(parseAmountExpr('100 ÷ 4 × 3').net).toBe(75)
  })

  it('splits a bill the way people actually type it', () => {
    expect(parseAmountExpr('1200 ÷ 4').net).toBe(300)
    expect(parseAmountExpr('89.50 × 3').net).toBe(268.5)
  })

  it('reads ×, x, X and * as the same operator', () => {
    for (const s of ['3 × 45', '3 x 45', '3X45', '3 * 45']) {
      expect(parseAmountExpr(s)).toMatchObject({ net: 135, hasMulDiv: true, valid: true })
    }
    expect(parseAmountExpr('100 / 4').net).toBe(parseAmountExpr('100 ÷ 4').net)
  })

  it('refuses to divide by zero rather than saving Infinity', () => {
    expect(parseAmountExpr('100 ÷ 0').valid).toBe(false)
    expect(parseAmountExpr('100 ÷ 0.0').valid).toBe(false)
    expect(parseAmountExpr('100 ÷ 0 + 5')).toMatchObject({ net: 0, valid: false })
  })

  it('stands the carry note down once a product is involved', () => {
    // Nothing was "set aside" in 3 × 45 — there is no honest answer, so no note.
    const e = parseAmountExpr('3 × 45')
    expect(e).toMatchObject({ net: 135, negative: 0, hasMulDiv: true, multi: true })
    // Even where a minus is present, the split is meaningless once × is too.
    expect(parseAmountExpr('500 - 3 × 45')).toMatchObject({ net: 365, negative: 0, hasMulDiv: true })
    // …and a pure +/- sum is untouched: 0.7.0 behaviour stands.
    expect(parseAmountExpr('500 - 75 + 25')).toMatchObject({ net: 450, negative: 75, hasMulDiv: false })
  })

  it('keeps a trailing × alive while it is being typed', () => {
    expect(parseAmountExpr('3 ×')).toMatchObject({ net: 3, valid: true })
    expect(parseAmountExpr('500 - 3 ×')).toMatchObject({ net: 497, valid: true })
  })

  it('rejects an operator with nothing on its left', () => {
    for (const bad of ['× 5', '÷ 5', '* 5', '/ 5']) {
      expect(parseAmountExpr(bad).valid).toBe(false)
    }
  })
})

describe('exprText', () => {
  it('plays a sum back with typographic operators', () => {
    expect(exprText(parseAmountExpr('500 - 75 + 25').terms)).toBe('500 − 75 + 25')
  })

  it('renders × and ÷ rather than the ASCII the parser accepts', () => {
    expect(exprText(parseAmountExpr('500 - 3 * 45').terms)).toBe('500 − 3 × 45')
    // Grouped for reading, as every other amount in the app is.
    expect(exprText(parseAmountExpr('1200 / 4').terms)).toBe('1,200 ÷ 4')
  })

  it('keeps a leading minus on the first term', () => {
    expect(exprText(parseAmountExpr('-500 + 25').terms)).toBe('−500 + 25')
  })

  it('shows terms as typed, not padded to two decimals', () => {
    expect(exprText(parseAmountExpr('500 - 12.5').terms)).toBe('500 − 12.5')
  })

  it('is empty for an unparseable expression', () => {
    expect(exprText(parseAmountExpr('abc').terms)).toBe('')
  })
})

const round = (n: number) => Math.round(n * 100) / 100
