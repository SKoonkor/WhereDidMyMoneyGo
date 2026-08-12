import { describe, expect, it } from 'vitest'
import { createCandleLayer, type CandleMode } from './candles'
import { harness, sawSeries, series } from './harness'
import { unsnappedRects } from '../testing/fakeCtx'

const CANDLE_MODES: CandleMode[] = ['candles', 'hollow', 'heikin', 'bars']

describe('the candle pass', () => {
  it('emits exactly two fill() calls and two fillStyle assignments, at any bar count', () => {
    // The whole performance argument for batching. One fillStyle inside the loop
    // and 120 bars become 120 state changes, which is the difference between
    // 0.25ms and 0.9ms a frame on a mid-range phone.
    for (const bars of [1, 20, 120, 600]) {
      for (const mode of CANDLE_MODES) {
        const { c, fake } = harness({ data: sawSeries(bars), span: Math.max(2, bars) })
        createCandleLayer({ mode }).draw(c)
        expect(fake.of('fill'), `${mode} @ ${bars} bars`).toHaveLength(2)
        expect(fake.values('fillStyle'), `${mode} @ ${bars} bars`).toHaveLength(2)
      }
    }
  })

  it('never calls beginPath inside the bar loop', () => {
    const { c, fake } = harness({ data: sawSeries(120) })
    createCandleLayer({ mode: 'candles' }).draw(c)
    expect(fake.of('beginPath')).toHaveLength(2)
    expect(fake.of('rect').length).toBeGreaterThan(200)
  })

  it('never strokes — a 1px stroke off a half-pixel is the grey blur', () => {
    for (const mode of CANDLE_MODES) {
      const { c, fake } = harness()
      createCandleLayer({ mode }).draw(c)
      expect(fake.of('stroke'), mode).toHaveLength(0)
    }
  })

  it('lands every rect edge on a device-pixel boundary at dpr 1, 2 and 3', () => {
    for (const dpr of [1, 2, 3]) {
      for (const mode of CANDLE_MODES) {
        // Spans either side of both degradation thresholds, because each branch
        // computes its own geometry and each one can be wrong on its own.
        for (const span of [20, 100, 200, 400]) {
          const { c, fake } = harness({ data: sawSeries(500), span, dpr })
          createCandleLayer({ mode }).draw(c)
          expect(unsnappedRects(fake.ops, dpr), `${mode} dpr ${dpr} span ${span}`).toEqual([])
        }
      }
    }
  })
})

describe('a doji', () => {
  // |o - c| below half a tick. Left as a rect it rounds to zero height and the
  // bar vanishes from the chart entirely.
  const flat = series(
    Array.from({ length: 12 }, (_, i) => ({
      t: i * 60_000,
      o: 100,
      h: 100.4,
      l: 99.6,
      c: 100,
      v: 10,
    })),
  )

  it('still draws a visible body, at least one device pixel high', () => {
    for (const dpr of [1, 2, 3]) {
      const { c, fake } = harness({ data: flat, dpr, p0: 99, p1: 101 })
      createCandleLayer({ mode: 'candles', tickSize: 0.1 }).draw(c)
      const bodyW = c.scales.bodyW
      const bodies = fake.of('rect').filter((r) => Math.abs(r.a[2] - bodyW) < 1e-9)
      expect(bodies.length, `dpr ${dpr}`).toBe(12)
      for (const b of bodies) expect(b.a[3]).toBeGreaterThanOrEqual(1 / dpr - 1e-9)
    }
  })

  it('draws it at FULL body width, not a hairline', () => {
    const { c, fake } = harness({ data: flat, p0: 99, p1: 101 })
    createCandleLayer({ mode: 'candles', tickSize: 0.1 }).draw(c)
    const widest = Math.max(...fake.of('rect').map((r) => r.a[2]))
    expect(widest).toBeCloseTo(c.scales.bodyW, 9)
  })
})

