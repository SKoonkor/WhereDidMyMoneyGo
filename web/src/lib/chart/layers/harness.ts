// A RenderCtx built by hand, over the recording fake context.
//
// Test-only, but it lives here rather than in a .test.ts because every layer's
// tests need it. It is also the proof that the RenderCtx seam works: the layers
// are exercised in full without renderer.ts existing at all, which is exactly
// why the seam was drawn where it was.
//
// Nothing here imports vitest, so it stays a plain module the purity guard can
// read like any other source file.

import { createFakeCtx, type FakeCtx } from '../testing/fakeCtx'
import { makeScales } from '../scale'
import type { ChartTheme, InteractionState, OhlcvColumns, Rect, RenderCtx, Viewport } from '../types'

export interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** Columnar series laid out like the real ring buffer: logical 0 is the oldest
 *  bar held, and `at` is exercised rather than bypassed. */
export function series(bars: Bar[]): OhlcvColumns {
  const f = (k: keyof Bar) => Float64Array.from(bars.map((b) => b[k]))
  return {
    length: bars.length,
    t: f('t'),
    o: f('o'),
    h: f('h'),
    l: f('l'),
    c: f('c'),
    v: f('v'),
    at: (i) => i,
    rev: 1,
  }
}

/**
 * A deterministic zig-zag series — enough shape for wicks, direction changes and
 * a plausible volume profile, with no randomness anywhere.
 *
 * `t0` anchors the first bar. It defaults to the epoch, which is fine for any
 * test that only cares about geometry — but a test that cares about CALENDAR
 * behaviour must pass a real local instant. `timeTicks` resolves day boundaries
 * in local time (correctly: they are for display), so an epoch-anchored window
 * puts its day boundaries in different places in every timezone, and an
 * assertion about them passes in UTC+7 and fails in CI's UTC.
 */
export function sawSeries(n: number, start = 43000, step = 60_000, t0 = 0): OhlcvColumns {
  const bars: Bar[] = []
  let p = start
  for (let i = 0; i < n; i++) {
    const dir = Math.sin(i / 7) + Math.sin(i / 3) / 2
    const o = p
    const c = p + dir * 40
    const h = Math.max(o, c) + 12 + (i % 5)
    const l = Math.min(o, c) - 12 - (i % 3)
    bars.push({ t: t0 + i * step, o, h, l, c, v: 1000 + (i % 11) * 130 })
    p = c
  }
  return series(bars)
}

export const testTheme: ChartTheme = {
  bg: '#14181f',
  grid: 'rgba(230,238,248,0.06)',
  gridMajor: 'rgba(230,238,248,0.04)',
  up: '#1abc9c',
  down: '#e8556d',
  upFill: '#1abc9c',
  downFill: '#e8556d',
  neutral: '#8b97a8',
  ink: '#e6eef8',
  muted: '#8b97a8',
  axisBg: '#161b22',
  axisBorder: 'rgba(230,238,248,0.10)',
  crosshair: '#c6d2e0',
  pillBg: '#222b36',
  pillInk: '#e6eef8',
  // Translucent, exactly like the real theme (theme.ts resolves these to the
  // up/down hue at 26%). The fixture used to reuse the solid colours, which made
  // `volumeUp` and `up` indistinguishable in a test — and that is precisely why a
  // layer filling with the translucent token under a globalAlpha shipped three
  // times without a single assertion failing.
  volumeUp: 'rgba(26,188,156,0.26)',
  volumeDown: 'rgba(232,85,109,0.26)',
  accent: '#2f81f7',
  font: 'system-ui, sans-serif',
  fontMono: 'ui-monospace, monospace',
  axisFontPx: 10,
  labelFontPx: 12,
  legendFontPx: 10,
  censor: false,
  reducedMotion: false,
}

