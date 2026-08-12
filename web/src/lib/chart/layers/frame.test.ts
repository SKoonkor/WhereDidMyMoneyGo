// Whole-frame properties: the things that can only be wrong once every layer is
// on the canvas together.

import { describe, expect, it } from 'vitest'
import type { ChartLayer, RenderCtx, TimeUnit } from '../types'
import { unsnappedRects } from '../testing/fakeCtx'
import { harness, paintedText, sawSeries, texts, type HarnessOptions } from './harness'
import { createGridLayer } from './grid'
import { createVolumeLayer } from './volume'
import { createCandleLayer } from './candles'
import { createIndicatorLayer, type IndicatorSeries } from './indicators'
import { createPriceAxisLayer } from './priceAxis'
import { createTimeAxisLayer } from './timeAxis'
import { createLastPriceLayer } from './lastPrice'
import { createLegendLayer } from './legend'
import { createCrosshairLayer } from './crosshair'
import { createPositionLinesLayer, type PriceLine } from './positionLines'
import { createDepthLayer } from './depth'

const TICK = 0.5
const LABELS = { o: 'o', h: 'h', l: 'l', c: 'c' }
const LINES: PriceLine[] = [
  { price: 43050, label: 'Entry', tone: 'entry', dashed: false },
  { price: 42600, label: 'Liq.', tone: 'liq', dashed: true },
]
const CLOCK = '14:30'
const BOOK = { bids: [{ p: 42990, q: 4 }], asks: [{ p: 43010, q: 7 }] }
const MA: IndicatorSeries = { id: 'sma', kind: 'line', color: '#2f81f7', at: (i) => (i < 20 ? NaN : 43100) }
const fmtTime = (t: number, _u: TimeUnit, major: boolean) => (major ? 'Mar 5' : `${t % 24}:00`)

/** The chrome that is on screen in every resting frame. */
function baseChrome(): ChartLayer[] {
  return [
    createGridLayer({ tickSize: TICK }),
    createVolumeLayer(),
    createCandleLayer({ mode: 'candles', tickSize: TICK }),
    createPriceAxisLayer({ tickSize: TICK }),
    createTimeAxisLayer({ format: fmtTime }),
    createLastPriceLayer({ tickSize: TICK, countdown: true }),
  ]
}

/** Everything, including the overlays a live position and a finger add. */
function everything(): ChartLayer[] {
  return [
    ...baseChrome(),
    createIndicatorLayer({ specs: () => [MA] }),
    createLegendLayer({ labels: LABELS, tickSize: TICK }),
    createPositionLinesLayer({ lines: () => LINES, tickSize: TICK }),
    createDepthLayer({ book: () => BOOK }),
    createCrosshairLayer({ formatTime: () => CLOCK, touchOffsetY: 44, tickSize: TICK }),
  ]
}

function paint(layers: ChartLayer[], o: HarnessOptions = {}) {
  const h = harness({ data: sawSeries(240), p0: 42500, p1: 43500, ...o })
  // Sorted by z, exactly as the renderer will.
  for (const l of layers.slice().sort((a, b) => a.z - b.z)) l.draw(h.c)
  return h
}

describe('a typical 120-bar frame', () => {
  it('spends no more than 13 fillText calls on its chrome', () => {
    // 13 x ~40us = 0.52ms of the chart's 6ms budget. fillText is the single
    // most expensive thing a layer does, and measureText costs the same again —
    // which is why every label set in here is cached rather than re-measured.
    const { fake } = paint(baseChrome(), { span: 120 })
    expect(fake.of('fillText').length).toBeLessThanOrEqual(13)
  })

  it('adds the legend, position and crosshair readouts for under 25 in total', () => {
    // The OHLC legend alone is nine of these — four micro-labels and four values
    // in different fonts and colours, plus the percentage. §E makes that readout
    // mandatory, so it cannot be folded into fewer calls; it is budgeted for
    // separately instead of pretending the resting frame pays for it.
    const { fake } = paint(everything(), {
      span: 120,
      interaction: { crosshair: { x: 120, y: 200, i: 180, p: 43000 } },
    })
    expect(fake.of('fillText').length).toBeLessThanOrEqual(25)
  })

  it('lands every rect edge on a device pixel, at dpr 1, 2 and 3', () => {
    // One unsnapped edge is the grey half-pixel halo that gives a hobby chart
    // away, and it only ever shows up on someone else's screen.
    for (const dpr of [1, 2, 3]) {
      for (const span of [20, 120, 300, 600]) {
        const { fake } = paint(everything(), {
          dpr,
          span,
          interaction: { crosshair: { x: 120, y: 200, i: 100, p: 43000 } },
        })
        expect(unsnappedRects(fake.ops, dpr), `dpr ${dpr} span ${span}`).toEqual([])
      }
    }
  })

  it('draws real chrome from frame one on an empty series', () => {
    // "Loading: never a spinner over an empty box." The grid and the price axis
    // need no data at all, so they are on screen immediately and the series
    // simply arrives into a chart that already looks like a chart.
    const empty = {
      length: 0,
      t: new Float64Array(0),
      o: new Float64Array(0),
      h: new Float64Array(0),
      l: new Float64Array(0),
      c: new Float64Array(0),
      v: new Float64Array(0),
      at: (i: number) => i,
      rev: 0,
    }
    const { fake } = paint(baseChrome(), { data: empty, span: 60 })
    expect(fake.of('fillRect').length).toBeGreaterThan(0)
    expect(texts(fake).length).toBeGreaterThan(0)
    // ...and nothing pretends there are bars: the only geometry inside the plot
    // is full-width gridlines, never a candle body or a volume bar.
    const narrow = fake.of('rect').filter((r) => r.a[2] < 300)
    expect(narrow).toHaveLength(0)
  })
})

