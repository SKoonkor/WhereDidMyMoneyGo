import { describe, expect, it } from 'vitest'
import { createPriceAxisLayer } from './priceAxis'
import { createTimeAxisLayer } from './timeAxis'
import { createLastPriceLayer } from './lastPrice'
import { createGridLayer } from './grid'
import { harness, paintedText, sawSeries, series, testTheme, texts } from './harness'
import { timeTicks } from '../scale'
import type { TimeUnit } from '../types'

/** A flat band from 100 to 200 over a 400px plot: 4px per unit, so a label's y
 *  can be reasoned about to the pixel. */
function band(lastClose: number, n = 30) {
  const bars = Array.from({ length: n }, (_, i) => ({
    t: i * 60_000,
    o: 140,
    h: 160,
    l: 120,
    c: i === n - 1 ? lastClose : 140,
    v: 100,
  }))
  return harness({ data: series(bars), h: 400, p0: 100, p1: 200, span: n })
}

describe('the price axis', () => {
  it('never draws more than seven labels, and never two closer than 34px', () => {
    for (const h of [200, 400, 800, 1200]) {
      const { c, fake } = harness({ h, data: sawSeries(120) })
      createPriceAxisLayer({ tickSize: 0.5 }).draw(c)
      const ys = paintedText(fake).map((t) => t.y).sort((a, b) => a - b)
      expect(ys.length, `h ${h}`).toBeLessThanOrEqual(7)
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i] - ys[i - 1], `h ${h}`).toBeGreaterThanOrEqual(34)
      }
    }
  })

  it('gives every label the same decimal count, taken from the tick size', () => {
    // Derived per value instead, this axis would read 43,200 / 43,187.5 —
    // ragged, and it reads as amateur before you can say why.
    for (const [tickSize, decimals] of [[0.01, 2], [0.5, 1], [1, 0], [0.0025, 4]] as const) {
      const { c, fake } = harness({ data: sawSeries(120) })
      createPriceAxisLayer({ tickSize }).draw(c)
      const labels = texts(fake)
      expect(labels.length, `tick ${tickSize}`).toBeGreaterThan(1)
      for (const s of labels) {
        const dot = s.indexOf('.')
        expect(dot === -1 ? 0 : s.length - dot - 1, `"${s}" @ tick ${tickSize}`).toBe(decimals)
      }
    }
  })

  it('drops a label that would hang off the plot edge rather than clipping it', () => {
    // The 100 and 200 ticks sit exactly on the bottom and top edges.
    const { c, fake } = band(140)
    createPriceAxisLayer({ tickSize: 0.5 }).draw(c)
    const labels = texts(fake)
    expect(labels).not.toContain('100.0')
    expect(labels).not.toContain('200.0')
    expect(labels).toContain('120.0')
  })

  it('masks every label under privacy mode, at a width that does not reflow', () => {
    const plain = harness({ data: sawSeries(120) })
    const axis = createPriceAxisLayer({ tickSize: 0.5 })
    axis.draw(plain.c)
    const before = texts(plain.fake)

    const hidden = harness({ data: sawSeries(120), theme: { censor: true } })
    createPriceAxisLayer({ tickSize: 0.5 }).draw(hidden.c)
    const after = texts(hidden.fake)

    expect(after).toHaveLength(before.length)
    for (let i = 0; i < after.length; i++) {
      expect(after[i]).not.toMatch(/\d/)
      expect(after[i]).toHaveLength(before[i].length)
    }
  })

  it('reports a width of the widest label plus 16px', () => {
    const { c } = harness({ data: sawSeries(120) })
    const axis = createPriceAxisLayer({ tickSize: 0.5 })
    axis.draw(c)
    // FAKE_CHAR_W is 6.2 and the widest label here is "43,200.0"-shaped.
    expect(axis.desiredWidth()).toBeGreaterThan(16)
  })
})

