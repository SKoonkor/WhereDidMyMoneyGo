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
const GOAL_COLOR = '#8e44ad'
const GOAL_COLORS = [GOAL_COLOR, '#5b2c6f']

const maxOf = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), -Infinity)
function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`
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
  const med = labels.medianSuffix
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
    line(mc.nominal.p50, labels.withoutGoals + med, ui.muted, 1.5, 'dot', labels.withoutGoals)
    line(mc.factorNominal!.p50, labels.afterFactor + med, INCOME_COLOR, 2.5, undefined, labels.future)
    line(mc.plainNominal!.p50, labels.afterPlain + med, PLAIN_COLOR, 2.5, undefined, labels.today)
    if (showReal) line(mc.factorReal!.p50, labels.factorToday + med, SAVING_COLOR, 2, 'dash', labels.today)
  } else {
    line(mc.nominal.p50, labels.balanceFuture + med, INCOME_COLOR, 2.5, undefined, labels.future)
    if (showReal) line(mc.real.p50, labels.balanceToday + med, SAVING_COLOR, 2, 'dash', labels.today)
  }

  const vline = (x: number, color: string, dash: string, width = 1.5) =>
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color, dash, width } })
  const sideLabel = (x: number, yPaper: number, text: string, color: string) => {
    const frac = x1 > x0 ? (x - x0) / (x1 - x0) : 0
    const [xanchor, xshift] = frac > 0.6 ? ['right', -4] : ['left', 4]
    annotations.push({ x, xref: 'x', yref: 'paper', y: yPaper, yanchor: 'top', xanchor, xshift, showarrow: false, text, font: { color, size: 12 } })
  }

  // Retirement age marker.
  vline(retirementAge, ui.muted, 'dot')
  annotations.push({ x: retirementAge, xref: 'x', yref: 'paper', y: 1.0, yanchor: 'bottom', showarrow: false, text: `${labels.retire}: ${fmtAge(retirementAge)}${suffix}`, font: { color: ui.ink, size: 12 } })

  // Vertical event band: 16–84% age spread + dashed median + label. Censored median
  // (past life expectancy) shows a right-edge "life+" label instead.
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
    sideLabel(p50, yPaper, `${label}: ${p50.toFixed(0)}${suffix}`, color)
  }

  eventBand(mc.depletion, EXPENSE_COLOR, 0.92, labels.depleted)
  eventBand(mc.freedom, FREEDOM_COLOR, 0.84, labels.freedom)
  const goalEvs = (mc.goalEvents ?? []).filter((e) => e.prob > 0)
  goalEvs.forEach((e, i) => eventBand(e as unknown as Event, GOAL_COLORS[i % 2], 0.76 - (i % 3) * 0.06, e.name))

  // Success-probability note (fraction of paths whose money lasts to life expectancy).
  annotations.push({ xref: 'paper', x: 0.02, xanchor: 'left', yref: 'paper', y: 0.98, yanchor: 'top', showarrow: false, text: labels.success((mc.successProb * 100).toFixed(0)), font: { color: ui.ink, size: 13 } })

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
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, font: { color: ui.muted, size: 11 } },
      margin: { t: 64, b: 44, l: 64, r: 20 },
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
    line(fNom, labels.afterFactor, INCOME_COLOR, 2.5, undefined, labels.future)
    line(pNom, labels.afterPlain, PLAIN_COLOR, 2.5, undefined, labels.today)
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
  // Label anchored to the left/right of a vertical line depending on where it sits.
  const sideLabel = (x: number, yPaper: number, text: string, color: string) => {
    const frac = x1 > x0 ? (x - x0) / (x1 - x0) : 0
    const [xanchor, xshift] = frac > 0.6 ? ['right', -4] : ['left', 4]
    annotations.push({ x, xref: 'x', yref: 'paper', y: yPaper, yanchor: 'top', xanchor, xshift, showarrow: false, text, font: { color, size: 12 } })
  }

  // Retirement age marker.
  vline(retAge, ui.muted, 'dot')
  annotations.push({ x: retAge, xref: 'x', yref: 'paper', y: 1.0, yanchor: 'bottom', showarrow: false, text: `${labels.retire}: ${fmtAge(retAge)}${suffix}`, font: { color: ui.ink, size: 12 } })

  // Funds-running-out marker (red line within life expectancy; else a right-edge note).
  if (depletionAge != null) {
    vline(depletionAge, EXPENSE_COLOR, 'dot')
    sideLabel(depletionAge, 0.92, `${labels.depleted}: ${depletionAge.toFixed(0)}${suffix}`, EXPENSE_COLOR)
  } else {
    const txt = lateDep != null ? `${labels.depleted}: ${lateDep.toFixed(0)}${suffix} →` : `${labels.depleted}: 100+${suffix} →`
    annotations.push({ xref: 'paper', x: 0.995, xanchor: 'right', yref: 'paper', y: 0.92, yanchor: 'top', showarrow: false, text: txt, font: { color: ui.muted, size: 12 } })
  }

  // Financial-freedom (FIRE) marker.
  if (res.financialFreedomAge != null) {
    vline(res.financialFreedomAge, FREEDOM_COLOR, 'dash')
    sideLabel(res.financialFreedomAge, 0.84, `${labels.freedom}: ${res.financialFreedomAge.toFixed(0)}${suffix}`, FREEDOM_COLOR)
  }

  // Goal-purchase guide lines (×factor buy age) — the buy markers carry the detail.
  if (hasGoals) {
    for (const h of res.goalHitsFactor ?? []) vline(h.age, GOAL_COLOR, 'dot', 1)
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
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, font: { color: ui.muted, size: 11 } },
      margin: { t: 64, b: 44, l: 64, r: 20 },
      shapes,
      annotations,
    } as Dict,
  }
}

const fmtAge = (a: number) => (Number.isInteger(a) ? String(a) : a.toFixed(1))
