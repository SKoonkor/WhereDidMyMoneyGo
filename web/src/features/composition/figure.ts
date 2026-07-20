// Donut + bar figures for the Income/Expense composition (port of
// build_pie_figure / build_hist_single in src/app/figures/pie.py). Pure: theme
// colours come in via `ui`. Each side is its own single-trace figure so the
// page can stack Income above Expense on narrow screens.
import type { Slice } from '../../lib/analytics/composition'

export interface UiColors { ink: string; muted: string; grid: string }
// Colour ramp endpoints per side (Income greens, Expense reds), light → dark.
export const RAMP = {
  income: ['#a7e8c4', '#0e6b3f'] as const,
  expense: ['#f4a3a3', '#a5281b'] as const,
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (rgb: number[]) => '#' + rgb.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
const mix = (a: number, b: number, t: number) => a + (b - a) * t

// n shades sampled light → dark from a ramp (mirrors pie.py `_shade`).
export function shade(n: number, ramp: readonly [string, string]): string[] {
  if (n <= 0) return []
  const [L, D] = [hexToRgb(ramp[0]), hexToRgb(ramp[1])]
  if (n === 1) return [toHex([mix(L[0], D[0], 0.5), mix(L[1], D[1], 0.5), mix(L[2], D[2], 0.5)])]
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return toHex([mix(L[0], D[0], t), mix(L[1], D[1], t), mix(L[2], D[2], t)])
  })
}

const transparent = { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)' }

export function buildDonutFigure(
  slices: Slice[],
  opts: { total: number; currency: string; kind: 'income' | 'expense'; censor: boolean; ui: UiColors; noData: string },
) {
  const { total, currency, kind, censor, ui, noData } = opts
  if (slices.length === 0) {
    return {
      data: [] as Record<string, unknown>[],
      layout: {
        height: 260, ...transparent, margin: { t: 8, b: 8, l: 8, r: 8 },
        annotations: [{ text: noData, x: 0.5, y: 0.5, showarrow: false, font: { color: ui.muted } }],
      } as Record<string, unknown>,
    }
  }
  const colors = shade(slices.length, RAMP[kind])
  const centre = censor ? '*****' : `${fmt(total)}<br><span style="font-size:0.72em;color:${ui.muted}">${currency}</span>`
  return {
    data: [
      {
        type: 'pie',
        hole: 0.5,
        sort: false,
        direction: 'clockwise',
        labels: slices.map((s) => s.category),
        values: slices.map((s) => s.amount),
        marker: { colors },
        textposition: 'inside',
        insidetextorientation: 'horizontal',
        texttemplate: '%{label}<br>%{percent}',
        hovertemplate: censor
          ? '%{label}: ***** (%{percent})<extra></extra>'
          : `%{label}: %{value:,.0f} ${currency} (%{percent})<extra></extra>`,
      },
    ] as Record<string, unknown>[],
    layout: {
      height: 260,
      showlegend: false,
      ...transparent,
      margin: { t: 8, b: 8, l: 8, r: 8 },
      font: { color: ui.muted },
      annotations: [
        { text: centre, x: 0.5, y: 0.5, showarrow: false, align: 'center', font: { size: 18, color: ui.ink } },
      ],
    } as Record<string, unknown>,
  }
}

export function buildBarsFigure(
  slices: Slice[],
  opts: { currency: string; kind: 'income' | 'expense'; censor: boolean; ui: UiColors; noData: string },
) {
  const { currency, kind, censor, ui, noData } = opts
  if (slices.length === 0) {
    return {
      data: [] as Record<string, unknown>[],
      layout: {
        height: 280, ...transparent, margin: { t: 8, b: 8, l: 8, r: 8 },
        annotations: [{ text: noData, x: 0.5, y: 0.5, showarrow: false, font: { color: ui.muted } }],
      } as Record<string, unknown>,
    }
  }
  const colors = shade(slices.length, RAMP[kind])
  const values = slices.map((s) => s.amount)
  return {
    data: [
      {
        type: 'bar',
        x: slices.map((s) => s.category),
        y: values,
        marker: { color: colors },
        text: censor ? values.map(() => '') : values.map((v) => fmt(v)),
        textposition: 'outside',
        textfont: { size: 10, color: ui.ink },
        cliponaxis: false,
        hovertemplate: censor ? '%{x}: *****<extra></extra>' : `%{x}: %{y:,.0f} ${currency}<extra></extra>`,
      },
    ] as Record<string, unknown>[],
    layout: {
      height: 280,
      showlegend: false,
      ...transparent,
      margin: { t: 8, b: 84, l: 44, r: 12 },
      dragmode: false, // tap a bar to read its value; no pan/zoom
      font: { color: ui.muted },
      xaxis: { tickangle: -30, automargin: true, fixedrange: true, tickfont: { size: 11 } },
      yaxis: { showticklabels: !censor, gridcolor: ui.grid, zeroline: false, fixedrange: true },
    } as Record<string, unknown>,
  }
}
