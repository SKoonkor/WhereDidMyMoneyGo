import { describe, it, expect } from 'vitest'
import { parseAmountExpr } from './amountExpr'

describe('parseAmountExpr', () => {
  it('reads a plain amount as a single term', () => {
    const e = parseAmountExpr('250')
    expect(e).toMatchObject({ net: 250, positive: 250, negative: 0, multi: false, valid: true })
    // `multi: false` is what keeps the confirmation dialog out of the common case.
    expect(e.terms).toEqual([250])
  })

  it('splits the worked example into net and set-aside', () => {
    const e = parseAmountExpr('500 - 75 + 25 - 12 - 5 + 33')
    expect(e.terms).toEqual([500, -75, 25, -12, -5, 33])
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
    for (const bad of ['', '   ', '-', '+', 'abc', '500x', '500 75', '500 -- 75', '500 * 2', '.', '5..5']) {
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

const round = (n: number) => Math.round(n * 100) / 100
