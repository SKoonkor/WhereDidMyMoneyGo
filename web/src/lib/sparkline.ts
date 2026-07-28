// Minimal sparkline geometry. Pure — returns SVG path `d` strings for a filled
// area line, so the Home preview tiles can draw a trend with no charting library
// and no container measuring (the caller renders into a fixed viewBox with
// preserveAspectRatio="none").

export interface SparkPaths {
  /** The line itself. */
  line: string
  /** The same line closed down to the baseline, for the fill. */
  area: string
  /**
   * Where value 0 falls, in viewBox units — or null when zero is outside the
   * drawn range, so the caller simply doesn't draw a zero line.
   *
   * Note the test is `min <= 0 && max >= 0`, i.e. the series actually reaches or
   * crosses zero. `min <= 0` alone would be wrong: an all-negative series (a
   * balance in the red throughout) satisfies it, yet zero sits ABOVE the range
   * and the line would be drawn outside the box. Because the range is never
   * stretched to reach zero, a series sitting far above it keeps the full height
   * for the trend itself.
   */
  zeroY: number | null
}

const round = (n: number) => Math.round(n * 100) / 100

// `pad` keeps the 2px stroke from being clipped at the top and bottom edges.
export function sparklinePath(
  values: number[], w: number, h: number, pad = 2,
): SparkPaths | null {
  if (values.length < 2) return null

  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) return null
    if (v < min) min = v
    if (v > max) max = v
  }

  const top = pad
  const bottom = h - pad
  // A flat series has no range to normalize against — draw it down the middle.
  const span = max - min
  const y = (v: number) => (span === 0 ? (top + bottom) / 2 : bottom - ((v - min) / span) * (bottom - top))
  const x = (i: number) => (i / (values.length - 1)) * w

  const pts = values.map((v, i) => `${round(x(i))},${round(y(v))}`)
  const line = `M${pts.join('L')}`
  const zeroY = min <= 0 && max >= 0 ? round(y(0)) : null
  return { line, area: `${line}L${round(w)},${round(h)}L0,${round(h)}Z`, zeroY }
}
