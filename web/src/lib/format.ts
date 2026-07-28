// Display formatting shared by the small Home tiles, where a full amount never
// fits: at ~108px wide a slot has room for about five characters.

const UNITS: [threshold: number, divisor: number, suffix: string][] = [
  [1e9, 1e9, 'B'],
  [1e6, 1e6, 'M'],
  [1e3, 1e3, 'k'],
]

// Round to `sig` significant digits.
function toSig(n: number, sig: number): number {
  if (n === 0) return 0
  const mag = Math.floor(Math.log10(n))
  const f = 10 ** (sig - 1 - mag)
  return Math.round(n * f) / f
}

// Trim a fixed-decimal string back to its shortest exact form: 1.20 → 1.2, 1.00 → 1.
const trim = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s)

/**
 * Compact money for a tile: three significant digits, or two when negative so
 * the minus sign doesn't cost a digit of precision.
 *
 *   800 → "800"      1234 → "1.23k"    23400 → "23.4k"
 *   555000 → "555k"  1234567 → "1.23M"
 *   -20 → "-20"      -1100 → "-1.1k"   -100000 → "-100k"
 *
 * Rounding happens BEFORE the unit is chosen, so 999,500 carries to "1M"
 * instead of rendering as the nonsense "1000k".
 */
export function compactAmount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const neg = n < 0
  const rounded = toSig(Math.abs(n), neg ? 2 : 3)
  const sign = neg && rounded !== 0 ? '-' : ''

  for (const [threshold, divisor, suffix] of UNITS) {
    if (rounded >= threshold) {
      const scaled = rounded / divisor
      // Keep the significant-digit count across the unit boundary: 1.23k needs
      // two decimals, 23.4k one, 555k none.
      const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
      return `${sign}${trim(scaled.toFixed(decimals))}${suffix}`
    }
  }
  const whole = Math.round(rounded)
  return whole === 0 ? '0' : `${sign}${whole}` // never render "-0"
}
