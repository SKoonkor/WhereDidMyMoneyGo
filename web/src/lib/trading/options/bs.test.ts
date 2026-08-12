import { describe, it, expect } from 'vitest'
import { bs, d1d2, impliedVol, normCdf, normPdf, type BsInput } from './bs'

const base = (o: Partial<BsInput> = {}): BsInput => ({
  s: 100, k: 100, tYears: 0.5, r: 0.04, q: 0.01, sigma: 0.35, right: 'call', ...o,
})

/** The grid every "no NaN / parity holds" claim is checked over. Wide on purpose:
 *  the wings and the near-expiry rows are where a pricer stops being finite. */
const SPOTS = [0, 1, 25, 80, 95, 100, 105, 140, 400]
const STRIKES = [1, 50, 90, 100, 110, 250]
const TENORS = [0, 1 / 365, 0.02, 0.25, 1, 3]
const VOLS = [0, 0.01, 0.1, 0.35, 0.9, 2.5]

/**
 * Tolerance for every finite-difference check below.
 *
 * The greeks are exact analytic partials; `price` goes through the A&S normal
 * CDF, whose 7.5e-8 error is smooth but not zero, so a difference quotient of it
 * lands a few 1e-6 away from the true derivative. That gap is the approximation,
 * not a bug — 1e-4 is tight enough to catch any unit error (which would be off by
 * 100x or 365x) and loose enough not to fail on the pricer's own error budget.
 */
const FD_TOL = 1e-4

/** Central difference of the PRICE surface along one input. */
function fd(i: BsInput, key: 'k' | 's' | 'tYears' | 'r' | 'sigma', h: number): number {
  const up = bs({ ...i, [key]: i[key] + h }).price
  const dn = bs({ ...i, [key]: i[key] - h }).price
  return (up - dn) / (2 * h)
}

describe('normCdf', () => {
  it('is exactly one half at the origin', () => {
    // The A&S polynomial is off by ~5e-10 here. An ATM digital that quotes
    // 50.00000005% reads as a bug, so the known value wins.
    expect(normCdf(0)).toBe(0.5)
  })

  it('matches reference values to better than 7.5e-8', () => {
    const refs: [number, number][] = [
      [-3, 0.0013498980316301035],
      [-2.5, 0.006209665325776132],
      [-1.96, 0.024997895148220435],
      [-1, 0.15865525393145705],
      [-0.5, 0.30853753872598694],
      [0.5, 0.6914624612740131],
      [1, 0.8413447460685429],
      [1.96, 0.9750021048517796],
      [2.5, 0.9937903346742238],
      [3, 0.9986501019683699],
      [5, 0.9999997133484281],
    ]
    for (const [x, want] of refs) {
      expect(Math.abs(normCdf(x) - want)).toBeLessThanOrEqual(7.5e-8)
    }
  })

  it('is symmetric to the last bit, which is what keeps parity exact', () => {
    for (const x of [0.13, 0.5, 1, 1.96, 3, 7]) {
      expect(normCdf(x) + normCdf(-x)).toBe(1)
    }
  })

  it('saturates rather than diverging in the far tails', () => {
    expect(normCdf(40)).toBe(1)
    expect(normCdf(-40)).toBe(0)
    expect(normCdf(Infinity)).toBe(1)
    expect(normCdf(-Infinity)).toBe(0)
  })

  it('has a density that integrates to one over the reals', () => {
    // Crude midpoint rule; enough to catch a missing 1/sqrt(2*pi).
    let area = 0
    for (let x = -8; x < 8; x += 0.001) area += normPdf(x + 0.0005) * 0.001
    expect(area).toBeCloseTo(1, 8)
  })
})

describe('d1d2', () => {
  it('separates the two arguments by sigma*sqrt(T)', () => {
    const i = base()
    const { d1, d2 } = d1d2(i)
    expect(d1 - d2).toBeCloseTo(i.sigma * Math.sqrt(i.tYears), 12)
  })

  it('goes to infinity, not NaN, when there is no time or no vol left', () => {
    expect(d1d2(base({ tYears: 0, s: 120 })).d1).toBe(Infinity)
    expect(d1d2(base({ tYears: 0, s: 80 })).d1).toBe(-Infinity)
    expect(d1d2(base({ sigma: 0, s: 120 })).d2).toBe(Infinity)
  })
})

