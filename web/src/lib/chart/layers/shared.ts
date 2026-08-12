// The pieces every layer needs, in one place so they can only be got right or
// wrong once.
//
// Three of these carry most of the visual quality bar:
//
//  * `hLine`/`vLine`/`snapRect` — a rect is drawn as a FILL of an integral
//    number of device pixels, never as a 1px stroke. A stroke centred on a
//    half-pixel spreads over two rows at 50% each, and that grey blur is the
//    single most reliable way to spot a hobby chart in a screenshot.
//  * `LabelCache` — measureText costs about as much as fillText, so widths are
//    measured once per label-SET change and never per frame.
//  * `lastCloseOf` — the price axis and the last-price pill must agree on where
//    the pill sits, to the pixel, or the axis will suppress the wrong grid
//    label. They agree by deriving it from the same place rather than by
//    passing a value between two layers that draw at different z.
//
// No layer may call getComputedStyle (it forces a style resolution, per frame,
// on the render path) — every colour arrives on `c.theme`.

import type { RenderCtx, TimeTick } from '../types'
import { priceTicks, timeTicks } from '../scale'

/** Near-black and near-white for pill ink. Deliberately not #000/#fff: pure
 *  black on a saturated green vibrates, and §E bans both outright. */
export const INK_DARK = '#0a0e14'
export const INK_LIGHT = '#f7fafc'

/** One device pixel, expressed in the CSS units the layers draw in. */
export const px1 = (c: RenderCtx) => 1 / c.dpr

/** Snap a length so it covers a whole number of device pixels, minimum one.
 *  A 0-height rect is invisible; a 0.5-height one is a grey smear. */
export function snapLen(c: RenderCtx, v: number): number {
  const dev = Math.round(v * c.dpr)
  return (dev < 1 ? 1 : dev) / c.dpr
}

/** A horizontal hairline, filled rather than stroked. */
export function hLine(c: RenderCtx, x: number, y: number, w: number): void {
  c.ctx.fillRect(c.snap(x), c.snap(y), c.snap(x + w) - c.snap(x), px1(c))
}

/** A vertical hairline, filled rather than stroked. */
export function vLine(c: RenderCtx, x: number, y: number, h: number): void {
  c.ctx.fillRect(c.snap(x), c.snap(y), px1(c), c.snap(y + h) - c.snap(y))
}

/** A rect whose four edges all land on device-pixel boundaries. */
export function snapRect(c: RenderCtx, x: number, y: number, w: number, h: number): void {
  const x0 = c.snap(x)
  const y0 = c.snap(y)
  c.ctx.fillRect(x0, y0, c.snap(x + w) - x0, c.snap(y + h) - y0)
}

/** Same, but into the current path — the candle pass batches hundreds of these
 *  between one beginPath and one fill. */
export function pathRect(c: RenderCtx, x: number, y: number, w: number, h: number): void {
  const x0 = c.snap(x)
  const y0 = c.snap(y)
  c.ctx.rect(x0, y0, c.snap(x + w) - x0, c.snap(y + h) - y0)
}

/** Rounded pill into the current path. Falls back to a plain rect where
 *  roundRect is missing, rather than throwing on an older Safari. */
export function pillPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

// ── Colour ───────────────────────────────────────────────────────────────────

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i
const RGB = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i

/**
 * Relative luminance, 0..1, from whatever CSS colour the theme resolved to.
 *
 * Used to choose pill ink. Picking ink by "is this the up colour?" breaks the
 * moment a colour-blind palette (blue/orange) is switched on — blue needs white
 * ink and orange needs dark, and neither is "up".
 */
