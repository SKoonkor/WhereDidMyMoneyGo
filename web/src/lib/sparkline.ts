// Minimal sparkline geometry. Pure — returns SVG path `d` strings for a filled
// area line, so the Home preview tiles can draw a trend with no charting library
// and no container measuring (the caller renders into a fixed viewBox with
// preserveAspectRatio="none").

export interface SparkPaths {
  /** The line itself. */
  line: string
  /** The same line closed down to the baseline, for the fill. */
  area: string
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
  return { line, area: `${line}L${round(w)},${round(h)}L0,${round(h)}Z` }
}
