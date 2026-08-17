import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { buildFlow, EMPTY_FLOW } from '../../lib/analytics/moneyflow'
import { buildFlowFigure } from './figure'

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
const num = (v: unknown) => v as number

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
    const tall = { ...OPTS, height: 460 }
    expect(layoutOf(buildFlowFigure(buildFlow([T({})]), null, tall)).height).toBe(460)
    expect(layoutOf(buildFlowFigure(EMPTY_FLOW, null, tall)).height).toBe(460)
  })
})

describe('income arrow standoff', () => {
  // The arrow sits a fixed number of PIXELS above its bar, expressed in data
  // units via the drawn plot height. This converts it back and pins the
  // invariant, so changing PLOT_H/PLOT_MT/PLOT_MB can never silently detach the
  // arrows from their bars.
  it.each([undefined, 460])('stays 13px above the bar top whatever the y-range is (height %s)', (height) => {
    const flow = buildFlow([
      T({ period: '2026-07-01', type: 'Income', amount: 45_000, account: 'Bank' }),
      T({ period: '2026-07-05', amount: 300 }),
    ])
    const fig = buildFlowFigure(flow, null, { ...OPTS, height })
    const l = layoutOf(fig)

    const arrows = fig.data.find(
      (d) => (d as Dict).mode === 'markers'
        && ((d as Dict).marker as Dict | undefined)?.symbol === 'triangle-up',
    ) as Dict | undefined
    expect(arrows).toBeDefined()

    const bar = flow.bars.find((b) => b.type === 'Income')!
    const arrowY = (arrows!.y as number[])[0]
    const standoff = arrowY - (bar.base + bar.height)

    const [lo, hi] = (l.yaxis as Dict).range as [number, number]
    const m = l.margin as Dict
    const areaPx = num(l.height) - num(m.t) - num(m.b)
    expect((standoff * areaPx) / (hi - lo)).toBeCloseTo(13, 2)
  })
})
