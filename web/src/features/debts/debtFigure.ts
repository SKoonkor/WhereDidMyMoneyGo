// The payoff projection: total owed, month by month, until it hits zero.
//
// Two lines rather than one. The baseline is the plan as it stands; the scenario
// is whatever the what-if card is currently proposing. Seeing them diverge is the
// entire argument the page is making — a single line would show a payoff date
// without ever showing what it cost to get there.
//
// Pure: theme colours and every string arrive through opts, like the other
// figure builders in this app.
type Dict = Record<string, unknown>

export interface DebtUi { ink: string; muted: string; grid: string; anno: string }

export interface DebtFigureLabels {
  month: string
  owed: (currency: string) => string
  baseline: string
  scenario: string
}

export interface DebtFigureOpts {
  /** Total owed after each month, index 0 = today. From simulatePayoff. */
  baseline: number[]
  /** The what-if run, when one is active. */
  scenario?: number[]
  scenarioName?: string
  currency: string
  censor: boolean
  ui: DebtUi
  labels: DebtFigureLabels
}

const BASE_COLOR = '#e74c3c'
// Amber, not green. The only scenario on offer is borrowing MORE, and a green
// line beside a red one reads as the better choice — which is the opposite of
// what this chart is showing.
const SCENARIO_COLOR = '#f39c12'

export function buildDebtFigure(o: DebtFigureOpts): { data: Dict[]; layout: Dict } {
  const line = (y: number[], name: string, color: string, dash?: string): Dict => ({
    x: y.map((_, i) => i),
    y,
    type: 'scatter',
    mode: 'lines',
    name,
    line: { color, width: 2.4, ...(dash ? { dash } : {}) },
    fill: 'tozeroy',
    fillcolor: rgba(color, 0.1),
    hovertemplate: o.censor ? '%{x}<extra></extra>' : `%{y:,.0f} ${o.currency}<extra>${name}</extra>`,
  })

  const data = [line(o.baseline, o.labels.baseline, BASE_COLOR)]
  if (o.scenario) {
    data.push(line(o.scenario, o.scenarioName || o.labels.scenario, SCENARIO_COLOR, 'dot'))
  }

  // Both lines share an axis, so the longer plan sets the span — otherwise a
  // scenario that finishes later would be cut off exactly where it matters.
  const span = Math.max(o.baseline.length, o.scenario?.length ?? 0) - 1

  return {
    data,
    layout: {
      height: 260,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: {
        // Plotly 3 wants the object form here; a bare string is silently dropped.
        title: { text: o.labels.month },
        range: [0, Math.max(1, span)],
        gridcolor: o.ui.grid,
        color: o.ui.muted,
        // The chart is short, so let Plotly claim the room the titles need rather
        // than guessing margins that clip them.
        automargin: true,
      },
      yaxis: {
        title: { text: o.censor ? '' : o.labels.owed(o.currency) },
        rangemode: 'tozero',
        fixedrange: true,
        gridcolor: o.ui.grid,
        color: o.ui.muted,
        // Amounts are the one thing "hide amounts" must actually hide.
        showticklabels: !o.censor,
        automargin: true,
      },
      hovermode: 'x unified',
      hoverlabel: { bgcolor: o.ui.anno, bordercolor: o.ui.grid, font: { color: o.ui.ink } },
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, font: { color: o.ui.muted, size: 11 } },
      margin: { t: 34, b: 44, l: o.censor ? 16 : 52, r: 10 },
    } as Dict,
  }
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`
}
