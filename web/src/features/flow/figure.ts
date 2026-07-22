// Money-flow figure (Plotly spec) — the presentational half of
// src/app/figures/money_flow.py. Pure: theme colours come in via `ui`, the data
// via buildFlow(), the projection via forecast(). One bar trace per account
// (income-like bars outlined), dashed bridges over quiet days, a dashed net-worth
// line, a latest-balances box, alternating month bands, and the forecast fan.
import type { FlowData } from '../../lib/analytics/moneyflow'
import type { Forecast } from '../../lib/analytics/forecast'

export interface FlowUi {
  ink: string
  muted: string
  grid: string
  band: string
  annoBg: string
}

const EXPENSE_COLOR = '#e74c3c'
const INCOME_COLOR = '#2ecc71'
const FORECAST_COLOR = '#3498db'
const BAR_OUTLINE = 'rgba(0,0,0,0.6)'

// Plot box + the pixel gap between an Income bar top and its up-arrow. Kept as
// constants so the arrow standoff (computed in data units) tracks the layout.
const PLOT_H = 230
const PLOT_MT = 40
const PLOT_MB = 36
const ARROW_STANDOFF_PX = 13

// Stable colour per account (mirrors theme.ACCOUNT_COLORS + FALLBACK_PALETTE).
const ACCOUNT_COLORS: Record<string, string> = {
  'Bank Accounts': '#3498db',
  'Credit Card': '#e74c3c',
  Savings: '#2ecc71',
  Cash: '#f39c12',
  Wallet: '#9b59b6',
  Card: '#1abc9c',
  Brokerage: '#e67e22',
}
const FALLBACK_PALETTE = ['#34495e', '#7f8c8d', '#d35400', '#8e44ad', '#16a085']
const accountColor = (name: string, i: number): string =>
  ACCOUNT_COLORS[name] ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]

const MS_PER_DAY = 86_400_000
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const transparent = { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)' }

type Dict = Record<string, unknown>

export interface FlowFigureOpts {
  currency: string
  defaultDays: number
  censor: boolean
  ui: FlowUi
  noData: string
  labels: { netWorth: string; balances: string; amount: string; balanceAfter: string; forecast: string; hidden: string }
}

