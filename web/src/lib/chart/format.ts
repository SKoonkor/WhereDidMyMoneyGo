// The one place canvas text turns a number into a string.
//
// Two reasons it is centralised rather than done per layer:
//
// 1. Privacy mode. `:root[data-censor='on'] .money` masks DOM text; a canvas is
//    an opaque bitmap to CSS, so every number the chart draws has to mask
//    itself. One formatter means one place that can be got wrong.
// 2. Width stability. A censored label that is narrower than the real one makes
//    the price axis reflow when privacy is toggled — so the mask is padded to
//    the same character count instead.

const MASK_CHAR = '•' // •

/** Grouped integer part, plain decimal part. Intl would be correct but allocates
 *  a formatter and is ~8x slower per call, and this runs per axis label. */
function group(intPart: string): string {
  let out = ''
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) out += ','
    out += intPart[i]
  }
  return out
}

function mask(width: number): string {
  return MASK_CHAR.repeat(Math.max(3, Math.min(width, 12)))
}

/**
 * A price for an axis label or a readout.
 *
 * `precision` comes from the instrument, never from the value — so every label
 * on an axis carries the same number of decimals and the column of numbers has
 * a straight decimal point. Deriving it per value is the classic mistake that
 * produces a ragged axis.
 */
export function formatPriceForCanvas(v: number, precision: number, censor: boolean): string {
  if (!Number.isFinite(v)) return censor ? mask(4) : '—'
  const neg = v < 0
  const fixed = Math.abs(v).toFixed(precision)
  const dot = fixed.indexOf('.')
  const ip = dot === -1 ? fixed : fixed.slice(0, dot)
  const fp = dot === -1 ? '' : fixed.slice(dot)
  const s = (neg ? '-' : '') + group(ip) + fp
  return censor ? mask(s.length) : s
}

/** Same, with an explicit + on gains — a P&L that only ever shows a minus reads
 *  as though nothing is ever up. */
export function formatSignedForCanvas(v: number, precision: number, censor: boolean): string {
  if (!Number.isFinite(v)) return censor ? mask(4) : '—'
  const body = formatPriceForCanvas(Math.abs(v), precision, false)
  const s = (v > 0 ? '+' : v < 0 ? '-' : '') + body
  return censor ? mask(s.length) : s
}

const VOL_UNITS: [number, number, string][] = [
  [1e9, 1e9, 'B'],
  [1e6, 1e6, 'M'],
  [1e3, 1e3, 'K'],
]

/** Volume in an axis-sized amount of space: 1.24M, 812K, 43. */
export function formatCompactVolume(v: number, censor: boolean): string {
  if (!Number.isFinite(v) || v === 0) return censor ? mask(3) : '0'
  const abs = Math.abs(v)
  let s: string
  let done = false
  s = ''
  for (const [threshold, divisor, suffix] of VOL_UNITS) {
    if (abs >= threshold) {
      const scaled = abs / divisor
      const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
      s = scaled.toFixed(decimals).replace(/\.?0+$/, '') + suffix
      done = true
      break
    }
  }
  if (!done) s = String(Math.round(abs))
  if (v < 0) s = '-' + s
  return censor ? mask(s.length) : s
}

/** A percentage for the OHLC legend and the change readouts. */
export function formatPctForCanvas(v: number, censor: boolean): string {
  if (!Number.isFinite(v)) return censor ? mask(5) : '—'
  const s = `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  return censor ? mask(s.length) : s
}

/**
 * mm:ss remaining, for the bar-close countdown under the last-price pill.
 * Never censored: it is a clock, not money.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  if (total >= 3600) {
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    return `${h}:${String(m).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }
  const m = Math.floor(total / 60)
  return `${m}:${String(total % 60).padStart(2, '0')}`
}

/** Decimal places implied by a tick size: 0.01 -> 2, 0.5 -> 1, 1 -> 0. */
export function precisionFromTick(tickSize: number): number {
  if (!(tickSize > 0)) return 2
  const s = tickSize.toExponential()
  const exp = Number(s.slice(s.indexOf('e') + 1))
  if (exp >= 0) return 0
  // Mantissa digits push the precision further right: 2.5e-3 needs 4, not 3.
  const mant = s.slice(0, s.indexOf('e')).replace('-', '')
  const extra = mant.includes('.') ? mant.length - mant.indexOf('.') - 1 : 0
  return Math.min(10, -exp + extra)
}
