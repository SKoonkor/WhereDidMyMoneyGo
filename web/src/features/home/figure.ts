// Net-worth trend figure (Plotly spec). Pure — colours are passed in so the
// builder stays testable and the component owns theme/CSS-variable reading.
import type { TrendPoint } from '../../lib/analytics/networth'

export interface Palette { accent: string; muted: string; grid: string }

// Convert "#rrggbb" to "rgba(r,g,b,a)"; pass anything else through unchanged.
function withAlpha(color: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function buildNetWorthTrendFigure(
  points: TrendPoint[],
  opts: { palette: Palette; censor: boolean },
) {
  const { palette, censor } = opts
  // ~180 daily points, so a plain line (no markers); dates on a date axis let
  // Plotly place clean month ticks.
  return {
    data: [
      {
        type: 'scatter',
        mode: 'lines',
        x: points.map((p) => p.date),
        y: points.map((p) => p.value),
        line: { color: palette.accent, width: 2 },
        fill: 'tozeroy',
        fillcolor: withAlpha(palette.accent, 0.13),
        hovertemplate: censor
          ? '%{x|%d %b %Y}<extra></extra>'
          : '%{x|%d %b %Y}<br>%{y:,.0f}<extra></extra>',
      },
    ] as Record<string, unknown>[],
    layout: {
      height: 200,
      margin: { t: 8, b: 28, l: censor ? 12 : 48, r: 12 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: palette.muted, size: 11 },
      xaxis: { type: 'date', showgrid: false, fixedrange: true },
      yaxis: { gridcolor: palette.grid, zeroline: false, fixedrange: true, showticklabels: !censor },
      showlegend: false,
    } as Record<string, unknown>,
  }
}