export function buildFlowFigure(flow: FlowData, forecast: Forecast | null, opts: FlowFigureOpts) {
  const { currency, defaultDays, censor, ui, noData, labels } = opts

  if (flow.bars.length === 0) {
    return {
      data: [] as Dict[],
      layout: {
        height: 230, ...transparent, margin: { t: 40, b: 40, l: 60, r: 20 },
        annotations: [{ text: noData, x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, font: { color: ui.muted, size: 16 } }],
      } as Dict,
    }
  }

  const data: Dict[] = []

  // ── Dashed connectors over quiet days (drawn first, behind the bars) ────────
  if (flow.connectors.x.length) {
    data.push({
      type: 'scatter', mode: 'lines', x: flow.connectors.x, y: flow.connectors.y,
      line: { color: ui.muted, width: 1, dash: 'dot' }, hoverinfo: 'skip', showlegend: false,
    })
  }

  // ── One bar trace per account ───────────────────────────────────────────────
  flow.accounts.forEach((account, i) => {
    const sub = flow.bars.filter((b) => b.account === account)
    if (sub.length === 0) return
    data.push({
      type: 'bar',
      x: sub.map((b) => b.x),
      y: sub.map((b) => b.height),
      base: sub.map((b) => b.base),
      width: sub.map((b) => b.widthMs),
      name: account,
      showlegend: false,
      marker: {
        color: accountColor(account, i),
        // Income now reads via a green up-arrow above the bar (added below); its
        // dark outline is dropped. Transfer-/Adjustment-In keep the outline.
        line: { color: BAR_OUTLINE, width: sub.map((b) => (b.incomeLike && b.type !== 'Income' ? 1.6 : 0)) },
      },
      customdata: sub.map((b) => [b.type, b.amount, b.cumAfter, b.date, b.category]),
      hovertemplate:
        `<b>%{customdata[0]}</b> · ${account}<br>%{customdata[3]}<br>%{customdata[4]}<br>` +
        (censor
          ? `${labels.amount}: ***** ${currency}<br>${labels.balanceAfter}: ***** ${currency}<extra></extra>`
          : `${labels.amount}: %{customdata[1]:,.0f} ${currency}<br>${labels.balanceAfter}: %{customdata[2]:,.0f} ${currency}<extra></extra>`),
    })
  })

  // ── Forecast fan (behind median): 90% then 50% bands, then the dashed line ──
  if (forecast) {
    const fx = forecast.dates
    data.push({ type: 'scatter', mode: 'lines', x: fx, y: forecast.hi90, line: { width: 0 }, hoverinfo: 'skip', showlegend: false })
    data.push({ type: 'scatter', mode: 'lines', x: fx, y: forecast.lo90, line: { width: 0 }, fill: 'tonexty', fillcolor: 'rgba(52,152,219,0.12)', hoverinfo: 'skip', showlegend: false })
    data.push({ type: 'scatter', mode: 'lines', x: fx, y: forecast.hi50, line: { width: 0 }, hoverinfo: 'skip', showlegend: false })
    data.push({ type: 'scatter', mode: 'lines', x: fx, y: forecast.lo50, line: { width: 0 }, fill: 'tonexty', fillcolor: 'rgba(52,152,219,0.22)', hoverinfo: 'skip', showlegend: false })
    data.push({
      type: 'scatter', mode: 'lines', x: fx, y: forecast.median, name: labels.forecast,
      line: { color: FORECAST_COLOR, width: 2, dash: 'dash' },
      hovertemplate: `%{x|%d/%m/%Y}<br>${censor ? '***** ' : '%{y:,.0f} '}${currency}<extra>${labels.forecast}</extra>`,
    })
  }

  // ── Shapes: month bands, zero line, net-worth line ──────────────────────────
  const shapes: Dict[] = flow.months
    .filter((m) => m.shaded)
    .map((m) => ({
      type: 'rect', xref: 'x', yref: 'paper', x0: m.start, x1: m.start + monthWidth(m.start),
      y0: 0, y1: 1, fillcolor: ui.band, opacity: 0.05, line: { width: 0 }, layer: 'below',
    }))
  shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: EXPENSE_COLOR, width: 1.5 }, layer: 'below' })
  shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: flow.netWorth, y1: flow.netWorth, line: { color: ui.ink, width: 1.2, dash: 'dash' }, layer: 'below' })

  // ── Annotations: net-worth label (latest balances now live in a card below) ──
  const nwTxt = censor ? '*****' : fmt(flow.netWorth)
  const annotations: Dict[] = [
    { x: 0, y: flow.netWorth, xref: 'paper', yref: 'y', xanchor: 'left', yanchor: 'bottom', showarrow: false, text: `${labels.netWorth} ${nwTxt} ${currency}`, font: { size: 11, color: ui.ink } },
  ]

  // ── Opening window: last `defaultDays` of data (+ forecast), y fit to it ─────
  const x0 = flow.lastDay - defaultDays * MS_PER_DAY
  const fcEnd = forecast ? dayMs(forecast.dates[forecast.dates.length - 1]) : flow.lastDay
  const x1 = fcEnd + MS_PER_DAY
  const win = flow.bars.filter((b) => b.x >= x0)
  const los: number[] = []
  const his: number[] = []
  if (win.length) {
    los.push(Math.min(...win.map((b) => b.base)))
    his.push(Math.max(...win.map((b) => b.base + b.height)))
  }
  los.push(0, flow.netWorth)
  his.push(0, flow.netWorth)
  if (forecast) {
    los.push(Math.min(...forecast.lo90))
    his.push(Math.max(...forecast.hi90))
  }
  const lo = Math.min(...los)
  const hi = Math.max(...his)
  const pad = Math.max((hi - lo) * 0.08, 1)

  // ── Green up-arrow above each Income bar (replaces the old dark outline) ──────
  // A fixed-size triangle marker set above the bar top, so every income reads the
  // same regardless of amount. The standoff is derived in pixels (≈ one marker
  // height clear of the bar) and converted to data units via the plot's drawn
  // height (layout height − top/bottom margins, mirrored below).
  const incomeBars = flow.bars.filter((b) => b.type === 'Income')
  if (incomeBars.length) {
    const areaPx = PLOT_H - PLOT_MT - PLOT_MB
    const standoff = (ARROW_STANDOFF_PX * ((hi - lo) + 2 * pad)) / areaPx
    data.push({
      type: 'scatter',
      mode: 'markers',
      x: incomeBars.map((b) => b.x),
      y: incomeBars.map((b) => b.base + b.height + standoff),
      marker: { symbol: 'triangle-up', size: 9, color: INCOME_COLOR },
      hoverinfo: 'skip',
      showlegend: false,
      cliponaxis: false,
    })
  }

  return {
    data,
    layout: {
      height: PLOT_H,
      barmode: 'overlay',
      bargap: 0,
      ...transparent,
      hovermode: 'closest',
      dragmode: 'pan',
      margin: { t: PLOT_MT, b: PLOT_MB, l: censor ? 10 : 44, r: 8 },
      font: { color: ui.muted, size: 11 },
      showlegend: false,
      shapes,
      annotations,
      xaxis: { type: 'date', range: [x0, x1], showgrid: false, fixedrange: false },
      yaxis: { range: [lo - pad, hi + pad], showticklabels: !censor, gridcolor: ui.grid, zeroline: false, fixedrange: true },
    } as Dict,
  }
}

const dayMs = (iso: string): number => new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime()

// Width of the calendar month starting at `startMs` (UTC), in ms.
function monthWidth(startMs: number): number {
  const d = new Date(startMs)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d.getTime() - startMs
}
