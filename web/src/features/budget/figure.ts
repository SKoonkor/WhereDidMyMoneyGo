// Budget spending donut (Plotly spec) — port of src/app/figures/budget_pie.py.
// Every slice is a share of the month's *budget* (not of total expense). Needs
// draw from a blue ramp, Wants from an orange ramp, so the donut shows a blue
// arc then an orange arc; a grey "Remaining budget" slice fills the rest when
// under budget. Pure: theme colours come in via `ui`.
import { shade } from '../composition/figure'
import { HIDDEN_LABEL, type PieItem } from '../../lib/analytics/budget'

export interface BudgetUi { ink: string; muted: string; expense: string }

const BLUE_RAMP = ['#cfe3f5', '#1f5fa8'] as const // Needs
const ORANGE_RAMP = ['#ffd8a8', '#d9730d'] as const // Wants
const HIDDEN_COLOR = '#5a6472' // slate — reconciliation hidden cost
const REMAINING_COLOR = '#454e5c' // dim grey — unspent budget

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const transparent = { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)' }
type Dict = Record<string, unknown>

export interface BudgetPieOpts {
  remaining: number
  total: number
  budget: number
  currency: string
  ui: BudgetUi
  censor: boolean
  labels: { noData: string; remaining: string; ofBudget: string; hidden: string }
}

export function buildBudgetPie(pie: PieItem[], opts: BudgetPieOpts) {
  const { remaining, total, budget, currency, ui, censor, labels } = opts

  if (pie.length === 0 || budget <= 0) {
    return {
      data: [] as Dict[],
      layout: {
        height: 300, ...transparent, showlegend: false, margin: { t: 14, b: 14, l: 14, r: 14 },
        annotations: [{ text: labels.noData, x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, font: { color: ui.muted } }],
      } as Dict,
    }
  }

  // Colour each slice by bucket order (Hidden cost is slate wherever it sits).
  const nNeeds = pie.filter((p) => p.bucket === 'Needs' && p.label !== HIDDEN_LABEL).length
  const nWants = pie.filter((p) => p.bucket === 'Wants' && p.label !== HIDDEN_LABEL).length
  const blues = shade(nNeeds, BLUE_RAMP)
  const oranges = shade(nWants, ORANGE_RAMP)
  let bi = 0
  let oi = 0
  const labelsArr: string[] = []
  const values: number[] = []
  const colors: string[] = []
  for (const item of pie) {
    labelsArr.push(item.label === HIDDEN_LABEL ? labels.hidden : item.label)
    values.push(item.amount)
    if (item.label === HIDDEN_LABEL) colors.push(HIDDEN_COLOR)
    else if (item.bucket === 'Needs') colors.push(blues[bi++])
    else colors.push(oranges[oi++])
  }
  if (remaining > 0) {
    labelsArr.push(labels.remaining)
    values.push(remaining)
    colors.push(REMAINING_COLOR)
  }

  const pctOfBudget = values.map((v) => (v / budget) * 100)
  const spentPct = (total / budget) * 100
  const centre = `${spentPct.toFixed(0)}%<br><span style="font-size:0.7em;color:${ui.muted}">${labels.ofBudget}</span>`

  return {
    data: [
      {
        type: 'pie',
        labels: labelsArr,
        values,
        customdata: pctOfBudget,
        hole: 0.55,
        sort: false,
        direction: 'clockwise',
        marker: { colors },
        textposition: 'inside',
        insidetextorientation: 'horizontal',
        texttemplate: '%{label}<br>%{customdata:.0f}%',
        hovertemplate: censor
          ? `%{label}: ***** (%{customdata:.0f}% ${labels.ofBudget})<extra></extra>`
          : `%{label}: %{value:,.0f} ${currency} (%{customdata:.0f}% ${labels.ofBudget})<extra></extra>`,
      },
    ] as Dict[],
    layout: {
      height: 300,
      showlegend: false,
      ...transparent,
      margin: { t: 14, b: 14, l: 14, r: 14 },
      font: { color: ui.muted },
      annotations: [
        {
          text: censor ? `*****<br><span style="font-size:0.7em;color:${ui.muted}">${labels.ofBudget}</span>` : centre,
          x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, xanchor: 'center', yanchor: 'middle', align: 'center',
          font: { size: 22, color: total <= budget ? ui.ink : ui.expense },
        },
      ],
    } as Dict,
  }
}

// exported for tests
export const _colors = { BLUE_RAMP, ORANGE_RAMP, HIDDEN_COLOR, REMAINING_COLOR }
export { fmt as _fmt }