export function luminance(css: string): number {
  let r = 0
  let g = 0
  let b = 0
  const h3 = HEX3.exec(css)
  const h6 = HEX6.exec(css)
  const rgb = RGB.exec(css)
  if (h6) {
    r = parseInt(h6[1], 16)
    g = parseInt(h6[2], 16)
    b = parseInt(h6[3], 16)
  } else if (h3) {
    r = parseInt(h3[1] + h3[1], 16)
    g = parseInt(h3[2] + h3[2], 16)
    b = parseInt(h3[3] + h3[3], 16)
  } else if (rgb) {
    r = Number(rgb[1])
    g = Number(rgb[2])
    b = Number(rgb[3])
  } else {
    return 0.5 // unknown syntax: assume mid, so ink stays legible either way
  }
  // sRGB luma. Good enough for a two-way ink decision and 20x cheaper than a
  // full linearisation, which matters nowhere but costs nothing to skip.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** White or near-black ink for text sitting on `bg`. */
export const inkOn = (bg: string) => (luminance(bg) > 0.55 ? INK_DARK : INK_LIGHT)

const DIGITS = /\d/g

/**
 * Blank every digit in a caller-supplied string.
 *
 * Labels on position lines arrive already formatted from the app, so this layer
 * cannot route them through `formatPriceForCanvas`. Masking here means a caller
 * who forgot about privacy mode still cannot paint a price onto the canvas —
 * and canvas text is invisible to `:root[data-censor] .money`, so there is no
 * second line of defence.
 */
export const maskDigits = (s: string) => s.replace(DIGITS, '•')

// ── Fonts ────────────────────────────────────────────────────────────────────

/** Numbers ALWAYS use the mono stack — canvas ignores font-variant-numeric, so
 *  a proportional font makes a live price jitter as its digits change width. */
export const monoFont = (px: number, weight: number, mono: string) => `${weight} ${px}px ${mono}`
export const proseFont = (px: number, weight: number, font: string) => `${weight} ${px}px ${font}`

// ── Tick caches ──────────────────────────────────────────────────────────────

/**
 * `priceTicks` allocates a Float64Array per call and the axis, the grid and the
 * crosshair all want the same one. Handing back the SAME instance when the
 * inputs haven't moved makes reference equality a valid "did the label set
 * change?" test downstream, which is what keeps measureText off the hot path.
 */
export class PriceTickCache {
  // Typed to whatever `priceTicks` hands back: TS 6 parameterises typed arrays
  // by buffer kind, so a bare `new Float64Array(0)` narrows to ArrayBuffer and
  // then refuses the ArrayBufferLike the frozen scale.ts returns.
  private ticks: Float64Array<ArrayBufferLike> = new Float64Array(0)
  private a = NaN
  private b = NaN
  private h = NaN
  private gap = NaN
  private ts = NaN
  private max = 0

  get(p0: number, p1: number, h: number, minGapPx: number, tickSize: number, max: number): Float64Array {
    if (p0 === this.a && p1 === this.b && h === this.h && minGapPx === this.gap && tickSize === this.ts && max === this.max) {
      return this.ticks
    }
    this.a = p0
    this.b = p1
    this.h = h
    this.gap = minGapPx
    this.ts = tickSize
    this.max = max
    this.ticks = priceTicks(p0, p1, h, minGapPx, tickSize, max)
    return this.ticks
  }
}

/** Same idea for the time ladder, which allocates one object per tick. */
export class TimeTickCache {
  private ticks: TimeTick[] = []
  private a = NaN
  private b = NaN
  private w = NaN
  private gap = NaN

  get(t0: number, t1: number, w: number, minGapPx: number): TimeTick[] {
    if (t0 === this.a && t1 === this.b && w === this.w && minGapPx === this.gap) return this.ticks
    this.a = t0
    this.b = t1
    this.w = w
    this.gap = minGapPx
    this.ticks = timeTicks(t0, t1, w, minGapPx)
    return this.ticks
  }
}

/**
 * Formatted label strings keyed by tick value, plus their measured widths.
 *
 * Re-measures only when the tick set or the censor flag changes. `measureText`
 * costs about the same as `fillText`, so measuring 7 labels every frame would
 * double the axis's text budget for no benefit at all.
 */
export class LabelCache {
  private readonly text = new Map<number, string>()
  private readonly width = new Map<number, number>()
  private key: unknown = null
  private censored = false
  /** Widest label in the current set, in CSS px. Drives the axis width. */
  maxWidth = 0

  /** `key` is anything with stable identity for the label set — a tick array
   *  from PriceTickCache is exactly that. */
  sync(
    key: unknown,
    censor: boolean,
    values: ArrayLike<number>,
    n: number,
    fmt: (v: number) => string,
    ctx: CanvasRenderingContext2D,
  ): void {
    if (key === this.key && censor === this.censored) return
    this.key = key
    this.censored = censor
    this.text.clear()
    this.width.clear()
    this.maxWidth = 0
    for (let i = 0; i < n; i++) {
      const v = values[i]
      const s = fmt(v)
      const w = ctx.measureText(s).width
      this.text.set(v, s)
      this.width.set(v, w)
      if (w > this.maxWidth) this.maxWidth = w
    }
  }

  label(v: number): string {
    return this.text.get(v) ?? ''
  }

  widthOf(v: number): number {
    return this.width.get(v) ?? 0
  }
}

// ── Series access ────────────────────────────────────────────────────────────

/** Close of the newest bar held, or NaN with no data. The price axis and the
 *  last-price layer BOTH derive the pill's y from this rather than passing it
 *  between themselves — they draw at different z, so a handed-over value would
 *  always be a frame stale and the suppression would flicker. */
export function lastCloseOf(c: RenderCtx): number {
  const d = c.data
  if (d.length === 0) return NaN
  return d.c[d.at(d.length - 1)]
}

/** Open time of the newest bar, for the bar-close countdown. */
export function lastOpenTimeOf(c: RenderCtx): number {
  const d = c.data
  if (d.length === 0) return NaN
  return d.t[d.at(d.length - 1)]
}

/**
 * Logical bar index for a sim time, fractional and allowed to run past the ends.
 *
 * Linear rather than a binary search, and that is not a shortcut: bars of a
 * fixed timeframe are evenly spaced in sim time, so the linear map is exact —
 * AND it keeps working for times inside the right-hand gap, where there is no
 * bar for a search to find. The time axis and the grid's verticals both use it,
 * which is what guarantees a gridline lands under its own label.
 */
export function indexAtTime(c: RenderCtx, t: number): number {
  const d = c.data
  const n = d.length
  if (n === 0) return NaN
  const first = d.t[d.at(0)]
  if (n === 1) return 0
  const step = (d.t[d.at(n - 1)] - first) / (n - 1)
  if (!(step > 0)) return n - 1
  return (t - first) / step
}

/** Bar duration in sim ms, or NaN with fewer than two bars. */
export function barMsOf(c: RenderCtx): number {
  const d = c.data
  if (d.length < 2) return NaN
  return (d.t[d.at(d.length - 1)] - d.t[d.at(0)]) / (d.length - 1)
}

/** Whether the given bar closed at or above its open. */
export function isUp(c: RenderCtx, i: number): boolean {
  const k = c.data.at(i)
  return c.data.c[k] >= c.data.o[k]
}
