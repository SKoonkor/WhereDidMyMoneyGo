import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import type { Forecast } from '../../lib/analytics/forecast'
import { buildFlow, EMPTY_FLOW } from '../../lib/analytics/moneyflow'
import { pickFlowPoint, flowDayMs } from './readout'

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
  it('snaps to the nearest day', () => {
    // A third of the way into the 10th still reads as the 10th.
    const p = pickFlowPoint(FLOW, null, flowDayMs('2026-07-10') + MS_PER_DAY / 3)!
    expect(p.dateIso).toBe('2026-07-10')
  })

  it('lists every transaction on the picked day', () => {
    const p = pickFlowPoint(FLOW, null, flowDayMs('2026-07-10'))!
    expect(p.txns.map((x) => x.category).sort()).toEqual(['Food', 'Transport'])
    expect(p.isForecast).toBe(false)
    expect(p.band).toBeNull()
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
