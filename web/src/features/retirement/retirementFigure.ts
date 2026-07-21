// Retirement-projection figure — a port of build_retirement_figure (non-Monte-
// Carlo path) in src/app/figures/retirement.py. Balance over the plan's lifetime
// on an age x-axis: a nominal line and (optionally) a real (today's-money) line,
// the retirement span shaded, retirement/financial-freedom/depletion markers, and
// — when goals are supplied — ×factor and plain goal-buying trajectories with a
// buy marker at each purchase. Pure: theme colours + strings come in via opts.
import type { Retirement } from '../../lib/analytics/retirement'
import type { McResult, DepEvent, Event } from '../../lib/analytics/retirement_mc'

type Dict = Record<string, unknown>
export interface RetUi { ink: string; muted: string; grid: string; anno: string }

const INCOME_COLOR = '#2ecc71'
const SAVING_COLOR = '#3498db'
const EXPENSE_COLOR = '#e74c3c'
const PLAIN_COLOR = '#e84393'
const FREEDOM_COLOR = '#f1c40f'
// Alternate purple shades for goal overlay lines + leader labels (by x-order).
const GOAL_COLORS = ['#af7ac5', '#7d3c98']

const maxOf = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), -Infinity)
function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`
}

// Label with a short 30° leader line linking it to its vertical marker at `x` (port
// of _leader_label in figures/retirement.py). The text floats up and to the side —
// right when the marker sits in the left 60% of the axis, else left — so the
// connector never strikes through the text. Pixel offsets keep the 30° angle.
function leaderLabel(annotations: Dict[], x0: number, x1: number, x: number, yPaper: number, text: string, color: string) {
  const frac = x1 > x0 ? (x - x0) / (x1 - x0) : 0
  const toRight = frac <= 0.6
  const dx = toRight ? 34 : -34
  annotations.push({
    x, xref: 'x', yref: 'paper', y: yPaper,
    ax: dx, ay: -Math.abs(dx) * 0.5774, axref: 'pixel', ayref: 'pixel',
    text, showarrow: true, arrowhead: 0, arrowwidth: 1.2, arrowcolor: color,
    xanchor: toRight ? 'left' : 'right', yanchor: 'bottom',
    font: { color, size: 12 },
  })
}

export interface RetLabels {
  age: string
  value: (currency: string) => string
  yo: string // age suffix ("yo" / " ปี")
  future: string
  today: string
  withoutGoals: string
  balanceFuture: string
  balanceToday: string
  afterFactor: string
  afterPlain: string
  factorToday: string
  retire: string
  freedom: string
  depleted: string
  bought: (name: string, age: string) => string
  medianSuffix: string // " (median)" appended to line names in MC mode
  success: (pct: string) => string
}

// ── Monte Carlo variant ──────────────────────────────────────────────────────
// Median (p50) lines with a 16–84% band on the primary series, plus vertical
// event bands (16–84% age spread + median) for depletion / financial-freedom /
// goal purchases, and a success-probability note. Port of the mc branch of
// build_retirement_figure.
export function buildRetirementMcFigure(
  mc: McResult,
  opts: { currency: string; showReal: boolean; hasGoals: boolean; retirementAge: number; lifeExpectancy: number; ui: RetUi; labels: RetLabels },
) {
  const { currency, showReal, hasGoals, retirementAge, lifeExpectancy, ui, labels } = opts
  const ages = mc.ages
  const x0 = ages[0]
  const x1 = ages[ages.length - 1]
  const suffix = labels.yo
  const data: Dict[] = []
  const shapes: Dict[] = []
  const annotations: Dict[] = []

  // Shaded retirement span (retirement age → life expectancy).
  if (lifeExpectancy > retirementAge) {
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: retirementAge, x1: lifeExpectancy, y0: 0, y1: 1, line: { width: 0 }, fillcolor: 'rgba(52,152,219,0.10)', layer: 'below' })
  }

  const line = (y: number[], name: string, color: string, width = 2.5, dash?: string, hover?: string) =>
    data.push({ x: ages, y, mode: 'lines', name, line: { color, width, dash }, hovertemplate: `${labels.age} %{x:.1f}<br>%{y:,.0f} ${currency}<extra>${hover ?? name}</extra>` })

  // 16–84% band = two invisible edges joined by a tonexty fill.
  const addBand = (lo: number[], hi: number[], fill: string) => {
    data.push({ x: ages, y: hi, mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false })
    data.push({ x: ages, y: lo, mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: fill, hoverinfo: 'skip', showlegend: false })
  }

  const prim = hasGoals ? mc.factorNominal! : mc.nominal
  addBand(prim.p16, prim.p84, rgba(INCOME_COLOR, 0.18))
  if (hasGoals) {
    line(mc.nominal.p50, labels.withoutGoals, ui.muted, 1.5, 'dot', labels.withoutGoals)
    line(mc.plainNominal!.p50, labels.afterPlain, PLAIN_COLOR, 2.5, undefined, labels.today)
    line(mc.factorNominal!.p50, labels.afterFactor, INCOME_COLOR, 2.5, undefined, labels.future)
    if (showReal) line(mc.factorReal!.p50, labels.factorToday, SAVING_COLOR, 2, 'dash', labels.today)
  } else {
    line(mc.nominal.p50, labels.balanceFuture, INCOME_COLOR, 2.5, undefined, labels.future)
    if (showReal) line(mc.real.p50, labels.balanceToday, SAVING_COLOR, 2, 'dash', labels.today)
  }

  const vline = (x: number, color: string, dash: string, width = 1.5) =>
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color, dash, width } })

  // Retirement age marker.
  vline(retirementAge, ui.muted, 'dot')
  annotations.push({ x: retirementAge, xref: 'x', yref: 'paper', y: 0.02, yanchor: 'bottom', xanchor: 'center', showarrow: false, text: labels.retire, font: { color: ui.muted, size: 12 } })

  // Vertical event band: 16–84% age spread + dashed median + leader label. Censored
  // median (past life expectancy) shows a right-edge "life+" label instead.
  const eventBand = (ev: DepEvent | Event | null, color: string, yPaper: number, label: string) => {
    if (!ev || ev.p16 == null) return
    const p16 = ev.p16
    const p50 = ev.p50
    const p84 = ev.p84 ?? x1
    if (p84 > p16) shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: p16, x1: p84, y0: 0, y1: 1, line: { width: 0 }, fillcolor: rgba(color, 0.12), layer: 'below' })
    if (p50 == null) {
      annotations.push({ x: x1, xref: 'x', yref: 'paper', y: yPaper, yanchor: 'top', xanchor: 'right', xshift: -4, showarrow: false, text: `${label}: ${x1.toFixed(0)}+${suffix}`, font: { color, size: 12 } })
      return
    }
    vline(p50, color, 'dash')
    leaderLabel(annotations, x0, x1, p50, yPaper, `${label}: ${p50.toFixed(0)}${suffix}`, color)
  }

  eventBand(mc.depletion, EXPENSE_COLOR, 0.92, labels.depleted)
  eventBand(mc.freedom, FREEDOM_COLOR, 0.84, labels.freedom)
  const goalEvs = (mc.goalEvents ?? []).filter((e) => e.prob > 0)
  goalEvs.forEach((e, i) => eventBand(e as unknown as Event, GOAL_COLORS[i % 2], 0.76 - (i % 3) * 0.06, e.name))

  const yTop = maxOf(prim.p84) * 1.08 || 1

  return {
    data,
    layout: {
      height: 400,
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: { title: labels.age, range: [x0, x1], gridcolor: ui.grid, color: ui.muted },
      yaxis: { title: labels.value(currency), range: [0, yTop], fixedrange: true, gridcolor: ui.grid, color: ui.muted },
      hovermode: 'x unified',
      hoverlabel: { bgcolor: ui.anno, bordercolor: ui.grid, font: { color: ui.ink } },
      dragmode: 'pan',
      legend: { orientation: 'h', entrywidthmode: 'fraction', entrywidth: 0.5, yanchor: 'bottom', y: 1.02, font: { color: ui.muted, size: 11 } },
      margin: { t: 64, b: 44, l: 48, r: 10 },
      shapes,
      annotations,
    } as Dict,
  }
}

export function buildRetirementFigure(
  res: Retirement,
  opts: { currency: string; showReal: boolean; ui: RetUi; labels: RetLabels },
) {
  const { currency, showReal, ui, labels } = opts
  const ages = res.ages
  const x0 = ages[0]
  const x1 = ages[ages.length - 1]
  const retAge = res.retirementAge
  const life = res.lifeExpectancy
  const hasGoals = res.hasGoals
  const suffix = labels.yo
  const data: Dict[] = []
  const shapes: Dict[] = []
  const annotations: Dict[] = []

  const line = (y: number[], name: string, color: string, width = 2.5, dash?: string, hover?: string) =>
    data.push({
      x: ages, y, mode: 'lines', name,
      line: { color, width, dash },
      hovertemplate: `${labels.age} %{x:.1f}<br>%{y:,.0f} ${currency}<extra>${hover ?? name}</extra>`,
    })

  const markers = (series: number[], hits: Retirement['goalHitsFactor'], symbol: string, color: string) => {
    if (!hits || !hits.length) return
    data.push({
      x: hits.map((h) => h.age), y: hits.map((h) => series[h.month]),
      mode: 'markers', showlegend: false, hoverinfo: 'text',
      hovertext: hits.map((h) => labels.bought(h.name, h.age.toFixed(1))),
      marker: { size: 11, symbol, color, line: { color: '#fff', width: 1.5 } },
    })
  }

  // Shaded retirement span (retirement age → life expectancy).
  if (life > retAge) {
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: retAge, x1: life, y0: 0, y1: 1, line: { width: 0 }, fillcolor: 'rgba(52,152,219,0.10)', layer: 'below' })
  }

  const drawn: number[][] = []
  let depletionAge: number | null
  let lateDep: number | null
  if (hasGoals) {
    const fNom = res.balanceFactorNominal!
    const pNom = res.balancePlainNominal!
    line(res.balanceNominal, labels.withoutGoals, ui.muted, 1.5, 'dot', labels.withoutGoals)
    line(pNom, labels.afterPlain, PLAIN_COLOR, 2.5, undefined, labels.today)
    line(fNom, labels.afterFactor, INCOME_COLOR, 2.5, undefined, labels.future)
    if (showReal) line(res.balanceFactorReal!, labels.factorToday, SAVING_COLOR, 2, 'dash', labels.today)
    markers(fNom, res.goalHitsFactor, 'circle', INCOME_COLOR)
    markers(pNom, res.goalHitsPlain, 'diamond', PLAIN_COLOR)
    drawn.push(fNom, pNom, res.balanceNominal)
    if (showReal) drawn.push(res.balanceFactorReal!)
    depletionAge = res.summaryFactor!.depletionAge
    lateDep = res.summaryFactor!.lateDepletionAge
  } else {
    line(res.balanceNominal, labels.balanceFuture, INCOME_COLOR)
    drawn.push(res.balanceNominal)
    if (showReal) {
      line(res.balanceReal, labels.balanceToday, SAVING_COLOR, 2, 'dash', labels.today)
      drawn.push(res.balanceReal)
    }
    depletionAge = res.depletionAge
    lateDep = res.lateDepletionAge
  }

  const vline = (x: number, color: string, dash: string, width = 1.5) =>
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color, dash, width } })

  // Retirement age marker.
  vline(retAge, ui.muted, 'dot')
  annotations.push({ x: retAge, xref: 'x', yref: 'paper', y: 0.02, yanchor: 'bottom', xanchor: 'center', showarrow: false, text: labels.retire, font: { color: ui.muted, size: 12 } })

  // Funds-running-out marker (red line within life expectancy; else a right-edge note).
  if (depletionAge != null) {
    vline(depletionAge, EXPENSE_COLOR, 'dot')
    leaderLabel(annotations, x0, x1, depletionAge, 0.92, `${labels.depleted}: ${depletionAge.toFixed(0)}${suffix}`, EXPENSE_COLOR)
  } else {
    const txt = lateDep != null ? `${labels.depleted}: ${lateDep.toFixed(0)}${suffix} →` : `${labels.depleted}: 100+${suffix} →`
    annotations.push({ xref: 'paper', x: 0.995, xanchor: 'right', yref: 'paper', y: 0.92, yanchor: 'top', showarrow: false, text: txt, font: { color: ui.muted, size: 12 } })
  }

  // Financial-freedom (FIRE) marker.
  if (res.financialFreedomAge != null) {
    vline(res.financialFreedomAge, FREEDOM_COLOR, 'dash')
    leaderLabel(annotations, x0, x1, res.financialFreedomAge, 0.84, `${labels.freedom}: ${res.financialFreedomAge.toFixed(0)}${suffix}`, FREEDOM_COLOR)
  }

  // Goal-purchase guide lines (×factor buy age) with alternating purple shades and a
  // leader-labelled name·age; the buy markers still carry the hover detail.
  if (hasGoals) {
    ;(res.goalHitsFactor ?? []).forEach((h, i) => {
      const color = GOAL_COLORS[i % 2]
      vline(h.age, color, 'dot', 1)
      leaderLabel(annotations, x0, x1, h.age, 0.76 - (i % 3) * 0.06, `${h.name}: ${h.age.toFixed(0)}${suffix}`, color)
    })
  }

  // Y-axis: cap to the "without goals" baseline height at retirement when goals are
  // drawn (its post-retirement growth would otherwise flatten the trajectories).
  let yTop: number
  if (hasGoals && res.balanceAtRetirement > 0) yTop = res.balanceAtRetirement
  else yTop = maxOf(drawn.flat()) * 1.08
  if (!(yTop > 0)) yTop = 1

  return {
    data,
    layout: {
      height: 400,
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: { title: labels.age, range: [x0, x1], gridcolor: ui.grid, color: ui.muted },
      yaxis: { title: labels.value(currency), range: [0, yTop], fixedrange: true, gridcolor: ui.grid, color: ui.muted },
      hovermode: 'x unified',
      hoverlabel: { bgcolor: ui.anno, bordercolor: ui.grid, font: { color: ui.ink } },
      dragmode: 'pan',
      legend: { orientation: 'h', entrywidthmode: 'fraction', entrywidth: 0.5, yanchor: 'bottom', y: 1.02, font: { color: ui.muted, size: 11 } },
      margin: { t: 64, b: 44, l: 48, r: 10 },
      shapes,
      annotations,
    } as Dict,
  }
}
