import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import type { Forecast } from '../../lib/analytics/forecast'
import { buildFlow, EMPTY_FLOW } from '../../lib/analytics/moneyflow'
import { pickFlowPoint, flowDayMs, flowDayCentreMs } from './readout'

const MS_PER_DAY = 86_400_000
const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 100,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

const FLOW = buildFlow([
  T({ id: 1, period: '2026-07-01', type: 'Income', amount: 5000, account: 'Bank', category: 'Salary' }),
  T({ id: 2, period: '2026-07-10', amount: 100, category: 'Food' }),
  T({ id: 3, period: '2026-07-10', amount: 250, category: 'Transport' }),
])

const FC: Forecast = {
  dates: ['2026-07-10', '2026-07-11', '2026-07-12'],
  median: [4650, 4600, 4550],
  lo50: [4650, 4500, 4400],
  hi50: [4650, 4700, 4700],
  lo90: [4650, 4000, 3900],
  hi90: [4650, 5200, 5300],
  anchorDate: '2026-07-10',
  anchorValue: 4650,
}

describe('pickFlowPoint', () => {
  it('snaps to the day the point falls in', () => {
    // Anywhere inside the 10th reads as the 10th — including the right-hand half,
    // which a Math.round snap used to push onto the 11th.
    for (const frac of [0.05, 1 / 3, 0.5, 0.75, 0.95]) {
      const p = pickFlowPoint(FLOW, null, flowDayMs('2026-07-10') + MS_PER_DAY * frac)!
      expect(p.dateIso).toBe('2026-07-10')
    }
  })

  it('lists every category on the picked day', () => {
    const p = pickFlowPoint(FLOW, null, flowDayMs('2026-07-10'))!
    expect(p.txns.map((x) => x.category).sort()).toEqual(['Food', 'Transport'])
    expect(p.txns.every((x) => x.count === 1)).toBe(true)
    expect(p.isForecast).toBe(false)
    expect(p.band).toBeNull()
  })

  it('combines transactions sharing a type and category', () => {
    const flow = buildFlow([
      T({ id: 1, period: '2026-07-10', amount: 100, category: 'Food' }),
      T({ id: 2, period: '2026-07-10', amount: 250, category: 'Food' }),
      T({ id: 3, period: '2026-07-10', amount: 40, category: 'Food', account: 'Card' }),
    ])
    const p = pickFlowPoint(flow, null, flowDayMs('2026-07-10'))!
    expect(p.txns).toHaveLength(1)
    // Combined across accounts too — the key is type+category, nothing else.
    expect(p.txns[0]).toEqual({ type: 'Expense', category: 'Food', amount: 390, count: 3 })
  })

  it('keeps the same category apart when the type differs', () => {
    const flow = buildFlow([
      T({ id: 1, period: '2026-07-10', type: 'Expense', amount: 100, category: 'Shared' }),
      T({ id: 2, period: '2026-07-10', type: 'Income', amount: 900, category: 'Shared', account: 'Bank' }),
    ])
    const p = pickFlowPoint(flow, null, flowDayMs('2026-07-10'))!
    expect(p.txns).toHaveLength(2)
    expect(p.txns.map((x) => x.type)).toEqual(['Income', 'Expense']) // amount-descending
  })

  it('returns the combined rows largest first', () => {
    const flow = buildFlow([
      T({ id: 1, period: '2026-07-10', amount: 20, category: 'Coffee' }),
      T({ id: 2, period: '2026-07-10', amount: 300, category: 'Rent' }),
      T({ id: 3, period: '2026-07-10', amount: 60, category: 'Coffee' }),
    ])
    const p = pickFlowPoint(flow, null, flowDayMs('2026-07-10'))!
    expect(p.txns.map((x) => [x.category, x.amount])).toEqual([['Rent', 300], ['Coffee', 80]])
  })

  // The key is built by concatenation, so a category that is a prefix of another
  // (or that contains the separator) must not be able to collide.
  it('does not collide categories that share a prefix', () => {
    const flow = buildFlow([
      T({ id: 1, period: '2026-07-10', amount: 10, category: 'Food' }),
      T({ id: 2, period: '2026-07-10', amount: 20, category: 'Food & Drink' }),
    ])
    const p = pickFlowPoint(flow, null, flowDayMs('2026-07-10'))!
    expect(p.txns).toHaveLength(2)
  })

  it('reports the balance carried into a quiet day', () => {
    const p = pickFlowPoint(FLOW, null, flowDayMs('2026-07-05'))!
    expect(p.txns).toHaveLength(0)
    expect(p.balance).toBe(5000) // the 1 Jul income, nothing since
  })

  it('returns the median and the INNER band on a forecast day', () => {
    const p = pickFlowPoint(FLOW, FC, flowDayMs('2026-07-12'))!
    expect(p.isForecast).toBe(true)
    expect(p.balance).toBe(4550)
    expect(p.band).toEqual({ lo: 4400, hi: 4700 })
    // Not the outer band, which is 3900/5300 on that day.
    expect(p.band!.lo).toBeGreaterThan(FC.lo90[2])
  })

  it('prefers the real record over the forecast where they overlap', () => {
    // The forecast anchors on the last ledger day; that day is history.
    const p = pickFlowPoint(FLOW, FC, flowDayMs('2026-07-10'))!
    expect(p.isForecast).toBe(false)
    expect(p.txns).toHaveLength(2)
  })

  it('returns null outside the data', () => {
    expect(pickFlowPoint(FLOW, null, flowDayMs('2020-01-01'))).toBeNull()
    expect(pickFlowPoint(FLOW, FC, flowDayMs('2027-01-01'))).toBeNull()
  })

  it('returns null for an empty ledger', () => {
    expect(pickFlowPoint(EMPTY_FLOW, null, flowDayMs('2026-07-10'))).toBeNull()
  })
})

describe('flowDayCentreMs', () => {
  // The crosshair used to sit on midnight, half a day left of the bars it was
  // pointing at: moneyflow.ts packs a day's bars across the day, not on its edge.
  it('is exactly half a day after the day start', () => {
    expect(flowDayCentreMs('2026-07-10') - flowDayMs('2026-07-10')).toBe(MS_PER_DAY / 2)
  })

  it('lands inside the span of that day\u2019s bars', () => {
    const bar = FLOW.bars.find((b) => b.date === '2026-07-10')!
    const centre = flowDayCentreMs('2026-07-10')
    expect(centre).toBeGreaterThan(flowDayMs('2026-07-10'))
    expect(centre).toBeLessThan(flowDayMs('2026-07-10') + MS_PER_DAY)
    // And the day it picks still round-trips back to the same date.
    expect(pickFlowPoint(FLOW, null, centre)!.dateIso).toBe(bar.date)
  })
})