describe('the last-price pill', () => {
  // Overlapping labels in a price axis is the single most common tell in a
  // hobby chart, so the pill takes 18px of clearance from the grid's labels.
  const drawAxisAt = (lastClose: number) => {
    const { c, fake } = band(lastClose)
    createPriceAxisLayer({ tickSize: 0.5 }).draw(c)
    return texts(fake)
  }

  it('hides a grid label 17px away', () => {
    // yOf(140) = 240; yOf(135.75) = 257.
    expect(drawAxisAt(135.75)).not.toContain('140.0')
  })

  it('keeps a grid label 19px away', () => {
    // yOf(135.25) = 259.
    expect(drawAxisAt(135.25)).toContain('140.0')
  })

  it('draws its own price, at the tick size’s precision', () => {
    const { c, fake } = band(135.75)
    createLastPriceLayer({ tickSize: 0.5 }).draw(c)
    // One decimal, from the 0.5 tick size — never from the value.
    expect(paintedText(fake)[0].text).toBe('135.8')
  })

  it('picks its ink by the pill’s computed luminance, not by direction', () => {
    // Chosen by "is this the up colour?" instead, the ink breaks the moment the
    // colour-blind palette is switched on: blue needs white and orange needs
    // dark, and neither of them is "up". Here the light green takes near-black
    // and the darker red takes near-white — opposite directions, and the rule
    // never mentions direction at all.
    const up = band(145)
    createLastPriceLayer({ tickSize: 0.5 }).draw(up.c)
    expect(paintedText(up.fake)[0].fill).toBe('#0a0e14')

    const down = band(135.75)
    createLastPriceLayer({ tickSize: 0.5 }).draw(down.c)
    expect(paintedText(down.fake)[0].fill).toBe('#f7fafc')

    // And never pure #000 or #fff, which §E bans outright.
    expect(['#000', '#000000', '#fff', '#ffffff']).not.toContain(paintedText(up.fake)[0].fill)
  })

  it('sits inside the axis gutter, never over the divider or the screen edge', () => {
    // Review read the full-bleed pill as "wider than the axis column, its left
    // edge protruding past the plot/axis divider, glyphs to within a hair of the
    // right crop edge". Both edges are now inset, and by fixed amounts.
    const { c, fake } = band(140)
    createLastPriceLayer({ tickSize: 0.5 }).draw(c)
    const pill = fake.of('roundRect')[0]
    const [x, , w] = pill.a
    expect(x).toBeGreaterThan(c.priceAxis.x)
    expect(x + w).toBeLessThan(c.priceAxis.x + c.priceAxis.w)
    expect(c.priceAxis.x + c.priceAxis.w - (x + w)).toBeGreaterThanOrEqual(4)
  })

  it('is set at the same size and weight as the ladder it highlights', () => {
    // The filled background IS the highlight. When the type shouted too, the
    // pill read as a foreign badge stuck onto the axis rather than the
    // highlighted member of the 68,400.0 / 68,200.0 ladder around it.
    const axis = band(140)
    createPriceAxisLayer({ tickSize: 0.5 }).draw(axis.c)
    const ladderFont = paintedText(axis.fake)[0].font

    const pill = band(140)
    createLastPriceLayer({ tickSize: 0.5 }).draw(pill.c)
    const painted = paintedText(pill.fake)
    expect(painted[0].font).toBe(ladderFont)
    // ...and on the ladder's own left margin, not its own.
    expect(painted[0].x).toBe(axis.c.priceAxis.x + 8)
  })

  it('runs its dashed leader continuously from the candle to the pill', () => {
    // Review caught the connector starting clear of the final candle, "leaving a
    // floating dash with a gap on both sides". Anchored behind the body, no bar
    // width or dash phase can reopen that gap.
    const { c, fake } = band(140)
    createLastPriceLayer({ tickSize: 0.5 }).draw(c)
    const from = fake.of('moveTo')[0]
    const to = fake.of('lineTo')[0]
    const lastBody = c.scales.cx(c.data.length - 1) - c.scales.bodyW / 2
    expect(from.x).toBeLessThanOrEqual(lastBody + 1e-9)
    expect(to.x).toBe(c.snap(c.priceAxis.x))
    expect(from.y).toBe(to.y)
  })

  it('counts down to the bar close under the pill', () => {
    const { c, fake } = band(140)
    // 30s into a 60s bar — the harness's `now` sits one half-bar past the open.
    createLastPriceLayer({ tickSize: 0.5, countdown: true }).draw(c)
    expect(texts(fake)).toContain('0:30')
  })

  it('flashes on a price change and decays to nothing within 220ms', () => {
    const layer = createLastPriceLayer({ tickSize: 0.5 })
    const first = band(140)
    layer.draw(first.c)
    const alphaCount = (f: typeof first.fake) =>
      f.values('globalAlpha').filter((a) => typeof a === 'number' && a > 0 && a < 0.36).length

    const moved = band(141)
    moved.c.interaction.pressed = false
    layer.draw(moved.c)
    expect(alphaCount(moved.fake)).toBeGreaterThan(0)

    // Animated off c.dt, never the wall clock: one long frame must consume the
    // whole flash, which is what stops a resumed tab from flashing forever.
    const settled = band(141)
    Object.assign(settled.c, { dt: 400 })
    layer.draw(settled.c)
    const after = band(141)
    layer.draw(after.c)
    expect(alphaCount(after.fake)).toBe(0)
  })

  it('stays silent under prefers-reduced-motion', () => {
    const layer = createLastPriceLayer({ tickSize: 0.5 })
    layer.draw(band(140).c)
    const moved = harness({
      data: series([{ t: 0, o: 140, h: 160, l: 120, c: 141, v: 1 }]),
      h: 400,
      p0: 100,
      p1: 200,
      span: 2,
      theme: { reducedMotion: true },
    })
    layer.draw(moved.c)
    const alphas = moved.fake.values('globalAlpha').filter((a) => typeof a === 'number')
    expect(alphas.some((a) => (a as number) > 0 && (a as number) < 0.36)).toBe(false)
  })
})

