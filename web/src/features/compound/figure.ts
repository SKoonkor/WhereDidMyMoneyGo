// Growth-over-time figure for the Compound Interest calculator — a port of
// build_compound_figure in src/app/figures/compound.py. Pure: theme colours come
// in via `ui`. Draws the maturity line with a ±20% rate band, the cumulative
// principal, optional "after buying goals" trajectories, and a horizontal line +
// buy markers for each selected goal.
import type { Schedule, CompoundGoal } from '../../lib/analytics/compound'

type Dict = Record<string, unknown>
export interface UiColors { ink: string; muted: string; grid: string; anno: string }

const INCOME_COLOR = '#2ecc71'
const SAVING_COLOR = '#3498db'
// Distinct colours cycled across selected goal lines/markers.
export const GOAL_PALETTE = ['#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#e74c3c', '#f1c40f']

const transparent = { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)' }
const g = (n: number) => (Number.isInteger(n) ? String(n) : String(n))

export function buildCompoundFigure(
  sched: Schedule,
  opts: { currency: string; goals: CompoundGoal[]; ui: UiColors; labels: CompoundLabels },
) {
  const { currency, goals, ui, labels } = opts
  const m = sched.months
  const M = sched.period
  const ratePct = sched.annualRate * 100
  const data: Dict[] = []

  const hover = (name: string) =>
    `${labels.month} %{x}<br>%{y:,.0f} ${currency}<extra>${name}</extra>`

  // ±20% rate uncertainty band (high, then low filled to it).
  data.push({ x: m, y: sched.maturityHigh.slice(0, m.length), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false })
  data.push({
    x: m, y: sched.maturityLow.slice(0, m.length), mode: 'lines', line: { width: 0 },
    fill: 'tonexty', fillcolor: 'rgba(46,204,113,0.18)',
    name: labels.band(ratePct * 0.8, ratePct * 1.2), hoverinfo: 'skip',
  })

  // Maturity line.
  data.push({
    x: m, y: sched.maturity, mode: 'lines',
    name: labels.maturity(ratePct), line: { color: INCOME_COLOR, width: 2.5 },
    hovertemplate: hover(labels.maturityShort),
  })

  // "After buying" trajectories (only when goals are selected).
  if (goals.length) {
    data.push({
      x: m, y: sched.maturityBought, mode: 'lines',
      name: labels.afterFactor, line: { color: '#8e44ad', width: 2.5 },
      hovertemplate: hover(labels.afterFactor),
    })
    data.push({
      x: m, y: sched.maturityBoughtPlain, mode: 'lines',
      name: labels.afterPlain, line: { color: '#e84393', width: 2.5 },
      hovertemplate: hover(labels.afterPlain),
    })
  }

  // Cumulative contributions.
  data.push({
    x: m, y: sched.principal, mode: 'lines', name: labels.principal,
    line: { color: ui.muted, width: 2, dash: 'dash' },
    hovertemplate: hover(labels.principal),
  })

  // Each goal at its EFFECTIVE target (amount × factor), smallest first so they
  // stack low→high. Horizontal dotted line + a label anchored at the left.
  const eff = goals
    .map(([name, a, f], i) => ({ name, target: a * f, factor: f, orig: i }))
    .sort((x, y) => x.target - y.target)
  const colorByName = new Map<string, string>()
  const shapes: Dict[] = []
  const annotations: Dict[] = []
  eff.forEach((e, i) => {
    const color = GOAL_PALETTE[i % GOAL_PALETTE.length]
    colorByName.set(e.name, color)
    const label = e.factor > 1 ? `${e.name} (×${g(e.factor)})` : e.name
    shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: e.target, y1: e.target, line: { color, dash: 'dot', width: 1.5 } })
    annotations.push({ xref: 'paper', x: 0, xanchor: 'left', yref: 'y', y: e.target, yanchor: 'bottom', yshift: 6, showarrow: false, text: label, font: { color, size: 13 } })
  })

  // Buy markers — circles on the ×factor line, diamonds on the plain line.
  const marker = (hits: typeof sched.goalHits, symbol: string) => {
    if (!hits.length) return
    data.push({
      x: hits.map((h) => h.month), y: hits.map((h) => h.target),
      mode: 'markers', showlegend: false, hoverinfo: 'text',
      hovertext: hits.map((h) => labels.bought(h.name, h.month)),
      marker: { size: 11, symbol, color: hits.map((h) => colorByName.get(h.name) ?? SAVING_COLOR), line: { color: '#fff', width: 1.5 } },
    })
  }
  marker(sched.goalHits, 'circle')
  marker(sched.goalHitsPlain, 'diamond')

  const yTop = sched.maturityHigh[M] * 1.05

  return {
    data,
    layout: {
      height: 400,
      ...transparent,
      xaxis: { title: labels.months, range: [0, M], autorange: false, gridcolor: ui.grid, color: ui.muted },
      yaxis: { title: labels.value(currency), range: [0, yTop], gridcolor: ui.grid, color: ui.muted },
      hovermode: 'x unified',
      hoverlabel: { bgcolor: ui.anno, bordercolor: ui.grid, font: { color: ui.ink } },
      dragmode: 'pan',
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.01, font: { color: ui.muted, size: 11 } },
      margin: { t: 70, b: 44, l: 64, r: 20 },
      font: { color: ui.muted },
      shapes,
      annotations,
    } as Dict,
  }
}

// All display strings composed by the page (keeps this module i18n-free).
export interface CompoundLabels {
  title: string
  months: string
  month: string
  value: (currency: string) => string
  band: (lo: number, hi: number) => string
  maturity: (pct: number) => string
  maturityShort: string
  afterFactor: string
  afterPlain: string
  principal: string
  bought: (name: string, month: number) => string
}
