// Black–Scholes–Merton with a continuous dividend/carry yield — the pricer the
// whole options side of the sandbox runs on.
//
// Two decisions here shape everything downstream:
//
//   1. **The greeks are returned in TRADER units, not raw partials.** Vega is per
//      one vol POINT (0.01 of sigma), theta is per calendar DAY, rho is per one
//      rate POINT. The raw partials are per unit sigma / per year / per unit rate,
//      i.e. 100x, 365x and 100x larger. Mixing the two is the single most likely
//      bug in this file, because nothing crashes — the chain just quotes a theta
//      that says a 30-day option loses its entire value overnight, and it takes a
//      long time to notice that the number is "only" 365x wrong. The finite
//      difference tests exist precisely to pin the scaling.
//
//   2. **It never returns NaN.** A pricer that returns NaN on an edge case
//      poisons the whole screen: one NaN in a chain row becomes a NaN portfolio
//      delta, a NaN equity curve and a blank chart. Every degenerate input
//      (expiry reached, zero vol, zero or negative spot/strike) falls through to
//      the mathematically correct limit — the discounted intrinsic — rather than
//      to 0/0.
//
// Zero imports: this is the bottom of the options stack.

import type { Px, Right } from '../types'

export interface BsInput {
  s: Px
  k: Px
  /** Time to expiry in YEARS. <= 0 means expired. */
  tYears: number
  /** Continuously compounded risk-free rate, as a decimal (0.04 = 4%). */
  r: number
  /** Continuous dividend / carry yield, as a decimal. */
  q: number
  /** Annualised volatility, as a decimal (0.65 = 65%). */
  sigma: number
  right: Right
}

export interface Greeks {
  price: Px
  /** dPrice / dSpot. Dimensionless; already includes the e^(-qT) carry factor. */
  delta: number
  /** d(delta) / dSpot. */
  gamma: number
  /** Per 1 vol point (0.01 of sigma) — NOT the raw dPrice/dSigma. */
  vega: number
  /** Per calendar DAY — NOT the raw annual dPrice/dt. Calendar, not trading,
   *  days: an option decays over the weekend too, and quoting a 252-day year
   *  would make a Friday-to-Monday hold look mispriced by 40%. */
  theta: number
  /** Per 1 rate point (0.01) — NOT the raw dPrice/dr. */
  rho: number
}

/** Divisor turning a raw per-unit-sigma or per-unit-rate partial into a per-point
 *  one. Named so the call sites read as unit conversions rather than magic. */
const PER_POINT = 100
/** Calendar days in the year theta is quoted against. */
const DAYS_PER_YEAR = 365

/** Spot and strike are floored here rather than special-cased. At 1e-12 the log
 *  is a large finite negative number, so d1 underflows the normal density to a
 *  clean 0 instead of producing log(0) = -Infinity and then Infinity * 0 = NaN. */
const TINY = 1e-12

const SQRT_2 = Math.SQRT2
const INV_SQRT_2PI = 0.3989422804014327 // 1 / sqrt(2*pi)

// Abramowitz & Stegun 7.1.26 — the rational-times-Gaussian approximation to erf,
// with |eps| <= 1.5e-7. Halved by the change of variable into Phi, giving the
// 7.5e-8 bound the tests pin.
const AS_P = 0.3275911
const AS_A1 = 0.254829592
const AS_A2 = -0.284496736
const AS_A3 = 1.421413741
const AS_A4 = -1.453152027
const AS_A5 = 1.061405429

/** erfc for x >= 0 only. The caller supplies |x| and reflects; see normCdf. */
function erfcPos(x: number): number {
  const t = 1 / (1 + AS_P * x)
  const poly = t * (AS_A1 + t * (AS_A2 + t * (AS_A3 + t * (AS_A4 + t * AS_A5))))
  return poly * Math.exp(-x * x)
}

/**
 * Standard normal CDF, Abramowitz–Stegun 7.1.26. |error| < 7.5e-8.
 *
 * The reflection is deliberate: the tail is evaluated once for |x| and the other
 * side is `1 - tail`, so `normCdf(x) + normCdf(-x)` is 1 to the last bit. If both
 * sides were evaluated independently their approximation errors would not cancel
 * and put-call parity — which is exactly `S*e^(-qT)*(N(d1)+N(-d1)) - ...` — would
 * break by ~1e-5 on a $100 underlying instead of by rounding noise.
 */