describe('bs pricing', () => {
  it('satisfies put-call parity everywhere', () => {
    // C - P = S*e^(-qT) - K*e^(-rT). This is the one identity that catches a
    // wrong discount factor on either leg, and it must hold to float noise.
    for (const s of SPOTS) {
      for (const k of STRIKES) {
        for (const tYears of TENORS) {
          for (const sigma of VOLS) {
            const i = base({ s, k, tYears, sigma })
            const c = bs({ ...i, right: 'call' }).price
            const p = bs({ ...i, right: 'put' }).price
            const want = s * Math.exp(-i.q * tYears) - k * Math.exp(-i.r * tYears)
            expect(Math.abs(c - p - want)).toBeLessThan(1e-9)
          }
        }
      }
    }
  })

  it('never returns NaN or a negative price anywhere on the grid', () => {
    for (const s of SPOTS) {
      for (const k of STRIKES) {
        for (const tYears of TENORS) {
          for (const sigma of VOLS) {
            for (const right of ['call', 'put'] as const) {
              const g = bs(base({ s, k, tYears, sigma, right }))
              for (const [name, v] of Object.entries(g)) {
                expect(Number.isFinite(v), `${name} @ ${s}/${k}/${tYears}/${sigma}`).toBe(true)
              }
              expect(g.price).toBeGreaterThanOrEqual(0)
            }
          }
        }
      }
    }
  })

  it('collapses to intrinsic at expiry', () => {
    expect(bs(base({ tYears: 0, s: 130, k: 100 })).price).toBeCloseTo(30, 10)
    expect(bs(base({ tYears: 0, s: 70, k: 100 })).price).toBe(0)
    expect(bs(base({ tYears: 0, s: 70, k: 100, right: 'put' })).price).toBeCloseTo(30, 10)
  })

  it('collapses to the DISCOUNTED intrinsic when vol is zero but time is not', () => {
    const i = base({ sigma: 0, s: 130, k: 100, tYears: 2 })
    const forward = i.s * Math.exp((i.r - i.q) * i.tYears)
    expect(bs(i).price).toBeCloseTo(Math.exp(-i.r * i.tYears) * (forward - i.k), 10)
  })

  it('prices a deep OTM call at zero and a deep ITM call at its intrinsic', () => {
    expect(bs(base({ s: 100, k: 100_000, tYears: 1e-6 })).price).toBe(0)
    const deep = bs(base({ s: 100_000, k: 100, tYears: 1e-6 }))
    // Relative, because the A&S error is proportional to the spot it multiplies.
    expect(Math.abs(deep.price - (100_000 - 100)) / 100_000).toBeLessThan(1e-7)
  })

  it('treats a zero or negative spot as a worthless call and a full-value put', () => {
    const i = base({ s: 0, k: 100, tYears: 1 })
    expect(bs(i).price).toBe(0)
    expect(bs({ ...i, right: 'put' }).price).toBeCloseTo(100 * Math.exp(-i.r), 6)
    expect(bs({ ...i, s: -50 }).price).toBe(0)
  })

  it('reproduces a pinned textbook value', () => {
    // S=100 K=100 T=1 r=5% q=0 sigma=20% -> 10.450584 (Hull, the standard check).
    // Within the A&S budget: 7.5e-8 of CDF error times a 100 spot is ~1e-5.
    const g = bs({ s: 100, k: 100, tYears: 1, r: 0.05, q: 0, sigma: 0.2, right: 'call' })
    expect(Math.abs(g.price - 10.450583572185565)).toBeLessThan(2e-5)
  })
})

describe('greeks are in trader units', () => {
  // Every assertion below is a finite difference of `price`. That is the only
  // check that catches the scaling bugs — a vega 100x too big and a theta 365x
  // too big both price perfectly and still make the risk screen nonsense.
  const cases: BsInput[] = [
    base(),
    base({ right: 'put' }),
    base({ s: 85, tYears: 0.1, sigma: 0.6 }),
    base({ s: 130, k: 110, tYears: 2, sigma: 0.2, right: 'put' }),
    base({ s: 100, k: 140, tYears: 0.05, sigma: 0.9 }),
  ]

  it('delta is dPrice/dSpot', () => {
    for (const i of cases) {
      expect(Math.abs(bs(i).delta - fd(i, 's', i.s * 1e-4))).toBeLessThan(FD_TOL)
    }
  })

  it('gamma is the second derivative in spot', () => {
    for (const i of cases) {
      const h = i.s * 1e-3
      const second =
        (bs({ ...i, s: i.s + h }).price - 2 * bs(i).price + bs({ ...i, s: i.s - h }).price) / (h * h)
      expect(Math.abs(bs(i).gamma - second)).toBeLessThan(FD_TOL)
    }
  })

  it('vega is per ONE VOL POINT, not per unit sigma', () => {
    for (const i of cases) {
      const raw = fd(i, 'sigma', 1e-5)
      expect(Math.abs(bs(i).vega - raw / 100)).toBeLessThan(FD_TOL)
      // The 100x error prices perfectly and still makes the risk screen useless,
      // so it gets its own assertion rather than relying on the one above.
      expect(Math.abs(bs(i).vega - raw)).toBeGreaterThan(1e-3)
    }
  })

  it('theta is per CALENDAR DAY and is the negative of the time derivative', () => {
    for (const i of cases) {
      // T is time REMAINING, so a day passing is -dP/dT / 365.
      const perYear = -fd(i, 'tYears', 1e-5)
      expect(Math.abs(bs(i).theta - perYear / 365)).toBeLessThan(FD_TOL)
      expect(Math.abs(bs(i).theta - perYear)).toBeGreaterThan(1e-3)
    }
  })

  it('rho is per ONE RATE POINT', () => {
    for (const i of cases) {
      const raw = fd(i, 'r', 1e-6)
      expect(Math.abs(bs(i).rho - raw / 100)).toBeLessThan(FD_TOL)
      expect(Math.abs(bs(i).rho - raw)).toBeGreaterThan(1e-3)
    }
  })

  it('bounds delta the way the carry factor requires', () => {
    for (const i of cases) {
      const carry = Math.exp(-i.q * i.tYears)
      const d = bs(i).delta
      if (i.right === 'call') expect(d).toBeGreaterThanOrEqual(0)
      else expect(d).toBeLessThanOrEqual(0)
      expect(Math.abs(d)).toBeLessThanOrEqual(carry + 1e-12)
    }
  })

  it('gives calls and puts the same gamma and vega', () => {
    const c = bs(base())
    const p = bs(base({ right: 'put' }))
    expect(p.gamma).toBeCloseTo(c.gamma, 12)
    expect(p.vega).toBeCloseTo(c.vega, 12)
  })
})

