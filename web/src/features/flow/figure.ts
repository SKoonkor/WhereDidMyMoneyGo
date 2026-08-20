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

// Plot box. The top margin is deliberately small: nothing is drawn up there (no
// title, and the net-worth annotation sits inside the plot area), so anything
// more is just dead space between the box header and the chart.
export const FLOW_PLOT_H = 184
export const FLOW_PLOT_MT = 16
export const FLOW_PLOT_MB = 36

// The income up-arrow sits this many pixels above its bar top. It is a Plotly
// `marker.standoff`, i.e. a real pixel offset — the arrow is therefore immune to
// y-range changes, which matters because the range is now refitted live as the
// user pans and zooms (see flowYRange).
export const ARROW_STANDOFF_PX = 13
// Standoff + half the 9px marker: the vertical room an arrow needs above the
// highest bar so a fitted range doesn't clip it.
export const ARROW_HEADROOM_PX = 18
// Fraction of the fitted span added as breathing room top and bottom. Kept at
// 8% rather than the trading chart's 6% — the net-worth annotation is drawn
// inside the plot area and needs the extra.
export const FLOW_Y_PAD = 0.08

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

// ── Y-range fitting ──────────────────────────────────────────────────────────
// The y-axis spans only what is visible in the current x-window, refitted as the
// user pans and zooms (the paper-trading chart does the same via lib/chart's
// autoRange). Deliberately NOT included: the zero line, the net-worth line, and
// the outer 90% forecast band. All three still draw; they simply come into view
// when the window reaches them, instead of stretching the axis to reach them.

/** Flattened, x-sorted view of everything the range may consider. Built once
 *  per (flow, forecast) and scanned per frame, so the date parsing and the sort
 *  never happen inside a gesture. */
export interface FlowYSource {
  /** Bars as full spans, not centres — see flowYRange. Sorted by `x0`. */
  bars: Array<{ x0: number; x1: number; lo: number; hi: number }>
  /** The running-balance connectors over quiet days, `null` breaks dropped. */
  line: Array<{ x: number; y: number }>
  /** The INNER (50%) forecast band only. */
  band: Array<{ x: number; lo: number; hi: number }>
}

export function buildFlowYSource(flow: FlowData, forecast: Forecast | null): FlowYSource {
  const bars = flow.bars
    .map((b) => ({
      x0: b.x - b.widthMs / 2,
      x1: b.x + b.widthMs / 2,
      lo: Math.min(b.base, b.base + b.height),
      hi: Math.max(b.base, b.base + b.height),
    }))
    .sort((a, b) => a.x0 - b.x0)

  // Connectors are the balance line over days with no transaction. Without them
  // a window that lands in a quiet stretch would contain no data at all and the
  // range would have nothing to fit.
  const line: Array<{ x: number; y: number }> = []
  const cx = flow.connectors.x
  const cy = flow.connectors.y
  for (let i = 0; i < cx.length; i++) {
    const x = cx[i]
    const y = cy[i]
    if (typeof x === 'number' && typeof y === 'number') line.push({ x, y })
  }

  const band: Array<{ x: number; lo: number; hi: number }> = []
  if (forecast) {
    for (let i = 0; i < forecast.dates.length; i++) {
      band.push({ x: dayMs(forecast.dates[i]), lo: forecast.lo50[i], hi: forecast.hi50[i] })
    }
  }

  return { bars, line, band }
}

/** Fit to `[x0, x1]`. Returns null when the window holds nothing — the caller
 *  keeps whatever range it already had rather than collapsing to a point. */