export function normCdf(x: number): number {
  // The approximation is off by ~5e-10 at the origin, and a Phi(0) that is not
  // exactly 0.5 makes an ATM digital option quote 50.00000005%, which reads as a
  // bug in a screenshot. The true value is known; use it.
  if (x === 0) return 0.5
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0
  const tail = 0.5 * erfcPos(Math.abs(x) / SQRT_2)
  return x > 0 ? 1 - tail : tail
}

/** Standard normal PDF. */
export function normPdf(x: number): number {
  if (!Number.isFinite(x)) return 0
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x)
}

/**
 * The two BSM arguments.
 *
 * Degenerate inputs return ±Infinity rather than NaN, which is the correct limit:
 * with no time or no vol left the option is a pure forward bet and N(d) collapses
 * to the 0/1 indicator that `normCdf(±Infinity)` already gives.
 */
export function d1d2(i: BsInput): { d1: number; d2: number } {
  const s = Math.max(i.s, TINY)
  const k = Math.max(i.k, TINY)
  const t = Math.max(i.tYears, 0)
  const vol = Math.max(i.sigma, 0)
  const sqrtT = Math.sqrt(t)
  const denom = vol * sqrtT
  const lnFk = Math.log(s / k) + (i.r - i.q) * t
  if (denom <= 0) {
    // The forward is either above or below the strike with certainty.
    const inf = lnFk > 0 ? Infinity : lnFk < 0 ? -Infinity : 0
    return { d1: inf, d2: inf }
  }
  const d1 = (lnFk + 0.5 * vol * vol * t) / denom
  return { d1, d2: d1 - denom }
}

/**
 * Black–Scholes–Merton price and greeks.
 *
 * The degenerate branches are not separate formulas — they are the same formulas
 * evaluated at the limit N(d) -> indicator, n(d) -> 0. Writing them that way is
 * what keeps `bs` continuous as sigma or T approaches zero; a hand-written
 * "intrinsic" branch would introduce a visible jump in the greeks one tick before
 * expiry, which looks exactly like a pricing bug.
 */
export function bs(i: BsInput): Greeks {
  const s = Math.max(i.s, TINY)
  const k = Math.max(i.k, TINY)
  const t = Math.max(i.tYears, 0)
  const vol = Math.max(i.sigma, 0)
  const isCall = i.right === 'call'

  const dfR = Math.exp(-i.r * t) // discount the strike
  const dfQ = Math.exp(-i.q * t) // discount the spot for carry
  const sqrtT = Math.sqrt(t)
  const { d1, d2 } = d1d2({ ...i, s, k, tYears: t, sigma: vol })

  const nd1 = normCdf(d1)
  const nd2 = normCdf(d2)
  const nmd1 = normCdf(-d1)
  const nmd2 = normCdf(-d2)
  // Zero when t or vol is zero, which is what collapses every greek below to the
  // discounted-intrinsic limit without a single `if`.
  const pdf = vol > 0 && t > 0 ? normPdf(d1) : 0

  const sdfQ = s * dfQ
  const kdfR = k * dfR

  const price = isCall ? sdfQ * nd1 - kdfR * nd2 : kdfR * nmd2 - sdfQ * nmd1
  const delta = isCall ? dfQ * nd1 : -dfQ * nmd1
  const gamma = pdf > 0 ? (dfQ * pdf) / (s * vol * sqrtT) : 0
  const vegaRaw = sdfQ * pdf * sqrtT

  // Three terms: the decay of the option's own convexity, the carry on the strike
  // leg, and the carry on the spot leg. The first vanishes with pdf, so at t = 0
  // this is just the drift of the discounted intrinsic — finite, never NaN.
  const decay = sqrtT > 0 ? -(sdfQ * pdf * vol) / (2 * sqrtT) : 0
  const thetaRaw = isCall
    ? decay - i.r * kdfR * nd2 + i.q * sdfQ * nd1
    : decay + i.r * kdfR * nmd2 - i.q * sdfQ * nmd1

  const rhoRaw = isCall ? k * t * dfR * nd2 : -k * t * dfR * nmd2

  return {
    // A price can only be pushed below zero by float noise in the difference of
    // two nearly equal discounted terms; clamping keeps a deep-OTM row at 0
    // rather than -3e-17, which would print as "-0.00".
    price: price > 0 ? price : 0,
    delta,
    gamma,
    vega: vegaRaw / PER_POINT,
    theta: thetaRaw / DAYS_PER_YEAR,
    rho: rhoRaw / PER_POINT,
  }
}

