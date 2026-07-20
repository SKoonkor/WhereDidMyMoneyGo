import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { netWorth, netWorthTrend } from '../../lib/analytics/networth'
import { currentMonthKey, addMonths } from '../transactions/month'
import { buildNetWorthTrendFigure } from './figure'

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 0,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

const day = (monthKey: string) => `${monthKey}-05`

describe('netWorth', () => {
  it('sums signed amounts; transfers net to zero', () => {
    const rows = [
      T({ type: 'Income', amount: 5000 }),
      T({ type: 'Expense', amount: 1200 }),
      T({ type: 'Transfer-Out', amount: 500, account: 'Cash', category: 'Bank', transferId: 'a' }),
      T({ type: 'Transfer-In', amount: 500, account: 'Bank', category: 'Cash', transferId: 'a' }),
    ]
    expect(netWorth(rows)).toBe(3800) // 5000 − 1200; transfer cancels
  })
})

describe('netWorthTrend', () => {
  it('returns `months` cumulative points ending at the current month', () => {
    const now = currentMonthKey()
    const prev = addMonths(now, -1)
    const rows = [
      T({ period: day(prev), type: 'Income', amount: 1000 }),
      T({ period: day(now), type: 'Income', amount: 400 }),
      T({ period: day(now), type: 'Expense', amount: 100 }),
    ]
    const trend = netWorthTrend(rows, 6)
    expect(trend).toHaveLength(6)
    expect(trend[trend.length - 1].month).toBe(now)
    // Last point = whole-ledger net worth.
    expect(trend[trend.length - 1].value).toBe(netWorth(rows))
    // Second-to-last (prev month) only sees the 1000 income.
    expect(trend[trend.length - 2].value).toBe(1000)
    // Oldest points predate any transaction → 0.
    expect(trend[0].value).toBe(0)
  })
})

describe('buildNetWorthTrendFigure', () => {
  const points = [{ month: '2026-06', value: 100 }, { month: '2026-07', value: 300 }]
  const palette = { accent: '#1abc9c', muted: '#888', grid: '#333' }

  it('maps points to a filled line trace', () => {
    const fig = buildNetWorthTrendFigure(points, { labels: ['Jun', 'Jul'], palette, censor: false })
    expect(fig.data[0].y).toEqual([100, 300])
    expect(fig.data[0].x).toEqual(['Jun', 'Jul'])
    expect(fig.data[0].fill).toBe('tozeroy')
    expect((fig.layout.yaxis as { showticklabels: boolean }).showticklabels).toBe(true)
  })

  it('hides values when censored', () => {
    const fig = buildNetWorthTrendFigure(points, { labels: ['Jun', 'Jul'], palette, censor: true })
    expect((fig.layout.yaxis as { showticklabels: boolean }).showticklabels).toBe(false)
    expect(fig.data[0].hovertemplate).not.toContain('%{y')
  })
})
