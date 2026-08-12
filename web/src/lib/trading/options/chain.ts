// The option chain: strikes, a volatility surface, quotes, and the symbol format
// everything else keys off.
//
// The whole file is a PURE FUNCTION OF (spot, now, expiry, params). There is no
// RNG anywhere in it — not even for the cosmetic open-interest and volume
// columns, which are a hash of (strike, expiry). That is not fastidiousness: the
// chain is rebuilt on every quote update, so an RNG here would make the OI column
// flicker several times a second, and it would also consume draws from the shared
// market stream and desynchronise the price series from its own replay. A hash
// gives numbers that look plausible, never move, and cost nothing.
//
// Calendar arithmetic is done with integer day counts rather than `new Date()`,
// so nothing in this file can read the wall clock even by accident.

import { OPTION_MULT, type OptionInstrument, type Px, type Right, type SimTime } from '../types'
import { hashSeed } from '../rng'
import { bs, type Greeks } from './bs'

const MS_PER_DAY = 86_400_000
const DAYS_PER_YEAR = 365
/** Expiries settle at 08:00 UTC — the convention Deribit uses, and the reason the
 *  symbol only needs to carry a date. */
export const EXPIRY_HOUR_UTC = 8
/** Epoch day 0 (1970-01-01) was a Thursday, so this is the offset that turns a
 *  day count into a 0=Sunday weekday. */
const EPOCH_DOW = 4
const FRIDAY = 5

// ── Volatility surface ───────────────────────────────────────────────────────

export interface VolSurface {
  /** At-the-money vol at T = 0, as a decimal. */
  atmVol: number
  /** Term structure: vol added per sqrt(year). Positive = upward-sloping. */
  termSlope: number
  /** Skew, in vol per unit of standardised moneyness. NEGATIVE is the normal
   *  equity/crypto shape — downside puts bid over upside calls. */
  skew: number
  /** Smile curvature: how much both wings lift relative to the ATM. */
  smile: number
}

/** Vol is clamped into this band. A surface parameterisation left unbounded can
 *  produce a negative sigma in the far wings, and a negative sigma makes `bs`
 *  return the zero-vol intrinsic — an option that suddenly quotes its intrinsic
 *  at the edge of the chain looks like a rendering glitch, not a model artefact. */
const VOL_MIN = 0.02
const VOL_MAX = 4

/**
 * sigma(K, T) from a four-parameter surface.
 *
 * Moneyness is standardised by the ATM vol and sqrt(T) so the smile has the same
 * shape in standard deviations at every tenor — a fixed log-strike smile would
 * make a 1-day chain look flat and a 1-year chain look insanely skewed.
 */
export function surfaceVol(
  sf: VolSurface, spot: Px, strike: Px, tYears: number, r: number,
): number {
  const base = sf.atmVol + sf.termSlope * Math.sqrt(Math.max(tYears, 0))
  if (!(tYears > 0) || !(sf.atmVol > 0) || !(spot > 0) || !(strike > 0)) {
    return clampVol(base)
  }
  const forward = spot * Math.exp(r * tYears)
  const m = Math.log(strike / forward) / (sf.atmVol * Math.sqrt(tYears))
  return clampVol(base * (1 + sf.skew * m + sf.smile * m * m))
}

function clampVol(v: number): number {
  if (!Number.isFinite(v)) return VOL_MIN
  return Math.min(Math.max(v, VOL_MIN), VOL_MAX)
}

// ── Symbols ──────────────────────────────────────────────────────────────────

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n))

/**
 * Days since the epoch -> civil date, Howard Hinnant's algorithm.
 *
 * Written out rather than delegated to `Date` because every module under
 * lib/trading is forbidden from touching the wall clock, and the safest way to
 * keep that true is to have no Date object in the file at all.
 */
function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468
  const era = Math.floor(zz / 146097)
  const doe = zz - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d }
}