/** Newton is capped here; past this the iteration is cycling, not converging. */
const IV_MAX_ITER = 20
/**
 * Convergence tolerance, measured on SIGMA rather than on price.
 *
 * Measuring it on price looks more natural and is wrong in the wings: vega there
 * is ~1e-3, so a price matched to 1e-7 leaves sigma free to wander by 1e-4. The
 * quoted vol would be off in the second decimal place while the solver reported
 * success. Bracketing on sigma costs a few more halvings and is exact.
 */
const IV_TOL = 1e-7
/** The bisection bracket. Below 1e-4 an option is effectively a forward; above
 *  500% vol nothing the sandbox generates can live. */
const IV_LO = 1e-4
const IV_HI = 5
/** Enough halvings of a 5-wide bracket to land inside 1e-15. */
const BISECT_ITER = 80

/**
 * Implied volatility by Newton, falling back to bisection.
 *
 * Newton alone is not safe here: vega collapses toward zero for deep in- or
 * out-of-the-money options, and a division by a near-zero vega throws the next
 * iterate to 1e9 or to a negative vol from which it never returns. So every step
 * is validated back into the bracket, and anything that leaves it hands over to
 * bisection, which cannot diverge.
 *
 * Returns null — never a guess — when the price is unreachable (below intrinsic,
 * above the spot, or the option has already expired). A caller that gets a
 * number back can trust it round-trips through `bs` to 1e-7.
 */
export function impliedVol(price: Px, i: Omit<BsInput, 'sigma'>): number | null {
  if (!Number.isFinite(price) || price < 0) return null
  if (!(i.tYears > 0) || !(i.s > 0) || !(i.k > 0)) return null

  const priceAt = (sigma: number) => bs({ ...i, sigma }).price
  const fLo = priceAt(IV_LO) - price
  const fHi = priceAt(IV_HI) - price
  // No root in the bracket: the quote is outside what any volatility can produce.
  // fLo > 0 means it is below the (already arbitrage-free) zero-vol value; fHi < 0
  // means it is above what 500% vol can reach. The epsilon scales with the price
  // so a $100k underlying is not rejected over its own rounding.
  const eps = 1e-9 * Math.max(1, price)
  if (fLo > eps || fHi < -eps) return null
  if (fLo >= 0) return IV_LO
  if (fHi <= 0) return IV_HI

  // Brenner–Subrahmanyam: an ATM option's price is ~0.4 * S * sigma * sqrt(T), so
  // this lands within a few percent for the near-the-money rows that dominate a
  // chain — usually 2-3 Newton steps instead of 6.
  const seed = (price / Math.max(i.s, TINY)) * Math.sqrt((2 * Math.PI) / i.tYears)
  let sigma = Number.isFinite(seed) ? Math.min(Math.max(seed, 0.05), 3) : 0.5

  for (let n = 0; n < IV_MAX_ITER; n++) {
    const g = bs({ ...i, sigma })
    const diff = g.price - price
    if (diff === 0) return sigma
    // g.vega is PER VOL POINT; Newton needs the raw dPrice/dSigma, hence the x100.
    // Forgetting it does not diverge — it just takes 100x more steps and silently
    // runs out of iterations, which is why it gets its own sentence.
    const dPdSigma = g.vega * PER_POINT
    if (!(dPdSigma > 1e-12)) break
    const next = sigma - diff / dPdSigma
    if (!Number.isFinite(next) || next <= IV_LO || next >= IV_HI) break
    const step = Math.abs(next - sigma)
    sigma = next
    if (step <= IV_TOL) return sigma
  }

  // Bisection runs to a BRACKET WIDTH, not to a price match — see IV_TOL. The
  // bracket was proved to straddle above, so this cannot fail to converge.
  let lo = IV_LO
  let hi = IV_HI
  for (let n = 0; n < BISECT_ITER && hi - lo > IV_TOL; n++) {
    const mid = 0.5 * (lo + hi)
    const diff = priceAt(mid) - price
    if (diff === 0) return mid
    if (diff > 0) hi = mid
    else lo = mid
  }
  return 0.5 * (lo + hi)
}