describe('impliedVol', () => {
  it('recovers the vol it was priced with', () => {
    let checked = 0
    for (const s of [80, 95, 100, 110, 130]) {
      for (const k of [90, 100, 115]) {
        for (const tYears of [0.02, 0.25, 1, 2]) {
          for (const sigma of [0.08, 0.2, 0.5, 1.2, 2]) {
            for (const right of ['call', 'put'] as const) {
              const i = base({ s, k, tYears, sigma, right })
              const { sigma: _drop, ...rest } = i
              const price = bs(i).price
              // Skip contracts with no recoverable vol. A deep wing — either
              // worthless or all intrinsic — prices the same at 0.01% vol as at
              // 80%, so its inverse is not a number, it is an interval. The
              // solver's tolerance is on price, so that is the right yardstick.
              const floor = bs({ ...i, sigma: 1e-4 }).price
              if (Math.abs(price - floor) <= 1e-7) continue
              checked++
              const iv = impliedVol(price, rest)
              expect(iv, `${s}/${k}/${tYears}/${sigma}/${right}`).not.toBeNull()
              expect(Math.abs(iv! - sigma), `${s}/${k}/${tYears}/${sigma}/${right}`)
                .toBeLessThan(1e-6)
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(250)
  })

  it('returns the floor, not a fantasy, for a quote of zero', () => {
    // A worthless OTM option is consistent with any low vol; the bracket's lower
    // end is the honest answer and it is at least stable across calls.
    const i = base({ s: 80, k: 115, tYears: 0.02, sigma: 0.08 })
    const { sigma: _drop, ...rest } = i
    expect(bs(i).price).toBeLessThan(1e-9)
    expect(impliedVol(0, rest)).toBe(1e-4)
  })

  it('returns null for a price no volatility can produce', () => {
    const { sigma: _drop, ...rest } = base()
    // Above the spot: even infinite vol caps a call at S*e^(-qT).
    expect(impliedVol(500, rest)).toBeNull()
    // Below the zero-vol floor for a deeply ITM call.
    expect(impliedVol(0.01, { ...rest, s: 300, k: 100 })).toBeNull()
    expect(impliedVol(-1, rest)).toBeNull()
    expect(impliedVol(NaN, rest)).toBeNull()
  })

  it('returns null rather than a guess for an expired or degenerate contract', () => {
    const { sigma: _drop, ...rest } = base()
    expect(impliedVol(5, { ...rest, tYears: 0 })).toBeNull()
    expect(impliedVol(5, { ...rest, s: 0 })).toBeNull()
    expect(impliedVol(5, { ...rest, k: 0 })).toBeNull()
  })

  it('survives a wing where vega has collapsed, via the bisection fallback', () => {
    // Newton alone throws the iterate out of the bracket here; the answer still
    // has to come back inside 1e-6.
    const i = base({ s: 100, k: 260, tYears: 0.03, sigma: 1.8 })
    const { sigma: _drop, ...rest } = i
    const iv = impliedVol(bs(i).price, rest)
    expect(iv).not.toBeNull()
    expect(Math.abs(iv! - i.sigma)).toBeLessThan(1e-6)
  })
})