/** Civil date -> days since the epoch. The exact inverse of civilFromDays. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0)
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** `"BTC|2026-08-14|call|65000"`. Pipe-delimited because it is unambiguous with
 *  fractional strikes, unlike the OCC/Deribit fixed-width formats which would
 *  need a scaling convention the sandbox has no reason to invent. */
export function optionSymbol(u: string, expiry: SimTime, r: Right, k: Px): string {
  const { y, m, d } = civilFromDays(Math.floor(expiry / MS_PER_DAY))
  // String(k) is the shortest decimal that round-trips through parseFloat for
  // every finite double, so fractional strikes survive the round trip exactly.
  return `${u}|${y}-${pad2(m)}-${pad2(d)}|${r}|${String(k)}`
}

/** Tick and precision for a parsed instrument. The symbol carries no venue
 *  metadata, so these are the chain's defaults; the live chain overrides them. */
const DEFAULT_TICK = 0.01
const DEFAULT_PRICE_PRECISION = 2

/**
 * The inverse of `optionSymbol`, or null if the string is not one.
 *
 * The symbol encodes a DATE, not an instant, so the expiry comes back at the
 * canonical 08:00 UTC. Every expiry the sandbox creates is on that grid
 * (`standardExpiries`), so the round trip is exact for real symbols.
 */