describe('progressive degradation', () => {
  // TradingView switches representation exactly here, and it is why their
  // zoomed-out view stays crisp instead of turning into a smear.
  const data = sawSeries(1200)

  const draw = (span: number) => {
    const { c, fake } = harness({ data, span, w: 340, dpr: 2 })
    createCandleLayer({ mode: 'candles' }).draw(c)
    return { c, fake }
  }

  it('draws full bodies while the pitch is at least 2.5px', () => {
    const { c, fake } = draw(100) // 3.4px pitch
    expect(c.scales.barW).toBeGreaterThan(2.5)
    const widest = Math.max(...fake.of('rect').map((r) => r.a[2]))
    expect(widest).toBeCloseTo(c.scales.bodyW, 9)
    expect(fake.of('moveTo')).toHaveLength(0)
  })

  it('collapses to one-device-pixel OHLC bars below 2.5px of pitch', () => {
    const { c, fake } = draw(200) // 1.7px pitch
    expect(c.scales.barW).toBeLessThan(2.5)
    expect(c.scales.barW).toBeGreaterThan(1.2)
    const rects = fake.of('rect')
    expect(rects.length).toBeGreaterThan(100)
    for (const r of rects) expect(r.a[2]).toBeCloseTo(1 / c.dpr, 9)
    expect(fake.of('moveTo')).toHaveLength(0)
  })

  it('becomes a filled step-area of closes below 1.2px of pitch', () => {
    const { c, fake } = draw(400) // 0.85px pitch
    expect(c.scales.barW).toBeLessThan(1.2)
    expect(fake.of('moveTo').length).toBeGreaterThan(0)
    expect(fake.of('lineTo').length).toBeGreaterThan(100)
    // Still two fills and two styles: the area plus its one-pixel ridge.
    expect(fake.of('fill')).toHaveLength(2)
    expect(fake.values('fillStyle')).toHaveLength(2)
  })
})

describe('candle modes', () => {
  it('draws hollow up-bars as four border rects, not a stroke', () => {
    const { c, fake } = harness({ span: 20 })
    createCandleLayer({ mode: 'hollow' }).draw(c)
    const hollowRects = fake.of('rect').length

    const solid = harness({ span: 20 })
    createCandleLayer({ mode: 'candles' }).draw(solid.c)
    expect(hollowRects).toBeGreaterThan(solid.fake.of('rect').length)
    expect(fake.of('stroke')).toHaveLength(0)
    expect(c.scales.barW).toBeGreaterThan(2.5)
  })

  it('smooths heikin-ashi bodies relative to the raw candles', () => {
    const raw = harness({ span: 40 })
    createCandleLayer({ mode: 'candles' }).draw(raw.c)
    const ha = harness({ span: 40 })
    createCandleLayer({ mode: 'heikin' }).draw(ha.c)

    const heights = (f: typeof raw.fake, w: number) =>
      f.of('rect').filter((r) => Math.abs(r.a[2] - w) < 1e-9).map((r) => r.a[3])
    const rawH = heights(raw.fake, raw.c.scales.bodyW)
    const haH = heights(ha.fake, ha.c.scales.bodyW)
    expect(haH.length).toBe(rawH.length)
    // Heikin-Ashi opens at the previous body's midpoint, so its bodies overlap
    // and average out taller than the raw ones on a zig-zag.
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    expect(mean(haH)).not.toBeCloseTo(mean(rawH), 3)
  })

  it('strokes a polyline in line mode and fills underneath it in area mode', () => {
    const line = harness()
    createCandleLayer({ mode: 'line' }).draw(line.c)
    expect(line.fake.of('stroke')).toHaveLength(1)
    expect(line.fake.of('fill')).toHaveLength(0)

    const area = harness()
    createCandleLayer({ mode: 'area' }).draw(area.c)
    expect(area.fake.of('stroke')).toHaveLength(1)
    expect(area.fake.of('fill')).toHaveLength(1)
  })

  it('switches representation through setMode without being rebuilt', () => {
    const layer = createCandleLayer({ mode: 'candles' })
    const a = harness()
    layer.draw(a.c)
    expect(a.fake.of('stroke')).toHaveLength(0)
    layer.setMode('line')
    const b = harness()
    layer.draw(b.c)
    expect(b.fake.of('stroke')).toHaveLength(1)
  })
})

describe('an empty series', () => {
  it('draws nothing at all rather than throwing', () => {
    const { c, fake } = harness({ data: series([]) })
    for (const mode of CANDLE_MODES) createCandleLayer({ mode }).draw(c)
    expect(fake.ops).toHaveLength(0)
  })
})