describe('privacy mode', () => {
  // Canvas text is an opaque bitmap to CSS, so `:root[data-censor] .money` never
  // reaches it. Every number the chart draws has to mask itself, and the proof
  // is that the frame contains no digit anywhere.
  const moneyChrome = () => everything().filter((l) => l.id !== 'timeAxis')

  it('leaves no digit anywhere in a fully populated frame', () => {
    const { fake } = paint(moneyChrome(), {
      theme: { censor: true },
      span: 120,
      interaction: { crosshair: { x: 120, y: 200, i: 180, p: 43000 } },
    })
    const painted = texts(fake)
    expect(painted.length).toBeGreaterThan(8)
    // The crosshair's time pill is the app's own clock string, exempt for the
    // same reason the time axis is. Counting it keeps the exemption from ever
    // quietly swallowing a real leak.
    expect(painted.filter((s) => s === CLOCK)).toHaveLength(1)
    for (const s of painted) {
      if (s === CLOCK) continue
      expect(s, `"${s}" leaked a digit`).not.toMatch(/\d/)
    }
  })

  it('still shows the time axis, because a clock is not money', () => {
    // The exception is deliberate and narrow: privacy mode hides balances, not
    // what time it is. Widening it to the whole canvas would leave the chart
    // unreadable for no privacy gained.
    const { fake } = paint([createTimeAxisLayer({ format: fmtTime })], {
      theme: { censor: true },
      span: 120,
    })
    expect(texts(fake).some((s) => /\d/.test(s))).toBe(true)
  })

  it('keeps the axis the same width, so nothing reflows on the toggle', () => {
    const plain = paint(baseChrome(), { span: 120 })
    const hidden = paint(baseChrome(), { span: 120, theme: { censor: true } })
    const widths = (h: typeof plain) => paintedText(h.fake).map((t) => t.text.length)
    // The countdown drops out under censor — it lives inside the pill's own
    // furniture — so compare the labels that remain, character for character.
    const a = widths(plain).slice(0, widths(hidden).length)
    expect(widths(hidden)).toEqual(a)
  })
})

describe('layer contracts', () => {
  it('declares volatile for anything that animates on its own', () => {
    const volatile = everything().filter((l) => l.volatile).map((l) => l.id).sort()
    expect(volatile).toEqual(['crosshair', 'depth', 'lastPrice', 'legend', 'priceAxis'])
  })

  it('declares cacheable only for layers that are a pure function of data, viewport and theme', () => {
    const cacheable = everything().filter((l) => l.cacheable).map((l) => l.id).sort()
    expect(cacheable).toEqual(['candles', 'grid', 'indicators', 'volume'])
    // Nothing may be both: the cached bitmap is rebuilt on data changes only, so
    // a volatile layer inside it would freeze mid-animation.
    for (const l of everything()) expect(l.volatile && l.cacheable).toBe(false)
  })

  it('paints in the documented order, with the pill above the axis it sits in', () => {
    const byZ = everything().slice().sort((a, b) => a.z - b.z).map((l) => l.id)
    expect(byZ.indexOf('grid')).toBeLessThan(byZ.indexOf('volume'))
    expect(byZ.indexOf('indicators')).toBeLessThan(byZ.indexOf('candles'))
    expect(byZ.indexOf('candles')).toBeLessThan(byZ.indexOf('positionLines'))
    // The price axis fills its background opaquely, so a pill drawn before it
    // would be painted over and simply never appear.
    expect(byZ.indexOf('priceAxis')).toBeLessThan(byZ.indexOf('lastPrice'))
    expect(byZ.indexOf('lastPrice')).toBeLessThan(byZ.indexOf('crosshair'))
  })

  it('never asks the DOM for a colour', () => {
    // getComputedStyle forces a style resolution. Once per frame, per layer, on
    // the render path, it is the easiest way there is to lose 60fps.
    const c = harness().c as RenderCtx & { theme: { bg: string } }
    expect(typeof c.theme.bg).toBe('string')
    for (const l of everything()) expect(() => l.draw(c)).not.toThrow()
  })
})