export function parseOptionSymbol(sym: string): OptionInstrument | null {
  const parts = sym.split('|')
  if (parts.length !== 4) return null
  const [underlying, date, right, strikeStr] = parts
  if (!underlying) return null
  if (right !== 'call' && right !== 'put') return null
  const dm = /^(-?\d{4,6})-(\d{2})-(\d{2})$/.exec(date)
  if (!dm) return null
  const y = Number(dm[1])
  const m = Number(dm[2])
  const d = Number(dm[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const days = daysFromCivil(y, m, d)
  // Reject 2026-02-31 and friends: the algorithm happily normalises them, which
  // would make two different symbols parse to the same instrument.
  const back = civilFromDays(days)
  if (back.y !== y || back.m !== m || back.d !== d) return null
  const strike = Number(strikeStr)
  if (!strikeStr || !Number.isFinite(strike) || strike <= 0) return null
  return {
    kind: 'option',
    symbol: sym,
    underlying,
    expiry: days * MS_PER_DAY + EXPIRY_HOUR_UTC * 3_600_000,
    right,
    strike,
    multiplier: OPTION_MULT,
    tickSize: DEFAULT_TICK,
    pricePrecision: DEFAULT_PRICE_PRECISION,
  }
}

// ── Expiry calendar ──────────────────────────────────────────────────────────

/** The instant of a given civil date at the canonical settlement hour. */
function expiryAt(y: number, m: number, d: number): SimTime {
  return daysFromCivil(y, m, d) * MS_PER_DAY + EXPIRY_HOUR_UTC * 3_600_000
}

/** Day count of the last Friday of a month, in epoch days. */
function lastFridayOfMonth(y: number, m: number): number {
  // First of the next month, minus a day, walked back to Friday.
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  const last = daysFromCivil(nextY, nextM, 1) - 1
  const dow = (((last + EPOCH_DOW) % 7) + 7) % 7
  const backUp = (((dow - FRIDAY) % 7) + 7) % 7
  return last - backUp
}

/**
 * The expiry ladder: the next `weeklies` Fridays at 08:00Z, plus the next
 * `monthlies` last-Fridays-of-month, deduplicated and sorted ascending.
 *
 * The last Friday of a month IS one of the weekly Fridays, so the dedupe is not
 * cosmetic — without it the chain selector would show the same expiry twice and
 * a user switching between the duplicates would see nothing change.
 */
export function standardExpiries(now: SimTime, weeklies: number, monthlies: number): SimTime[] {
  const out = new Set<SimTime>()
  const today = Math.floor(now / MS_PER_DAY)

  const dow = (((today + EPOCH_DOW) % 7) + 7) % 7
  let day = today + (((FRIDAY - dow) % 7) + 7) % 7
  for (let n = 0; n < Math.max(weeklies, 0); ) {
    const { y, m, d } = civilFromDays(day)
    const t = expiryAt(y, m, d)
    // Strictly after `now`: a Friday whose 08:00Z has already passed is not
    // tradeable, and offering it would let a user buy an already-expired option.
    if (t > now) {
      out.add(t)
      n++
    }
    day += 7
  }

  const start = civilFromDays(today)
  for (let n = 0, off = 0; n < Math.max(monthlies, 0) && off < 120; off++) {
    const total = (start.y * 12 + (start.m - 1)) + off
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    const { y: fy, m: fm, d: fd } = civilFromDays(lastFridayOfMonth(y, m))
    const t = expiryAt(fy, fm, fd)
    if (t > now) {
      out.add(t)
      n++
    }
  }

  return [...out].sort((a, b) => a - b)
}

// ── Strike ladder ────────────────────────────────────────────────────────────

/** Snap a raw step to the 1 / 2 / 2.5 / 5 x 10^n ladder every real venue uses.
 *  A chain of 63,417.50-wide strikes is instantly recognisable as synthetic. */
function roundStep(raw: number): number {
  if (!(raw > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return mult * mag
}

/** Decimal places worth keeping for a given step. Without this, `3 * 0.05` lands
 *  on 0.15000000000000002 and the strike prints — and, worse, keys a symbol —
 *  with sixteen digits of float noise. */
function decimalsFor(step: number): number {
  const d = Math.ceil(-Math.log10(step))
  return Math.min(Math.max(d, 0), 10)
}

const roundTo = (x: number, decimals: number) => Number(x.toFixed(decimals))

// ── Chain ────────────────────────────────────────────────────────────────────

export interface ChainParams {
  underlying: string
  /** `strikeSteps` strikes each side of ATM, so 2n+1 rows. */
  strikeSteps: number
  /** Raw ladder spacing as a fraction of spot, before snapping. */
  strikeStepPct: number
  r: number
  q: number
  surface: VolSurface
  /** HALF-spread around the model mark, in basis points of the mark. */
  spreadBps: number
  multiplier: number
}

export interface ChainQuote {
  inst: OptionInstrument
  iv: number
  g: Greeks
  bid: Px
  ask: Px
  mark: Px
  /** Cosmetic. A deterministic hash of (strike, expiry) — never an RNG draw. */
  oi: number
  volume: number
  /** In the money against the CURRENT spot. Additive to the frozen design: every
   *  chain UI shades ITM rows, and recomputing it per cell invites the two sides
   *  to disagree at the ATM row. */
  itm: boolean
}

export interface ChainRow {
  strike: Px
  call: ChainQuote
  put: ChainQuote
}

export interface OptionChain {
  underlying: string
  spot: Px
  expiry: SimTime
  now: SimTime
  rows: ChainRow[]
}

/** A quote is never worth less than one tick. Real venues have a minimum price
 *  increment and so does this: a mark of 0 makes `bid < mark < ask` unsatisfiable
 *  and makes a deep wing row un-closeable. */
const MIN_MARK = DEFAULT_TICK

/** Cosmetic open interest and volume from a hash of the contract's identity.
 *  Scaled by an ATM bell so the middle of the chain is the liquid part, which is
 *  what makes the column read as a real market rather than as noise. */
function cosmeticDepth(strike: Px, expiry: SimTime, atmness: number): { oi: number; volume: number } {
  const h = hashSeed(`oi|${strike}|${expiry}`)
  const h2 = hashSeed(`vol|${strike}|${expiry}`)
  const bell = Math.exp(-0.5 * atmness * atmness)
  const oi = Math.round((200 + (h % 9800)) * (0.15 + 0.85 * bell))
  const volume = Math.round(oi * (0.05 + ((h2 % 1000) / 1000) * 0.45))
  return { oi, volume }
}

function quote(
  p: ChainParams, spot: Px, strike: Px, right: Right, tYears: number,
  expiry: SimTime, atmness: number,
): ChainQuote {
  const iv = surfaceVol(p.surface, spot, strike, tYears, p.r)
  const g = bs({ s: spot, k: strike, tYears, r: p.r, q: p.q, sigma: iv, right })
  const mark = Math.max(g.price, MIN_MARK)
  // The half-spread has a floor of half a tick so `bid < mark < ask` holds even
  // where the mark is at the minimum and a bps spread would round to nothing.
  const half = Math.max((mark * p.spreadBps) / 10_000, DEFAULT_TICK / 2)
  const { oi, volume } = cosmeticDepth(strike, expiry, atmness)
  return {
    inst: {
      kind: 'option',
      symbol: optionSymbol(p.underlying, expiry, right, strike),
      underlying: p.underlying,
      expiry,
      right,
      strike,
      multiplier: p.multiplier,
      tickSize: DEFAULT_TICK,
      pricePrecision: DEFAULT_PRICE_PRECISION,
    },
    iv,
    g,
    bid: Math.max(0, mark - half),
    ask: mark + half,
    mark,
    oi,
    volume,
    itm: right === 'call' ? spot > strike : spot < strike,
  }
}

/**
 * Build the whole chain for one expiry.
 *
 * Deterministic in the strongest sense: the same four arguments produce a deeply
 * equal object every time, forever. That is what lets the UI diff chains cheaply
 * and lets a replayed session show the identical screen.
 */
export function buildChain(p: ChainParams, spot: Px, now: SimTime, expiry: SimTime): OptionChain {
  const tYears = Math.max(expiry - now, 0) / MS_PER_DAY / DAYS_PER_YEAR
  const safeSpot = Math.max(spot, MIN_MARK)
  // A zero or negative step would collapse every row onto one strike; floor it at
  // a millionth of spot so the ladder stays strictly increasing whatever is passed.
  const step = roundStep(Math.max(safeSpot * p.strikeStepPct, safeSpot * 1e-6))
  const decimals = decimalsFor(step)
  // Snap the CENTRE to the ladder, then walk out symmetrically. Centring on the
  // raw spot instead would make every strike a fraction of a step off the round
  // numbers a trader expects to see.
  const centre = Math.round(safeSpot / step)
  const steps = Math.max(Math.floor(p.strikeSteps), 0)
  // Standardised distance used only to shape the cosmetic depth curve.
  const width = Math.max(steps, 1)

  const rows: ChainRow[] = []
  for (let i = -steps; i <= steps; i++) {
    const strike = roundTo((centre + i) * step, decimals)
    if (strike <= 0) continue
    const atmness = (2 * i) / width
    rows.push({
      strike,
      call: quote(p, safeSpot, strike, 'call', tYears, expiry, atmness),
      put: quote(p, safeSpot, strike, 'put', tYears, expiry, atmness),
    })
  }

  return { underlying: p.underlying, spot, expiry, now, rows }
}

/**
 * Initial margin for a SHORT option — the CBOE 20% rule.
 *
 *   max(0.20 * S - out-of-the-money amount, 0.10 * K) * multiplier + premium
 *
 * The 10% floor is what stops a far-OTM short from being free: 20% of spot minus
 * the OTM amount goes to zero (and then negative) in the wings, and a sandbox
 * that let a user sell a thousand of them on no margin would blow up the account
 * on the first gap, which reads as an engine bug rather than as leverage.
 *
 * `premium` is the premium in CASH terms — already multiplied by the contract
 * multiplier — because that is the amount actually credited on the sale.
 */
export function shortOptionMargin(s: Px, k: Px, right: Right, premium: Px, mult: number): number {
  const otm = right === 'call' ? Math.max(0, k - s) : Math.max(0, s - k)
  const base = Math.max(0.2 * s - otm, 0.1 * k)
  return Math.max(0, base * mult + premium)
}
