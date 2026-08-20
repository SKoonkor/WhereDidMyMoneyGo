import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import type { Forecast } from '../../lib/analytics/forecast'
import { buildFlow, EMPTY_FLOW } from '../../lib/analytics/moneyflow'
import { buildFlowYSource, flowYRange, flowDefaultRange, flowDataBounds } from './figure'
import { clampView } from './view'

const MS_PER_DAY = 86_400_000
const day = (iso: string) => new Date(iso + 'T00:00:00Z').getTime()

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 100,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

// A two-day forecast whose OUTER band is wildly wider than its inner one, so a
// test can tell which of the two the range actually used.
const FC: Forecast = {
  dates: ['2026-07-20', '2026-07-21'],
  median: [1000, 1000],
  lo50: [900, 900],
  hi50: [1100, 1100],
  lo90: [-500_000, -500_000],
  hi90: [500_000, 500_000],
  anchorDate: '2026-07-20',
  anchorValue: 1000,
}

describe('flowYRange', () => {
  it('ignores the outer 90% band and fits the inner one', () => {
    const flow = buildFlow([T({ period: '2026-07-10', amount: 10 })])
    const src = buildFlowYSource(flow, FC)
    const r = flowYRange(src, day('2026-07-19'), day('2026-07-22'))!
    expect(r).not.toBeNull()
    // lo50/hi50 are 900/1100; the outer band would have dragged this to ±500k.
    expect(r.lo).toBeGreaterThan(-1000)
    expect(r.hi).toBeLessThan(2000)
    expect(r.hi).toBeCloseTo(1100, 6)
  })

  it('includes a bar that only partly overlaps the window', () => {
    const flow = buildFlow([T({ period: '2026-07-10', type: 'Income', amount: 5000, account: 'Bank' })])
    const bar = flow.bars[0]
    const src = buildFlowYSource(flow, null)
    // A window whose right edge lands inside the bar but left of its centre:
    // testing the centre instead of the span would drop it entirely.
    const edge = bar.x - bar.widthMs / 4
    const r = flowYRange(src, edge - MS_PER_DAY, edge)!
    expect(r).not.toBeNull()
    expect(r.hi).toBeCloseTo(bar.base + bar.height, 6)
  })

  it('keeps a range alive in a window with no bars, via the connectors', () => {
    const flow = buildFlow([
      T({ id: 1, period: '2026-07-01', type: 'Income', amount: 4000, account: 'Bank' }),
      T({ id: 2, period: '2026-08-01', amount: 100 }),
    ])
    const src = buildFlowYSource(flow, null)
    expect(src.bars.some((b) => b.x0 >= day('2026-07-10') && b.x1 <= day('2026-07-20'))).toBe(false)
    const r = flowYRange(src, day('2026-07-10'), day('2026-07-20'))
    expect(r).not.toBeNull()
    expect(r!.hi).toBeGreaterThan(0)
  })

  it('floors a dead-flat span instead of zooming into float noise', () => {
    const flow = buildFlow([
      T({ id: 1, period: '2026-07-01', type: 'Income', amount: 4000, account: 'Bank' }),
      T({ id: 2, period: '2026-08-01', amount: 100 }),
    ])
    // A quiet stretch: every connector point sits at the same carried balance.
    const r = flowYRange(buildFlowYSource(flow, null), day('2026-07-10'), day('2026-07-20'))!
    expect(r.hi - r.lo).toBeGreaterThan(0)
  })

  it('returns null when the window holds nothing', () => {
    const flow = buildFlow([T({ period: '2026-07-10' })])
    const src = buildFlowYSource(flow, null)
    expect(flowYRange(src, day('2020-01-01'), day('2020-02-01'))).toBeNull()
  })

  it('survives the empty ledger', () => {
    const src = buildFlowYSource(EMPTY_FLOW, null)
    expect(src.bars).toHaveLength(0)
    expect(flowYRange(src, 0, 1e12)).toBeNull()
  })
})

describe('flowDefaultRange / flowDataBounds', () => {
  const flow = buildFlow([
    T({ id: 1, period: '2026-06-01' }),
    T({ id: 2, period: '2026-07-10' }),
  ])

  it('opens on the last defaultDays plus the forecast', () => {
    const long = buildFlow([T({ id: 1, period: '2026-01-05' }), T({ id: 2, period: '2026-07-10' })])
    const r = flowDefaultRange(long, FC, 60)
    expect(r.x0).toBe(long.lastDay - 60 * MS_PER_DAY)
    expect(r.x1).toBe(day('2026-07-21') + MS_PER_DAY)
  })

  // On a young ledger the raw `lastDay - defaultDays` sits before the first
  // transaction. That wasted the left of the chart AND made the opening window
  // wider than flowDataBounds, so clampView re-centred it and the first pan or
  // zoom lurched sideways.
  it('never opens further back than the ledger itself', () => {
    // 39 days of history against a 60-day window.
    const r = flowDefaultRange(flow, FC, 60)
    expect(r.x0).toBe(flow.firstDay - MS_PER_DAY)
    expect(r.x0).toBeGreaterThan(flow.lastDay - 60 * MS_PER_DAY)
  })

  // The property that bug was really about: the opening window must be a fixed
  // point of the clamp, or the view jumps the moment it is touched.
  it('opens on a window clampView leaves alone', () => {
    for (const f of [flow, buildFlow([T({ id: 1, period: '2026-01-05' }), T({ id: 2, period: '2026-07-10' })])]) {
      const d = flowDefaultRange(f, FC, 60)
      const c = clampView(d, flowDataBounds(f, FC))
      expect(c.x0).toBeCloseTo(d.x0, 6)
      expect(c.x1).toBeCloseTo(d.x1, 6)
    }
  })

  it('ends at the last ledger day when there is no forecast', () => {
    expect(flowDefaultRange(flow, null, 60).x1).toBe(flow.lastDay + MS_PER_DAY)
  })

  it('bounds span the whole ledger, not just the opening window', () => {
    const b = flowDataBounds(flow, FC)
    expect(b.min).toBeLessThanOrEqual(flow.firstDay)
    expect(b.max).toBeGreaterThanOrEqual(day('2026-07-21'))
  })
})