export function flowYRange(src: FlowYSource, x0: number, x1: number): { lo: number; hi: number } | null {
  let lo = Infinity
  let hi = -Infinity

  // A bar is included when any part of it is on screen. Testing the centre
  // instead would drop a bar that is half over the edge — out of its own fit
  // while still visibly drawn.
  for (const b of src.bars) {
    if (b.x0 > x1) break // sorted by x0, so nothing further can overlap
    if (b.x1 < x0) continue
    if (b.lo < lo) lo = b.lo
    if (b.hi > hi) hi = b.hi
  }
  for (const p of src.line) {
    if (p.x < x0 || p.x > x1) continue
    if (p.y < lo) lo = p.y
    if (p.y > hi) hi = p.y
  }
  for (const p of src.band) {
    if (p.x < x0 || p.x > x1) continue
    if (p.lo < lo) lo = p.lo
    if (p.hi > hi) hi = p.hi
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null

  // Dead-flat guard (mirrors lib/chart/scale.ts): without it a stretch of
  // identical balances zooms the axis into floating-point noise.
  const floor = Math.max(Math.abs(hi) * 1e-6, 1)
  if (hi - lo < floor) {
    const mid = (hi + lo) / 2
    return { lo: mid - floor / 2, hi: mid + floor / 2 }
  }
  return { lo, hi }
}

/** Breathing room around a fitted span. `areaPx` is the drawn plot height;
 *  `arrows` asks for enough headroom that an income arrow on the highest bar is
 *  not clipped (they are pixel-offset, so the guarantee has to be in pixels). */
export function padFlowY(lo: number, hi: number, areaPx: number, arrows = false): [number, number] {
  const span = hi - lo
  const headroom = arrows && areaPx > 0 ? (span * ARROW_HEADROOM_PX) / areaPx : 0
  const pad = Math.max(span * FLOW_Y_PAD, headroom, 1)
  return [lo - pad, hi + pad]
}

/** The opening x-window: the last `defaultDays` of ledger, plus the forecast.
 *  Also what a double-tap resets to. */
export function flowDefaultRange(
  flow: FlowData, forecast: Forecast | null, defaultDays: number,
): { x0: number; x1: number } {
  const fcEnd = forecast ? dayMs(forecast.dates[forecast.dates.length - 1]) : flow.lastDay
  // Never open further back than the ledger itself goes. On a young ledger the
  // raw `lastDay - defaultDays` sits before the first transaction, which both
  // wastes the left half of the chart on nothing and made the opening window
  // WIDER than flowDataBounds — so clampView re-centred it and the very first
  // pan or zoom lurched sideways. Clamped, the window is at most the full data
  // extent, which clampView maps to itself (either through the slack branch or,
  // when they are exactly equal, as an identity through the centring one).
  const x0 = Math.max(flow.lastDay - defaultDays * MS_PER_DAY, flow.firstDay - MS_PER_DAY)
  return { x0, x1: fcEnd + MS_PER_DAY }
}

/** Full extent of the data, for clamping pan and zoom. */
export function flowDataBounds(
  flow: FlowData, forecast: Forecast | null,
): { min: number; max: number } {
  const fcEnd = forecast ? dayMs(forecast.dates[forecast.dates.length - 1]) : flow.lastDay
  return { min: flow.firstDay - MS_PER_DAY, max: fcEnd + MS_PER_DAY }
}

export interface FlowFigureOpts {
  currency: string
  defaultDays: number
  censor: boolean
  ui: FlowUi
  /**
   * Every account in the ledger, for colour lookup. `accountColor` falls back to
   * a palette indexed by position, so without this a filtered `flow.accounts`
   * (one entry, index 0) would repaint an unnamed account.
   */
  allAccounts?: string[]
  /** Drawn plot height in px. Defaults to FLOW_PLOT_H — the Home widget's box. */
  height?: number
  /**
   * The Flow page drives pan/zoom/inspect itself (useFlowInteraction), so Plotly's
   * own drag and touch-hover have to stand down or the two fight over the same
   * gestures. Left off, the figure keeps the plain pannable behaviour the Home
   * widget has always had.
   */
  interactive?: boolean
  noData: string
  labels: { netWorth: string; balances: string; amount: string; balanceAfter: string; forecast: string; hidden: string }
}

export function buildFlowFigure(flow: FlowData, forecast: Forecast | null, opts: FlowFigureOpts) {
  const { currency, defaultDays, censor, ui, noData, labels } = opts
  const h = opts.height ?? FLOW_PLOT_H
  const order = opts.allAccounts ?? flow.accounts
  const colorIdx = (name: string) => {
    const i = order.indexOf(name)
    return i >= 0 ? i : 0
  }

  if (flow.bars.length === 0) {
    return {
      data: [] as Dict[],
      layout: {
        // Same box as the real figure — kept on the constants so the two can't
        // drift apart (they had, before figure.test.ts started asserting it).
        height: h, ...transparent, margin: { t: FLOW_PLOT_MT, b: FLOW_PLOT_MB, l: 60, r: 20 },
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
  flow.accounts.forEach((account) => {
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
        color: accountColor(account, colorIdx(account)),
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

  // ── Green up-arrow above each Income bar (replaces the old dark outline) ─────
  // A fixed-size triangle pinned ARROW_STANDOFF_PX above the bar top by Plotly's
  // pixel-space `marker.standoff`. It used to be offset in data units derived
  // from the y-range, which detached the arrows the moment the range moved —
  // and the range now moves on every pan.
  const incomeBars = flow.bars.filter((b) => b.type === 'Income')
  if (incomeBars.length) {
    data.push({
      type: 'scatter',
      mode: 'markers',
      x: incomeBars.map((b) => b.x),
      y: incomeBars.map((b) => b.base + b.height),
      marker: {
        symbol: 'triangle-up', size: 9, color: INCOME_COLOR,
        angle: 0, angleref: 'up', standoff: ARROW_STANDOFF_PX,
      },
      hoverinfo: 'skip',
      showlegend: false,
      // Clipped, not floating: with a window-fitted range an arrow for a bar
      // panned off the edge would otherwise paint over the axis labels.
      cliponaxis: true,
    })
  }

  // ── Opening window, y fitted to it via the very same code every refit uses ──
  const { x0, x1 } = flowDefaultRange(flow, forecast, defaultDays)
  const fit = flowYRange(buildFlowYSource(flow, forecast), x0, x1)
  const [y0, y1] = fit
    ? padFlowY(fit.lo, fit.hi, h - FLOW_PLOT_MT - FLOW_PLOT_MB, incomeBars.length > 0)
    : [-1, 1]

  return {
    data,
    layout: {
      height: h,
      barmode: 'overlay',
      bargap: 0,
      ...transparent,
      // Interactive mode owns hover too: Plotly would otherwise fire its own
      // tooltip on touchstart alongside the hold-to-inspect readout.
      // useFlowInteraction flips this back to 'closest' for a real mouse.
      hovermode: opts.interactive ? false : 'closest',
      dragmode: opts.interactive ? false : 'pan',
      margin: { t: FLOW_PLOT_MT, b: FLOW_PLOT_MB, l: censor ? 10 : 44, r: 8 },
      font: { color: ui.muted, size: 11 },
      showlegend: false,
      shapes,
      annotations,
      xaxis: { type: 'date', range: [x0, x1], showgrid: false, fixedrange: false },
      yaxis: { range: [y0, y1], showticklabels: !censor, gridcolor: ui.grid, zeroline: false, fixedrange: true },
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
