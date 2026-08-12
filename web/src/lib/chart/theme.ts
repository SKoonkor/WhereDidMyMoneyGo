// Every colour, font and size the canvas needs, resolved ONCE from the app's CSS
// custom properties.
//
// Once is the whole point. `getComputedStyle` forces a style resolution, and a
// layer calling it per frame is the single easiest way to lose 60fps — so the
// tokens are read here, at mount and on a theme change, and handed to the
// renderer as plain strings it can assign straight to `fillStyle`.
//
// The palette is the app's own (`src/theme.css`), never a chart-specific one.
// §E is explicit about that: inventing a palette would break the app's identity,
// and a critic notices an inconsistent green faster than a slightly-off one.

import type { ChartTheme } from './types'

/**
 * The app's body stack, copied verbatim from theme.css:49.
 *
 * 'Noto Sans Thai' MUST be in it. Canvas has no font fallback chain of its own
 * beyond what this string says, so a Thai label rendered without it comes out
 * through a metrics-wrong fallback — wrong advance widths, clipped tone marks,
 * and a measureText that disagrees with what was drawn.
 */
export const CHART_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Noto Sans Thai', sans-serif"

/**
 * Tabular digits, for EVERY number the chart draws.
 *
 * Canvas ignores `font-variant-numeric`, so there is no way to ask a
 * proportional font for tabular figures here. A live price readout in a
 * proportional font jitters sideways as its digits change width — it is the
 * fastest way to tell a real trading app from a hobby one, and it is free to
 * avoid.
 */
export const CHART_FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** theme.css's dark palette. Used when a token is missing — a chart with no
 *  colours at all is a far worse failure than a chart in the wrong ones. */
const FALLBACK = {
  bg: '#14181f',
  surface2: '#313d4e',
  ink: '#e8eaed',
  muted: '#9aa3ad',
  borderSoft: '#3a4250',
  accent: '#1abc9c',
  income: '#2ecc71',
  expense: '#e74c3c',
} as const

/** Parsed to [r, g, b] in 0..255, or null if this is a form we cannot read. */
export function parseColor(css: string): [number, number, number] | null {
  const s = css.trim()
  if (!s) return null

  if (s.charCodeAt(0) === 35) {
    const hex = s.slice(1)
    // #rgb and #rgba shorthand: each digit doubles.
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      return Number.isNaN(r + g + b) ? null : [r, g, b]
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      return Number.isNaN(r + g + b) ? null : [r, g, b]
    }
    return null
  }

  // rgb()/rgba(), space- or comma-separated, with or without a slash alpha.
  const m = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const n = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)))
    if (n.some((v) => Number.isNaN(v))) return null
    return [n[0], n[1], n[2]]
  }
  return null
}

/**
 * The same colour at a given alpha.
 *
 * Returns the input unchanged when it cannot be parsed, rather than throwing: an
 * unrecognised token should cost the chart one wrong alpha, not the whole frame.
 */