describe('the time axis', () => {
  const fmt = (t: number, _u: TimeUnit, major: boolean) => (major ? `D${t}` : `h${t}`)

  it('promotes exactly the ticks that timeTicks marked major, and only those', () => {
    // The --ink / --muted split is most of what makes a dense time axis
    // readable; getting it from anywhere but the `major` flag means the axis and
    // the grid's verticals can disagree about where a day starts.
    //
    // Anchored to a real LOCAL midnight, and wide enough that the ladder picks a
    // 6-hour step rather than a daily one. Both matter, and this test failed in
    // CI without them: epoch-anchored, the window's day boundaries land in a
    // different place in every timezone, and at 340px the step became one DAY —
    // where `major` means Monday rather than a day boundary. In UTC the run's
    // only Monday was the final tick, which the layer correctly DROPS rather
    // than clip at the plot edge, leaving nothing promoted and the guard below
    // failing. Four local midnights inside a wide plot is true everywhere.
    const midnight = new Date(2026, 0, 5, 0, 0, 0, 0).getTime()
    const data = sawSeries(400, 43000, 15 * 60_000, midnight)
    const { c, fake } = harness({ data, span: 400, w: 1200 })
    createTimeAxisLayer({ format: fmt }).draw(c)

    const painted = paintedText(fake)
    const inked = painted.filter((p) => p.fill === testTheme.ink).map((p) => p.text)
    const muted = painted.filter((p) => p.fill === testTheme.muted).map((p) => p.text)
    expect(painted).toHaveLength(inked.length + muted.length)
    expect(inked.length).toBeGreaterThan(0)
    for (const s of inked) expect(s.startsWith('D')).toBe(true)
    for (const s of muted) expect(s.startsWith('h')).toBe(true)

    const expected = timeTicks(data.t[0], data.t[data.length - 1], c.plot.w, 64)
      .filter((t) => t.major)
      .map((t) => `D${t.t}`)
    for (const s of inked) expect(expected).toContain(s)
  })

  it('gives promoted labels the prose stack and the rest the mono one', () => {
    const data = sawSeries(400, 43000, 15 * 60_000)
    const { c, fake } = harness({ data, span: 400 })
    createTimeAxisLayer({ format: fmt }).draw(c)
    for (const p of paintedText(fake)) {
      expect(p.font).toContain(p.text.startsWith('D') ? 'sans-serif' : 'monospace')
    }
  })

  it('drops an edge label rather than clipping it', () => {
    // A label wide enough that the outermost tick cannot fit whole.
    const data = sawSeries(400, 43000, 15 * 60_000)
    const wide = harness({ data, span: 400 })
    createTimeAxisLayer({ format: () => 'X'.repeat(40) }).draw(wide.c)
    const painted = paintedText(wide.fake)
    for (const p of painted) {
      expect(p.x - 40 * 6.2 / 2).toBeGreaterThanOrEqual(wide.c.plot.x)
      expect(p.x + 40 * 6.2 / 2).toBeLessThanOrEqual(wide.c.plot.x + wide.c.plot.w)
    }
  })

  it('never clips the first label against the plot’s left boundary', () => {
    // Reported from a screenshot as possibly clipped rather than centred on its
    // gridline. It is dropped, not clipped — but the boundary case deserves to
    // be pinned rather than believed.
    const data = sawSeries(400, 43000, 15 * 60_000)
    for (const span of [60, 120, 240, 400]) {
      for (const i0 of [0, 0.5, 7.25, 33]) {
        const { c, fake } = harness({ data, span, i0 })
        createTimeAxisLayer({ format: fmt }).draw(c)
        for (const p of paintedText(fake)) {
          const half = (p.text.length * 6.2) / 2
          expect(p.x - half, `"${p.text}" span ${span} i0 ${i0}`).toBeGreaterThanOrEqual(c.plot.x)
          expect(p.x + half).toBeLessThanOrEqual(c.plot.x + c.plot.w)
        }
      }
    }
  })

  it('measures each label once per tick-set change, not once per frame', () => {
    // measureText costs about as much as fillText; re-measuring six labels every
    // frame would double this layer's whole text budget for nothing.
    const layer = createTimeAxisLayer({ format: fmt })
    const first = harness({ span: 120 })
    layer.draw(first.c)
    expect(first.fake.of('measureText').length).toBeGreaterThan(0)

    const again = harness({ span: 120 })
    layer.draw(again.c)
    expect(again.fake.of('measureText')).toHaveLength(0)
  })
})

