import { describe, it, expect } from 'vitest'
import type { Txn } from '../../db'
import { forecast, _internal } from './forecast'

const { invert, wls } = _internal

// Build a daily ledger: one Income and one Expense per day for `days` days,
// starting `days-1` days before today (so the last day is today).
function ledger(days: number, income: number, expense: number): Txn[] {
  const out: Txn[] = []
  let id = 1
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10)
    out.push({ id: id++, period: d, account: 'Cash', amount: income, type: 'Income', category: 'Salary', currency: 'THB' })
    out.push({ id: id++, period: d, account: 'Cash', amount: expense, type: 'Expense', category: 'Food', currency: 'THB' })
  }
  return out
}

describe('linear algebra', () => {
  it('inverts a matrix (A·A⁻¹ = I)', () => {
    const A = [
      [4, 3, 0],
      [3, 4, -1],
      [0, -1, 4],
    ]
    const inv = invert(A)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const dot = A[i].reduce((s, x, k) => s + x * inv[k][j], 0)
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 9)
      }
  })
})

describe('wls', () => {
  it('recovers the exact line through noiseless data (σ²≈0)', () => {
    const X = [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ]
    const y = [5, 7, 9, 11] // 5 + 2·t
    const w = [1, 1, 1, 1]
    const fit = wls(X, y, w)
    expect(fit.coef[0]).toBeCloseTo(5, 9)
    expect(fit.coef[1]).toBeCloseTo(2, 9)
    expect(fit.sigma2).toBeCloseTo(0, 9)
  })

  it('recency weights pull the fit toward recent points', () => {
    // Level shifts up at the end; a heavily down-weighted past drags the
    // intercept-at-last-point estimate upward vs. equal weights.
    const X = [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]]
    const y = [0, 0, 0, 10, 10]
    const equal = wls(X, y, [1, 1, 1, 1, 1]).coef
    const recent = wls(X, y, [0.1, 0.2, 0.4, 0.8, 1]).coef
    const at4 = (c: number[]) => c[0] + c[1] * 4
    expect(at4(recent)).toBeGreaterThan(at4(equal))
  })
})

describe('forecast', () => {
  it('returns null when history is too short', () => {
    expect(forecast(ledger(5, 100, 60), 30)).toBeNull()
  })

  it('anchors at current net worth and widens its bands with the horizon', () => {
    const txns = ledger(60, 100, 60) // net +40/day × 60 days = 2400
    const fc = forecast(txns, 30)
    expect(fc).not.toBeNull()
    if (!fc) return
    expect(fc.median[0]).toBeCloseTo(2400, 6) // day 0 = today's net worth
    expect(fc.anchorValue).toBeCloseTo(2400, 6)
    expect(fc.dates).toHaveLength(31) // anchor + 30 days

    // The 90% band is nested outside the 50% band, and both fan out over time.
    for (let i = 1; i < fc.median.length; i++) {
      expect(fc.hi90[i]).toBeGreaterThanOrEqual(fc.hi50[i])
      expect(fc.lo90[i]).toBeLessThanOrEqual(fc.lo50[i])
    }
    const width = (i: number) => fc.hi90[i] - fc.lo90[i]
    expect(width(30)).toBeGreaterThan(width(1))
  })

  it('projects the net-worth drift roughly forward (steady surplus rises)', () => {
    const fc = forecast(ledger(90, 100, 60), 30)
    expect(fc).not.toBeNull()
    if (!fc) return
    // A steady +40/day surplus should keep the median trending upward.
    expect(fc.median[fc.median.length - 1]).toBeGreaterThan(fc.median[0])
  })
})