export function withAlpha(css: string, a: number): string {
  const rgb = parseColor(css)
  if (!rgb) return css
  const clamped = Math.max(0, Math.min(1, a))
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${clamped})`
}

/** Perceptual luminance, 0..1 — the sRGB relative luminance from WCAG. */
export function relativeLuminance(css: string): number {
  const rgb = parseColor(css)
  if (!rgb) return 0
  const lin = rgb.map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/** WCAG contrast ratio between two luminances. */
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** §E bans pure white and pure black. These are the two ends it does allow. */
const PILL_LIGHT = '#ffffff'
const PILL_DARK = '#0a0e14'

/**
 * Text colour for a filled pill, chosen by measured contrast against the fill.
 *
 * §E asks for this on the last-price pill: the pill is tinted up/down, and
 * hard-coding white ink makes it unreadable on the lighter of the two.
 *
 * Whichever candidate actually has more contrast wins, rather than a luminance
 * threshold — a threshold has to be guessed, and guessing puts the crossover in
 * the wrong place. The app's own `--income` green is the case that proves it:
 * its luminance is 0.45, which "looks dark" by eye and by any threshold picked
 * near the middle, but white on it scores 2.1:1 against dark ink's 9.2:1. Both
 * of the app's up/down colours are in fact light enough to want dark ink.
 */
export function readableInk(bg: string): string {
  const l = relativeLuminance(bg)
  return contrast(l, relativeLuminance(PILL_DARK)) >= contrast(l, relativeLuminance(PILL_LIGHT))
    ? PILL_DARK
    : PILL_LIGHT
}

/**
 * Read the app's tokens off `el` and build the chart's palette.
 *
 * `censor` and `reducedMotion` are passed in rather than sniffed here: both are
 * app state (the privacy toggle, the media query React already subscribes to),
 * and reading them from two places is how they end up disagreeing.
 */
export function themeFromCss(el: Element, censor: boolean, reducedMotion: boolean): ChartTheme {
  // The one getComputedStyle call in the entire chart.
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
  const read = (name: string, fallback: string): string => {
    const v = cs?.getPropertyValue(name).trim()
    return v || fallback
  }

  const bg = read('--bg', FALLBACK.bg)
  const ink = read('--ink', FALLBACK.ink)
  const muted = read('--muted', FALLBACK.muted)
  const surface2 = read('--surface-2', FALLBACK.surface2)
  const borderSoft = read('--border-soft', FALLBACK.borderSoft)
  const accent = read('--accent', FALLBACK.accent)
  const up = read('--income', FALLBACK.income)
  const down = read('--expense', FALLBACK.expense)

  // Which way round the theme is, derived from the background rather than from
  // `data-theme`. The attribute is absent when the user is on "system", and a
  // grid tuned for dark on a light background looks like a spreadsheet.
  const light = relativeLuminance(bg) > 0.5

  return {
    bg,
    // §E: 1 device px at 6% ink in dark, 8% in light. Anything stronger reads as
    // a spreadsheet rather than a chart.
    grid: withAlpha(ink, light ? 0.08 : 0.06),
    // Deliberately WEAKER than `grid`, not stronger, despite the name. §E only
    // draws vertical rules at major time boundaries and puts them at 4%, so this
    // is the vertical-at-a-day-boundary colour. The horizontal grid stays the
    // dominant one; verticals that compete with it turn the plot into graph
    // paper. Layers: use `grid` for horizontals, `gridMajor` for the verticals.
    gridMajor: withAlpha(ink, light ? 0.055 : 0.04),
    up,
    down,
    // §E: fills at 88% so a solid body sits fractionally back from its own wick
    // and the wick stays legible where it meets the body.
    upFill: withAlpha(up, 0.88),
    downFill: withAlpha(down, 0.88),
    neutral: muted,
    ink,
    muted,
    // --chart-axis-bg and --chart-grid are the two tokens §E reserves for
    // theme.css. They are read if present and fall back to the plain background,
    // so this module works before whoever owns theme.css adds them.
    axisBg: read('--chart-axis-bg', bg),
    axisBorder: borderSoft,
    // Carries its own 35% alpha (§E). Layers must NOT set globalAlpha on top of
    // it — doing so squares the transparency and the crosshair disappears.
    crosshair: withAlpha(ink, 0.35),
    pillBg: surface2,
    pillInk: ink,
    // §E: volume at 26% of the candle colour, drawn under the candles.
    volumeUp: withAlpha(up, 0.26),
    volumeDown: withAlpha(down, 0.26),
    accent,
    font: CHART_FONT,
    fontMono: CHART_FONT_MONO,
    // §E pins these: axis 10px, crosshair readout 12px, legend labels 10px.
    // Never below 10 on a 2x screen and never above 13 in an axis.
    axisFontPx: 10,
    labelFontPx: 12,
    legendFontPx: 10,
    censor,
    reducedMotion,
  }
}

/**
 * The colour-blind alternative §E asks for: blue/orange instead of green/red.
 *
 * Applied on top of a theme rather than built into `themeFromCss`, so it stays a
 * single user setting rather than a second palette to keep in step.
 */
export function withColorBlindPair(t: ChartTheme): ChartTheme {
  const up = '#2f81f7'
  const down = '#f0883e'
  return {
    ...t,
    up,
    down,
    upFill: withAlpha(up, 0.88),
    downFill: withAlpha(down, 0.88),
    volumeUp: withAlpha(up, 0.26),
    volumeDown: withAlpha(down, 0.26),
  }
}
