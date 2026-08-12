// Number formatting for the DOM half of the trading screen.
//
// The canvas half has its own formatter (lib/chart/format.ts) and the two are
// deliberately NOT shared: the canvas one has to mask itself for privacy mode and
// pad the mask to a stable width, because CSS cannot reach into a bitmap. Here the
// app's existing `.money` rule does the masking, so these functions only ever
// produce the honest string and every amount they feed goes into an element with
// className="money".
//
// Everything is `Intl`-free on the hot paths that matter and precision always
// comes from the instrument, never from the value — a column of prices with
// different decimal counts is the fastest way to look unfinished.

import { precisionFromTick } from '../../lib/chart/format'

export { precisionFromTick }

/** Money, in the account's currency. Two decimals below a thousand, none above —
 *  an equity of `1,204,338.27` is noise, a P&L of `12.40` is not. */
export function money(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  // Zero takes the ordinary two decimals. The sub-unit branch exists for real
  // fractional amounts on a cheap instrument; letting nothing-happened-yet fall
  // into it renders a flat P&L as "0.0000", which reads like a rate rather than
  // an amount of money and is the first thing on screen at a fresh account.
  const decimals = abs >= 1000 ? 0 : abs >= 1 || abs === 0 ? 2 : 4
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/**
 * A signed money DELTA — a P&L, a day change, a cash movement.
 *
 * Two things it does that `money` deliberately does not.
 *
 * Always two decimals. `money` widens to four below 1.00 because a fee of 0.0004
 * is a real number worth seeing, but on a delta that produces `0.0000`, which
 * reads as a rate rather than as an amount — and a day change of zero is the most
 * common value this function is ever handed.
 *
 * Always a sign, chosen AFTER rounding. The sign is what makes a gain and a loss
 * distinguishable at a glance, so zero shows `+0.00` rather than a bare number.
 * Taking it from the rounded value is what stops `-0.004` printing as `-0.00`:
 * a minus in front of a zero is a signed-zero bug the moment anyone notices it,
 * and `Math.round` of a small negative yields `-0`, for which `< 0` is false.
 */
export function signedMoney(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const rounded = Math.round(v * 100) / 100
  const body = Math.abs(rounded).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
  return (rounded < 0 ? '-' : '+') + body
}

/** A price at the instrument's own precision. */
export function price(v: number, precision: number): string {
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })
}

/** A quantity. Trailing zeros are dropped — `0.030000` reads as a rounding
 *  artefact, `0.03` reads as a size. */
export function qty(v: number, precision = 6): string {
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString(undefined, { maximumFractionDigits: precision })
}

/** A signed percentage. The sign comes from the ROUNDED value for the same reason
 *  it does in `signedMoney`: `-0.001%` must not print as `-0.00%`, which is a
 *  signed zero and reads as a rendering fault. */
export function pct(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '—'
  const scale = 10 ** decimals
  const rounded = Math.round(v * scale) / scale
  return `${rounded < 0 ? '-' : '+'}${Math.abs(rounded).toFixed(decimals)}%`
}

/** Leverage: `3×`, `2.5×`. */
export function lev(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}×`
}

/**
 * A duration in sim time, for the catch-up banner: "3h 12m", "45s".
 *
 * Only ever two units. "3h 12m 06s" is a stopwatch; the user is being told how
 * much of the market they slept through, and the seconds are noise.
 */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * The date/time formatters the chart's axes and the blotter need.
 *
 * `calendar: 'gregory'` is pinned because the rest of the app shows Gregorian
 * dates in Thai too, and the Buddhist-era default would make this one screen
 * disagree with every other one. Built once per language rather than per call:
 * an `Intl.DateTimeFormat` costs about as much to construct as a hundred formats.
 */
const cache = new Map<string, Intl.DateTimeFormat>()

function fmtFor(lang: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = lang + JSON.stringify(opts)
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB', { calendar: 'gregory', ...opts })
    cache.set(key, f)
  }
  return f
}

export function clockTime(t: number, lang: string): string {
  return fmtFor(lang, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t))
}

export function dayLabel(t: number, lang: string): string {
  return fmtFor(lang, { month: 'short', day: 'numeric' }).format(new Date(t))
}

export function stamp(t: number, lang: string): string {
  return fmtFor(lang, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(t))
}