export interface HarnessOptions {
  data?: OhlcvColumns
  span?: number
  i0?: number
  dpr?: number
  /** Plot size in CSS px, excluding the axes. */
  w?: number
  h?: number
  priceAxisW?: number
  timeAxisH?: number
  /** Height of volume's own pane, below `plot`. 0 disables it, which is the
   *  `volumePane: null` case the volume layer must draw nothing for. */
  volumeH?: number
  theme?: Partial<ChartTheme>
  interaction?: Partial<InteractionState>
  dt?: number
  now?: number
  /** Overrides the auto-fitted price band. */
  p0?: number
  p1?: number
}

export interface Harness {
  c: RenderCtx
  fake: FakeCtx
  plot: Rect
  viewport: Viewport
}

/**
 * Build a frame. Defaults are a 340x420 plot on a 390px phone at dpr 2 — the
 * screen the visual bar is actually written against.
 */
export function harness(o: HarnessOptions = {}): Harness {
  const fake = createFakeCtx()
  const data = o.data ?? sawSeries(120)
  const dpr = o.dpr ?? 2
  const paW = o.priceAxisW ?? 62
  const taH = o.timeAxisH ?? 26
  const w = o.w ?? 340
  const h = o.h ?? 420

  // `plot` is the PRICE pane; volume has its own below it, and the time axis
  // sits under both. `plot` simply got shorter, which is what keeps every price
  // layer correct without changes.
  const volH = o.volumeH ?? 90
  const plot: Rect = { x: 0, y: 0, w, h }
  const volumePane: Rect | null = volH > 0 ? { x: 0, y: h, w, h: volH } : null
  const priceAxis: Rect = { x: w, y: 0, w: paW, h: h + volH }
  const timeAxis: Rect = { x: 0, y: h + volH, w: w + paW, h: taH }

  const span = o.span ?? Math.min(120, Math.max(2, data.length))
  const i0 = o.i0 ?? Math.max(0, data.length - span)

  let lo = Infinity
  let hi = -Infinity
  for (let i = Math.max(0, Math.floor(i0)); i <= Math.min(data.length - 1, Math.ceil(i0 + span - 1)); i++) {
    const k = data.at(i)
    if (data.l[k] < lo) lo = data.l[k]
    if (data.h[k] > hi) hi = data.h[k]
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  const padded = (hi - lo) * 0.08
  const viewport: Viewport = {
    i0,
    span,
    p0: o.p0 ?? lo - padded,
    p1: o.p1 ?? hi + padded,
  }

  const theme: ChartTheme = { ...testTheme, ...o.theme }
  const interaction: InteractionState = {
    crosshair: null,
    pressed: false,
    overscrollX: 0,
    ...o.interaction,
  }

  const c: RenderCtx = {
    ctx: fake.ctx,
    plot,
    volumePane,
    priceAxis,
    timeAxis,
    scales: makeScales(viewport, plot, dpr),
    data,
    i0: Math.max(0, Math.ceil(i0)),
    i1: Math.min(data.length - 1, Math.floor(i0 + span - 1)),
    dpr,
    theme,
    dt: o.dt ?? 16,
    now: o.now ?? (data.length ? data.t[data.at(data.length - 1)] + 30_000 : 0),
    interaction,
    snap: (v: number) => Math.round(v * dpr) / dpr,
  }

  return { c, fake, plot, viewport }
}

/** Every string this frame painted. */
export function texts(fake: FakeCtx): string[] {
  return fake.of('fillText').map((t) => t.text)
}

export interface PaintedText {
  text: string
  x: number
  y: number
  fill: string
  font: string
}

/**
 * Painted strings with the fill and font that were in force at the time.
 *
 * The ops log is a flat stream, so "what colour was this label?" means replaying
 * the state assignments up to it — which is the only way to assert the time
 * axis's --ink / --muted hierarchy, the rule that carries most of its legibility.
 */
export function paintedText(fake: FakeCtx): PaintedText[] {
  const out: PaintedText[] = []
  let fill = ''
  let font = ''
  for (const op of fake.ops) {
    if (op.op === 'set' && op.prop === 'fillStyle') fill = String(op.value)
    else if (op.op === 'set' && op.prop === 'font') font = String(op.value)
    else if (op.op === 'fillText') out.push({ text: op.text, x: op.x, y: op.y, fill, font })
  }
  return out
}
