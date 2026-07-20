import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { netWorth, netWorthTrend } from '../../lib/analytics/networth'
import { buildNetWorthTrendFigure } from './figure'

const T = (over: Partial<Txn>): Txn => ({
  id: 0, period: '2026-07-10', account: 'Cash', amount: 0,
  type: 'Expense', category: 'Food', currency: 'THB', ...over,
})

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n: number) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return iso(d)
}

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
  it('returns one cumulative point per day, ending today', () => {
    const rows = [
      T({ period: daysAgo(30), type: 'Income', amount: 1000 }),
      T({ period: daysAgo(0), type: 'Expense', amount: 100 }),
    ]
    const trend = netWorthTrend(rows, 180)
    expect(trend).toHaveLength(180)
    expect(trend[179].date).toBe(daysAgo(0))
    expect(trend[179].value).toBe(netWorth(rows)) // last = whole-ledger net worth (900)
    // Day the income lands (30 days ago): +1000; the day before: still 0.
    const idx = trend.findIndex((p) => p.date === daysAgo(30))
    expect(trend[idx].value).toBe(1000)
    expect(trend[idx - 1].value).toBe(0)
    expect(trend[0].value).toBe(0)
  })

  it('folds transactions before the window into the baseline', () => {
    const trend = netWorthTrend([T({ period: daysAgo(400), type: 'Income', amount: 500 })], 180)
    expect(trend[0].value).toBe(500) // baseline carried into the first visible day
    expect(trend[179].value).toBe(500)
  })
})

describe('buildNetWorthTrendFigure', () => {
  const points = [{ date: '2026-06-01', value: 100 }, { date: '2026-07-01', value: 300 }]
  const palette = { accent: '#1abc9c', muted: '#888', grid: '#333' }

  it('maps points to a filled date line', () => {
    const fig = buildNetWorthTrendFigure(points, { palette, censor: false })
    expect(fig.data[0].y).toEqual([100, 300])
    expect(fig.data[0].x).toEqual(['2026-06-01', '2026-07-01'])
    expect(fig.data[0].mode).toBe('lines')
    expect(fig.data[0].fill).toBe('tozeroy')
    expect((fig.layout.xaxis as { type: string }).type).toBe('date')
    expect((fig.layout.yaxis as { showticklabels: boolean }).showticklabels).toBe(true)
  })

  it('hides values when censored', () => {
    const fig = buildNetWorthTrendFigure(points, { palette, censor: true })
    expect((fig.layout.yaxis as { showticklabels: boolean }).showticklabels).toBe(false)
    expect(fig.data[0].hovertemplate).not.toContain('%{y')
  })
})
