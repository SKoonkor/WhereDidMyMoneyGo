import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { buildFlow, EMPTY_FLOW } from '../../lib/analytics/moneyflow'
import { buildFlowFigure, padFlowY, ARROW_STANDOFF_PX } from './figure'

const UI = { ink: '#fff', muted: '#999', grid: '#333', band: '#888', annoBg: '#000' }
const OPTS = {
  currency: 'THB',
  defaultDays: 60,
  censor: false,
  ui: UI,
  noData: 'No data',
  labels: {
    netWorth: 'Net worth', balances: 'Latest balances', amount: 'Amount',
    balanceAfter: 'Balance after', forecast: 'Forecast', hidden: 'Hidden cost',
  },
}

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 100,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

type Dict = Record<string, unknown>
const layoutOf = (fig: { layout: Dict }) => fig.layout

describe('buildFlowFigure box', () => {
  const fig = buildFlowFigure(buildFlow([T({})]), null, OPTS)

  it('is 184px tall with a tight top margin', () => {
    const l = layoutOf(fig)
    expect(l.height).toBe(184)
    expect((l.margin as Dict).t).toBe(16)
    expect((l.margin as Dict).b).toBe(36)
  })

  // The empty-state branch used to hard-code its own height/margin and had
  // already drifted from the real figure. Assert they stay in lockstep.
  it('gives the no-data placeholder the same box', () => {
    const empty = layoutOf(buildFlowFigure(EMPTY_FLOW, null, OPTS))
    expect(empty.height).toBe(184)
    expect((empty.margin as Dict).t).toBe(16)
    expect((empty.margin as Dict).b).toBe(36)
  })

  // The Flow page draws a much taller chart than the Home tile, so the height
  // is an option. Both branches have to honour it or the page and its empty
  // state would disagree.
  it('honours an explicit height in both branches', () => {
    const tall = { ...OPTS, height: 368 }
    expect(layoutOf(buildFlowFigure(buildFlow([T({})]), null, tall)).height).toBe(368)
    expect(layoutOf(buildFlowFigure(EMPTY_FLOW, null, tall)).height).toBe(368)
  })

  // The Flow page drives pan/zoom/inspect itself, so Plotly's own drag and
  // touch-hover have to stand down. Home passes nothing and must keep both.
  it('stands Plotly interactions down only when asked', () => {
    const plain = layoutOf(buildFlowFigure(buildFlow([T({})]), null, OPTS))
    expect(plain.dragmode).toBe('pan')
    expect(plain.hovermode).toBe('closest')

    const owned = layoutOf(buildFlowFigure(buildFlow([T({})]), null, { ...OPTS, interactive: true }))
    expect(owned.dragmode).toBe(false)
    expect(owned.hovermode).toBe(false)
  })
})

describe('income arrow standoff', () => {
  const flow = buildFlow([
    T({ period: '2026-07-01', type: 'Income', amount: 45_000, account: 'Bank' }),
    T({ period: '2026-07-05', amount: 300 }),
  ])
  const arrowsOf = (fig: { data: Dict[] }) =>
    fig.data.find(
      (d) => (d as Dict).mode === 'markers'
        && ((d as Dict).marker as Dict | undefined)?.symbol === 'triangle-up',
    ) as Dict | undefined

  // The arrow used to be offset in DATA units derived from the y-range, so it
  // detached from its bar the moment the range moved — and the range now moves
  // on every pan. It is a pixel-space marker.standoff instead, which is what
  // these assertions pin.
  it.each([undefined, 368])('is pinned to the bar top in pixel space (height %s)', (height) => {
    const arrows = arrowsOf(buildFlowFigure(flow, null, { ...OPTS, height }))
    expect(arrows).toBeDefined()
    const marker = arrows!.marker as Dict

    const bar = flow.bars.find((b) => b.type === 'Income')!
    expect((arrows!.y as number[])[0]).toBe(bar.base + bar.height)
    expect(marker.standoff).toBe(ARROW_STANDOFF_PX)
    expect(marker.angleref).toBe('up')
    expect(marker.angle).toBe(0)
    // Floating outside the box would paint over the axis labels once a bar is
    // panned off the edge, which a window-fitted range makes routine.
    expect(arrows!.cliponaxis).toBe(true)
  })

  // The real "arrows can't detach" guarantee: two figures whose y-ranges differ
  // wildly must emit byte-identical arrow positions. The old data-unit standoff
  // could never have passed this.
  it('emits the same arrow y whatever the y-range works out to', () => {
    const wide = buildFlow([
      T({ period: '2026-07-01', type: 'Income', amount: 45_000, account: 'Bank' }),
      T({ period: '2026-07-05', amount: 300 }),
      T({ period: '2026-07-06', type: 'Income', amount: 900_000, account: 'Bank' }),
    ])
    const a = arrowsOf(buildFlowFigure(flow, null, OPTS))!
    const b = arrowsOf(buildFlowFigure(wide, null, OPTS))!
    const yOf = (f: typeof flow) => f.bars.filter((x) => x.type === 'Income').map((x) => x.base + x.height)
    expect(a.y).toEqual(yOf(flow))
    expect(b.y).toEqual(yOf(wide))
  })
})

describe('y-range fitting', () => {
  // Dropping the forced 0 / net worth is the whole point: with them, a window
  // sitting far above zero was stretched all the way down to it.
  it('no longer stretches the axis to reach zero', () => {
    // The rise from zero happens well before the 60-day opening window, so the
    // window holds only a small expense sitting on a ~500k balance. It used to
    // be stretched all the way down to zero regardless.
    const flow = buildFlow([
      T({ id: 1, period: '2026-01-01', type: 'Income', amount: 500_000, account: 'Bank' }),
      T({ id: 2, period: '2026-07-20', amount: 200 }),
    ])
    const l = layoutOf(buildFlowFigure(flow, null, OPTS))
    const [lo] = (l.yaxis as Dict).range as [number, number]
    expect(lo).toBeGreaterThan(0)
  })

  it('keeps pixel headroom for the arrows at the Home height', () => {
    // 184 - 16 - 36 = 132px of drawn area; 18px of that is 13.6% of the span,
    // which has to beat the flat 8%.
    const [lo, hi] = padFlowY(0, 100, 132, true)
    expect((hi - 100) / 100).toBeGreaterThan(0.13)
    expect(lo).toBeLessThan(0)
    // Without arrows the plain 8% stands.
    const [, hiNoArrows] = padFlowY(0, 100, 132, false)
    expect(hiNoArrows).toBeCloseTo(108, 6)
  })

  it('falls back to the flat pad when the box is tall enough', () => {
    // 368 - 16 - 36 = 316px; 18/316 = 5.7%, so the 8% wins.
    const [, hi] = padFlowY(0, 100, 316, true)
    expect(hi).toBeCloseTo(108, 6)
  })
})