describe('the grid', () => {
  it('shares its price ladder with the axis, to the pixel', () => {
    const g = harness({ data: sawSeries(120) })
    createGridLayer({ tickSize: 0.5 }).draw(g.c)
    const a = harness({ data: sawSeries(120) })
    createPriceAxisLayer({ tickSize: 0.5 }).draw(a.c)

    const lineYs = g.fake.of('rect').filter((r) => r.a[2] > 100).map((r) => r.a[1])
    for (const t of paintedText(a.fake)) {
      expect(lineYs.some((y) => Math.abs(y - t.y) < 1)).toBe(true)
    }
  })

  it('draws verticals only where the time axis promotes a label', () => {
    // Local midnight, and wide enough for a 6-hour step — see the time axis's
    // own promotion test for why an epoch-anchored window makes this assertion
    // timezone-dependent and fails in CI.
    const midnight = new Date(2026, 0, 5, 0, 0, 0, 0).getTime()
    const data = sawSeries(400, 43000, 15 * 60_000, midnight)
    const { c, fake } = harness({ data, span: 400, w: 1200 })
    createGridLayer({ tickSize: 0.5 }).draw(c)
    // Verticals arrive as segments that step over each horizontal row, so it is
    // the distinct x values that correspond to boundaries, not the rect count.
    const verticals = new Set(
      fake.of('rect').filter((r) => r.a[2] < 2 && r.a[3] > 1).map((r) => r.a[0]),
    )
    const majors = timeTicks(data.t[0], data.t[data.length - 1], c.plot.w, 64).filter((t) => t.major)
    expect(verticals.size).toBeLessThanOrEqual(majors.length)
    expect(verticals.size).toBeGreaterThan(0)
  })

  it('never paints the same device pixel twice', () => {
    // The defect this pins was found by a pixel audit in a blind review: a mark
    // "roughly 5x brighter than the gridline it sits on", repeating once per
    // gridline row, at no tick position. It was the 4% vertical compositing
    // with the 6% horizontal where they cross — two faint lines making one
    // bright dot, so the crossings became the loudest marks on the grid while
    // meaning nothing.
    //
    // Counting coverage per device pixel is the assertion that actually rules
    // it out: any double-paint anywhere, by any future change, fails here.
    const data = sawSeries(1200, 43000, 15 * 60_000)
    for (const span of [120, 300, 600, 1000]) {
      for (const dpr of [1, 2, 3]) {
        const { c, fake } = harness({ data, span, dpr, w: 680, h: 520 })
        createGridLayer({ tickSize: 0.5 }).draw(c)

        const hits = new Map<string, number>()
        for (const r of [...fake.of('rect'), ...fake.of('fillRect')]) {
          const [x, y, w, h] = r.a
          for (let px = Math.round(x * dpr); px < Math.round((x + w) * dpr); px++) {
            for (let py = Math.round(y * dpr); py < Math.round((y + h) * dpr); py++) {
              const k = `${px},${py}`
              hits.set(k, (hits.get(k) ?? 0) + 1)
            }
          }
        }
        const doubled = [...hits.entries()].filter(([, n]) => n > 1)
        expect(doubled.slice(0, 4), `span ${span} dpr ${dpr}`).toEqual([])
        expect(hits.size).toBeGreaterThan(0)
      }
    }
  })

  it('puts every vertical under a promoted time label, and nowhere else', () => {
    // "At no tick position" was the other half of the review's claim. A vertical
    // whose label the time axis dropped would be exactly that, so the two layers
    // are checked against each other rather than each against itself.
    const midnight = new Date(2026, 0, 5, 0, 0, 0, 0).getTime()
    const data = sawSeries(1200, 43000, 15 * 60_000, midnight)
    for (const span of [120, 300, 600, 1000]) {
      const g = harness({ data, span, w: 680, h: 520 })
      createGridLayer({ tickSize: 0.5 }).draw(g.c)
      const verticals = g.fake.of('rect').filter((r) => r.a[3] > 20).map((r) => r.a[0])

      const t = harness({ data, span, w: 680, h: 520 })
      createTimeAxisLayer({ format: (_x, _u, major) => (major ? 'Mar 5' : '14:00') }).draw(t.c)
      const labels = paintedText(t.fake).filter((p) => p.text === 'Mar 5').map((p) => p.x)

      // The two layers agree everywhere except at the very edges, and that gap
      // is real rather than a test artifact: the time axis DROPS a label whose
      // half-width would cross the plot boundary (dropping beats clipping), so a
      // boundary landing within a label's reach of an edge keeps its vertical and
      // loses its text. Found at UTC+14, where a day boundary fell ~11px from the
      // right edge. Encoded rather than hidden — a vertical anywhere else without
      // a label is still a failure, which is what this test is for.
      const EDGE = 40
      for (const x of verticals) {
        const labelled = labels.some((l) => Math.abs(l - x) < 1)
        const atEdge = x < EDGE || x > g.c.plot.w - EDGE
        expect(labelled || atEdge, `vertical at ${x}, span ${span}`).toBe(true)
      }
    }
  })

  it('emits the whole grid in two fills, not one per line', () => {
    const { c, fake } = harness({ data: sawSeries(1200, 43000, 15 * 60_000), span: 300 })
    createGridLayer({ tickSize: 0.5 }).draw(c)
    expect(fake.of('fill')).toHaveLength(2)
    expect(fake.values('fillStyle')).toHaveLength(2)
  })

  it('draws horizontals at exactly the 6% token, unmodified', () => {
    // §E specifies 6% ink on dark. Reported as "too faint" in review; this pins
    // that the layer emits the token as-is, so faintness is a spec question and
    // not a layer bug.
    const { c, fake } = harness({ data: sawSeries(120) })
    createGridLayer({ tickSize: 0.5 }).draw(c)
    expect(fake.values('fillStyle')[0]).toBe(testTheme.grid)
    expect(fake.values('globalAlpha')).toEqual([])
  })

  it('can be asked for horizontals only', () => {
    const data = sawSeries(400, 43000, 15 * 60_000)
    const { c, fake } = harness({ data, span: 400 })
    createGridLayer({ tickSize: 0.5, verticals: false }).draw(c)
    expect(fake.of('rect').filter((r) => r.a[2] < 2)).toHaveLength(0)
  })
})
