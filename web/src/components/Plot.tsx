import { useEffect, useRef } from 'react'

// Reusable Plotly wrapper. Plotly (~1 MB) is dynamically imported so it stays
// out of the initial bundle — the page's numbers paint immediately and the
// chart streams in once the library loads. Shared by every Phase 2 dashboard.
type Trace = Record<string, unknown>
type Layout = Record<string, unknown>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plotly = any

export function Plot({
  data, layout, style, ariaLabel, config,
}: {
  data: Trace[]
  layout?: Layout
  style?: React.CSSProperties
  ariaLabel?: string
  config?: Record<string, unknown>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const plotly = useRef<Plotly>(null)

  useEffect(() => {
    let cancelled = false
    import('plotly.js-dist-min').then((mod) => {
      const P: Plotly = (mod as { default?: Plotly }).default ?? mod
      if (cancelled || !ref.current) return
      plotly.current = P
      P.react(ref.current, data, layout ?? {}, { displayModeBar: false, responsive: true, ...config })
    })
    return () => { cancelled = true }
  }, [data, layout, config])

  // Re-fit the chart whenever its container changes width (e.g. the 2-col Pie
  // grid → full-width Bars column). Plotly's `responsive` only reacts to window
  // resizes, not CSS-driven container reflows, so watch the element directly.
  // Guard on width only: Plotly.resize mutates the element's height, which would
  // otherwise re-trigger the observer and oscillate.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastW = el.getBoundingClientRect().width
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (w && Math.abs(w - lastW) > 1) {
        lastW = w
        if (plotly.current) plotly.current.Plots.resize(el)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Purge the chart on unmount so Plotly releases its listeners/DOM.
  useEffect(() => () => {
    if (plotly.current && ref.current) plotly.current.purge(ref.current)
  }, [])

  // Pin the wrapper's height to the figure's own height. Without a definite
  // height, Plots.resize() reads the container's content-driven height and
  // collapses it to 0 (its own content then has nothing to measure against).
  const figH = typeof layout?.height === 'number' ? (layout.height as number) : undefined
  const mergedStyle: React.CSSProperties = figH ? { ...style, height: figH } : (style ?? {})

  return <div ref={ref} style={mergedStyle} role="img" aria-label={ariaLabel} />
}
