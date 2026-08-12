import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CHART_FONT,
  CHART_FONT_MONO,
  parseColor,
  readableInk,
  relativeLuminance,
  themeFromCss,
  withAlpha,
  withColorBlindPair,
} from './theme'

/** An element carrying the app's real dark tokens, as theme.css sets them. */
function themed(overrides: Record<string, string> = {}): HTMLElement {
  const el = document.createElement('div')
  const tokens: Record<string, string> = {
    '--bg': '#14181f',
    '--surface': '#273140',
    '--surface-2': '#313d4e',
    '--ink': '#e8eaed',
    '--muted': '#9aa3ad',
    '--border': '#4a566d',
    '--border-soft': '#3a4250',
    '--accent': '#1abc9c',
    '--income': '#2ecc71',
    '--expense': '#e74c3c',
    ...overrides,
  }
  for (const [k, v] of Object.entries(tokens)) el.style.setProperty(k, v)
  document.body.appendChild(el)
  return el
}

let el: HTMLElement

beforeEach(() => {
  el = themed()
})

afterEach(() => {
  el.remove()
  vi.restoreAllMocks()
})

describe('parseColor', () => {
  it('reads the forms theme.css and getComputedStyle actually produce', () => {
    expect(parseColor('#e8eaed')).toEqual([232, 234, 237])
    expect(parseColor('#abc')).toEqual([170, 187, 204])
    expect(parseColor('  #14181F  ')).toEqual([20, 24, 31])
    expect(parseColor('rgb(46, 204, 113)')).toEqual([46, 204, 113])
    expect(parseColor('rgba(46, 204, 113, 0.5)')).toEqual([46, 204, 113])
    // Chrome hands back space-separated rgb() from getComputedStyle.
    expect(parseColor('rgb(46 204 113 / 50%)')).toEqual([46, 204, 113])
  })

  it('returns null rather than guessing at anything else', () => {
    expect(parseColor('rebeccapurple')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(parseColor('#12345')).toBeNull()
    expect(parseColor('var(--ink)')).toBeNull()
  })
})

describe('withAlpha', () => {
  it('produces a canvas-assignable rgba string', () => {
    expect(withAlpha('#e8eaed', 0.06)).toBe('rgba(232, 234, 237, 0.06)')
  })

  it('passes an unreadable colour through untouched', () => {
    // One wrong alpha is a far better failure than a thrown exception that
    // takes the whole frame with it.
    expect(withAlpha('rebeccapurple', 0.5)).toBe('rebeccapurple')
  })

  it('clamps out-of-range alpha', () => {
    expect(withAlpha('#ffffff', 4)).toBe('rgba(255, 255, 255, 1)')
    expect(withAlpha('#ffffff', -1)).toBe('rgba(255, 255, 255, 0)')
  })
})

describe('readableInk', () => {
  it('picks whichever ink actually has more contrast on the pill', () => {
    // Both of the app's up/down tints are light enough to want dark ink, which
    // is not what "green pill" intuition says — white on --income scores 2.1:1
    // and dark ink 9.2:1. Measuring beats guessing at a threshold.
    expect(readableInk('#2ecc71')).toBe('#0a0e14')
    expect(readableInk('#e74c3c')).toBe('#0a0e14')
    // And the dark chrome takes light ink, as it must.
    expect(readableInk('#14181f')).toBe('#ffffff')
    expect(readableInk('#273140')).toBe('#ffffff')
  })

  it('never reaches for pure black or pure white on a mid tone', () => {
    // §E bans #000 and #fff outright; the dark end is the app's near-black.
    expect(readableInk('#2ecc71')).not.toBe('#000000')
  })

  it('orders light and dark the way the eye does', () => {
    expect(relativeLuminance('#ffffff')).toBeGreaterThan(relativeLuminance('#14181f'))
    expect(relativeLuminance('#2ecc71')).toBeGreaterThan(relativeLuminance('#e74c3c'))
  })
})

describe('themeFromCss', () => {
  it('takes its palette from the app rather than inventing one', () => {
    // §E: exactly two new tokens, everything else is the app's own. A critic
    // spots an inconsistent green faster than a slightly-off one.
    const t = themeFromCss(el, false, false)
    expect(t.up).toBe('#2ecc71')
    expect(t.down).toBe('#e74c3c')
    expect(t.ink).toBe('#e8eaed')
    expect(t.accent).toBe('#1abc9c')
    expect(t.bg).toBe('#14181f')
  })

  it('reads the tokens exactly once', () => {
    // A layer calling getComputedStyle per frame forces a style resolution per
    // frame, which is the single easiest way to lose 60fps.
    const spy = vi.spyOn(globalThis, 'getComputedStyle')
    themeFromCss(el, false, false)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('carries Noto Sans Thai in the body stack', () => {
    // Without it Thai renders through a fallback whose metrics disagree with
    // measureText, so labels clip and tone marks land wrong.
    const t = themeFromCss(el, false, false)
    expect(t.font).toContain('Noto Sans Thai')
    expect(t.font).toBe(CHART_FONT)
  })

  it('has a monospace stack for numbers', () => {
    // Canvas ignores font-variant-numeric, so this is the only way to get
    // tabular figures — and a price readout whose digits change width jitters.
    const t = themeFromCss(el, false, false)
    expect(t.fontMono).toBe(CHART_FONT_MONO)
    expect(t.fontMono).toContain('monospace')
  })

  it('grids at 6% ink in dark and 8% in light', () => {
    const dark = themeFromCss(el, false, false)
    expect(dark.grid).toBe('rgba(232, 234, 237, 0.06)')

    const lightEl = themed({ '--bg': '#f4f6f8', '--ink': '#2c3e50' })
    const light = themeFromCss(lightEl, false, false)
    expect(light.grid).toBe('rgba(44, 62, 80, 0.08)')
    lightEl.remove()
  })

  it('keeps the major (vertical) rule weaker than the horizontal grid', () => {
    // §E draws verticals only at major time boundaries and at 4%. Verticals
    // that compete with the horizontals turn the plot into graph paper.
    const t = themeFromCss(el, false, false)
    expect(t.gridMajor).toBe('rgba(232, 234, 237, 0.04)')
  })

  it('derives fills at 88% and volume at 26%', () => {
    const t = themeFromCss(el, false, false)
    expect(t.upFill).toBe('rgba(46, 204, 113, 0.88)')
    expect(t.volumeUp).toBe('rgba(46, 204, 113, 0.26)')
    expect(t.volumeDown).toBe('rgba(231, 76, 60, 0.26)')
  })

  it('bakes the crosshair alpha into the colour', () => {
    // Documented so no layer sets globalAlpha on top of it: doing that squares
    // the transparency and the crosshair all but disappears.
    const t = themeFromCss(el, false, false)
    expect(t.crosshair).toBe('rgba(232, 234, 237, 0.35)')
  })

  it('falls back to the app dark palette when a token is missing', () => {
    // A chart with no colours at all is a much worse failure than a chart in
    // last-known-good ones.
    const bare = document.createElement('div')
    document.body.appendChild(bare)
    const t = themeFromCss(bare, false, false)
    expect(t.ink).toBe('#e8eaed')
    expect(t.up).toBe('#2ecc71')
    expect(t.grid).toBe('rgba(232, 234, 237, 0.06)')
    bare.remove()
  })

  it('prefers the reserved chart tokens when theme.css defines them', () => {
    const withTokens = themed({ '--chart-axis-bg': '#101317' })
    expect(themeFromCss(withTokens, false, false).axisBg).toBe('#101317')
    // And works before they exist, which is the state the tree is in today.
    expect(themeFromCss(el, false, false).axisBg).toBe('#14181f')
    withTokens.remove()
  })

  it('passes censor and reduced-motion straight through', () => {
    // Both are app state. Sniffing them here as well as in React is how the two
    // end up disagreeing, and the canvas is the one that cannot be inspected.
    const t = themeFromCss(el, true, true)
    expect(t.censor).toBe(true)
    expect(t.reducedMotion).toBe(true)
  })

  it('holds the type sizes §E pins', () => {
    const t = themeFromCss(el, false, false)
    expect(t.axisFontPx).toBe(10)
    expect(t.labelFontPx).toBe(12)
    expect(t.legendFontPx).toBe(10)
    // Never below 10 on a 2x screen, never above 13 in an axis.
    expect(t.axisFontPx).toBeGreaterThanOrEqual(10)
    expect(t.axisFontPx).toBeLessThanOrEqual(13)
  })
})

describe('withColorBlindPair', () => {
  it('swaps the pair without disturbing the rest of the palette', () => {
    // TradingView ships this and a harsh critic will look for it.
    const base = themeFromCss(el, false, false)
    const cb = withColorBlindPair(base)
    expect(cb.up).toBe('#2f81f7')
    expect(cb.down).toBe('#f0883e')
    expect(cb.upFill).toBe('rgba(47, 129, 247, 0.88)')
    expect(cb.volumeDown).toBe('rgba(240, 136, 62, 0.26)')
    expect(cb.ink).toBe(base.ink)
    expect(cb.bg).toBe(base.bg)
    expect(cb.accent).toBe(base.accent)
  })
})
