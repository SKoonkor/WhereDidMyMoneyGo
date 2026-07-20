import { useEffect, useRef } from 'react'

// Reusable Plotly wrapper. Plotly (~1 MB) is dynamically imported so it stays
// out of the initial bundle — the page's numbers paint immediately and the
// chart streams in once the library loads. Shared by every Phase 2 dashboard.
type Trace = Record<string, unknown>
type Layout = Record<string, unknown>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plotly = any

export function Plot({
  data, layout, style, ariaLabel,
}: {
  data: Trace[]
  layout?: Layout
  style?: React.CSSProperties
  ariaLabel?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const plotly = useRef<Plotly>(null)

  useEffect(() => {
    let cancelled = false
    import('plotly.js-dist-min').then((mod) => {
      const P: Plotly = (mod as { default?: Plotly }).default ?? mod
      if (cancelled || !ref.current) return
      plotly.current = P
      P.react(ref.current, data, layout ?? {}, { displayModeBar: false, responsive: true })
    })
    return () => { cancelled = true }
  }, [data, layout])

  // Purge the chart on unmount so Plotly releases its listeners/DOM.
  useEffect(() => () => {
    if (plotly.current && ref.current) plotly.current.purge(ref.current)
  }, [])

  return <div ref={ref} style={style} role="img" aria-label={ariaLabel} />
}
