import { describe, it, expect } from 'vitest'
import {
  plotBox, xFromPx, pxFromX, panView, zoomView, clampView, flowMaxSpan, FLOW_MIN_SPAN_MS,
} from './view'

const MS_PER_DAY = 86_400_000
const BOX = plotBox(400, 368, { t: 16, b: 36, l: 44, r: 8 })
const V = { x0: 0, x1: 100 * MS_PER_DAY }

describe('plotBox', () => {
  it('subtracts the margins, and follows censor mode when it flips them', () => {
    expect(BOX).toEqual({ left: 44, width: 348, top: 16, height: 316 })
    // Censored, the left margin drops to 10 — the mapping has to move with it.
    const censored = plotBox(400, 368, { t: 16, b: 36, l: 10, r: 8 })
    expect(censored.left).toBe(10)
    expect(censored.width).toBe(382)
  })

  it('never goes negative on a collapsed container', () => {
    const b = plotBox(20, 368, { t: 16, b: 36, l: 44, r: 8 })
    expect(b.width).toBe(0)
  })
})

describe('xFromPx / pxFromX', () => {
  it('round-trips', () => {
    for (const px of [44, 100, 250, 392]) {
      expect(pxFromX(xFromPx(px, V.x0, V.x1, BOX), V.x0, V.x1, BOX)).toBeCloseTo(px, 6)
    }
  })

  it('maps the plot area edges to the range ends', () => {
    expect(xFromPx(BOX.left, V.x0, V.x1, BOX)).toBe(V.x0)
    expect(xFromPx(BOX.left + BOX.width, V.x0, V.x1, BOX)).toBe(V.x1)
  })
})

describe('panView', () => {
  it('reveals earlier dates when the finger moves right', () => {
    const p = panView(V, 50, BOX)
    expect(p.x0).toBeLessThan(V.x0)
    expect(p.x1 - p.x0).toBeCloseTo(V.x1 - V.x0, 6)
  })
})

describe('zoomView', () => {
  const MAX = 1000 * MS_PER_DAY

  it('keeps the anchored date under the cursor, in and back out', () => {
    const at = 200
    const before = xFromPx(at, V.x0, V.x1, BOX)
    const inn = zoomView(V, 2, at, BOX, FLOW_MIN_SPAN_MS, MAX)
    expect(xFromPx(at, inn.x0, inn.x1, BOX)).toBeCloseTo(before, 3)
    const out = zoomView(inn, 0.5, at, BOX, FLOW_MIN_SPAN_MS, MAX)
    expect(xFromPx(at, out.x0, out.x1, BOX)).toBeCloseTo(before, 3)
    expect(out.x1 - out.x0).toBeCloseTo(V.x1 - V.x0, 3)
  })

  it('clamps the span at both ends', () => {
    const deep = zoomView(V, 1e6, 200, BOX, FLOW_MIN_SPAN_MS, MAX)
    expect(deep.x1 - deep.x0).toBeCloseTo(FLOW_MIN_SPAN_MS, 6)
    const wide = zoomView(V, 1e-6, 200, BOX, FLOW_MIN_SPAN_MS, MAX)
    expect(wide.x1 - wide.x0).toBeCloseTo(MAX, 6)
  })
})

describe('clampView', () => {
  const bounds = { min: 0, max: 100 * MS_PER_DAY }

  it('allows half a window of slack, and no more', () => {
    const span = 10 * MS_PER_DAY
    const far = clampView({ x0: bounds.max + 5 * span, x1: bounds.max + 6 * span }, bounds)
    expect(far.x1).toBeCloseTo(bounds.max + span / 2, 6)
    expect(far.x1 - far.x0).toBeCloseTo(span, 6)
  })

  it('centres a window wider than the data instead of pinning it to an edge', () => {
    // The slack scales with the span, so the clamp range never collapses on its
    // own — zoomed out past the ledger the window must be centred explicitly.
    const span = 500 * MS_PER_DAY
    for (const x0 of [-1e13, 1e13, bounds.min]) {
      const c = clampView({ x0, x1: x0 + span }, bounds)
      expect((c.x0 + c.x1) / 2).toBeCloseTo((bounds.min + bounds.max) / 2, 6)
      expect(c.x1 - c.x0).toBeCloseTo(span, 6)
    }
  })
})

describe('flowMaxSpan', () => {
  it('never zooms out to less than the opening window', () => {
    const tiny = { min: 0, max: 2 * MS_PER_DAY }
    expect(flowMaxSpan(tiny, 60 * MS_PER_DAY)).toBe(60 * MS_PER_DAY)
  })

  it('allows a fifth beyond the data on a long ledger', () => {
    const long = { min: 0, max: 1000 * MS_PER_DAY }
    expect(flowMaxSpan(long, 60 * MS_PER_DAY)).toBeCloseTo(1200 * MS_PER_DAY, 6)
  })
})
