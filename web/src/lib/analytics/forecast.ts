// Money-flow forecasting — a browser port of src/analytics/forecast.py.
//
// Daily income and expense are each modelled as a harmonic regression
// [intercept, linear trend, weekly + monthly Fourier terms] fitted by
// exponentially time-decayed weighted least squares so recent behaviour
// dominates. The future cumulative balance is projected from the current net
// worth, with 50% / 90% bands that widen with the horizon (from both income and
// expense volatility).
//
// The Python fit used statsmodels WLS; here WLS is solved directly from the
// normal equations (a small Gauss–Jordan inverse), so there is no heavy
// dependency and the whole thing runs on-device. The model is refit from the
// ledger on demand rather than persisted — it is cheap for a personal ledger.
import { signedAmount } from '../balances'
import type { Txn } from '../../db'

const WEEKLY = 7.0
const MONTHLY = 30.44
const ANNUAL = 365.25

export interface Harmonics {
  weekly: number
  monthly: number
  annual: number
}
export interface ForecastCfg {
  halfLifeDays: number
  harmonics: Harmonics
}
export const DEFAULT_CFG: ForecastCfg = {
  halfLifeDays: 120,
  harmonics: { weekly: 2, monthly: 2, annual: 0 },
}

// Normal quantiles for the two uncertainty bands (mirrors forecast.py `_Z`).
const Z50 = 0.6745
const Z90 = 1.6449

// ── Small dense linear algebra (fixed, ~10×10 at most) ───────────────────────

// Invert a square matrix by Gauss–Jordan elimination with partial pivoting.
function invert(a: number[][]): number[][] {
  const n = a.length
  // Work on [A | I].
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    // Pivot: largest magnitude in this column at/below the diagonal.
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r
    if (Math.abs(m[piv][col]) < 1e-12) throw new Error('singular matrix')
    ;[m[col], m[piv]] = [m[piv], m[col]]
    const d = m[col][col]
    for (let j = 0; j < 2 * n; j++) m[col][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = m[r][col]
      if (f === 0) continue
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j]
    }
  }
  return m.map((row) => row.slice(n))
}

const matVec = (a: number[][], v: number[]): number[] => a.map((row) => row.reduce((s, x, j) => s + x * v[j], 0))
const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0)

// ── Design matrix ────────────────────────────────────────────────────────────

// Columns [1, trend, weekly/monthly/annual Fourier] for day indices `t` (days
// since the fit start). Column order is fixed by `cfg` so fit and predict agree.
function designMatrix(t: number[], cfg: ForecastCfg): number[][] {
  const h = cfg.harmonics
  const bands: Array<[number, number]> = [
    [WEEKLY, h.weekly],
    [MONTHLY, h.monthly],
    [ANNUAL, h.annual],
  ]
  return t.map((ti) => {
    const cols = [1, ti / 365.0]
    for (const [period, count] of bands) {
      for (let k = 1; k <= count; k++) {
        const ang = (2.0 * Math.PI * k * ti) / period
        cols.push(Math.sin(ang), Math.cos(ang))
      }
    }
    return cols
  })
}

// ── Weighted least squares ───────────────────────────────────────────────────

interface Fit {
  coef: number[]
  cov: number[][] // scaled covariance of the coefficients
  sigma2: number // residual variance (WLS scale = weighted RSS / (n − p))
}

// Solve minₐ Σ wᵢ (yᵢ − Xᵢ·a)² from the normal equations XᵀWX a = XᵀWy.
// cov = σ²(XᵀWX)⁻¹, σ² = Σ wᵢ rᵢ² / (n − p) — matching statsmodels WLS.
function wls(X: number[][], y: number[], w: number[]): Fit {
  const n = X.length
  const p = X[0].length
  const xtwx: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
  const xtwy: number[] = new Array(p).fill(0)
  for (let i = 0; i < n; i++) {
    const wi = w[i]
    const row = X[i]
    for (let a = 0; a < p; a++) {
      const wr = wi * row[a]
      xtwy[a] += wr * y[i]
      for (let b = 0; b < p; b++) xtwx[a][b] += wr * row[b]
    }
  }
  const inv = invert(xtwx)
  const coef = matVec(inv, xtwy)
  let wrss = 0
  for (let i = 0; i < n; i++) {
    const r = y[i] - dot(X[i], coef)
    wrss += w[i] * r * r
  }
  const sigma2 = n > p ? wrss / (n - p) : 0
  const cov = inv.map((r) => r.map((v) => v * sigma2))
  return { coef, cov, sigma2 }
}

// ── Data helpers ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000
const dayNum = (iso: string): number => Math.round(new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime() / MS_PER_DAY)

// Daily-summed amounts for one type, 0-filled over the inclusive [start,end] day
// range (indices are days since `start`).
function dailySeries(txns: Txn[], type: 'Income' | 'Expense', start: number, end: number): number[] {
  const out = new Array(end - start + 1).fill(0)
  for (const t of txns) {
    if (t.type !== type) continue
    const d = dayNum(t.period) - start
    if (d >= 0 && d < out.length) out[d] += t.amount
  }
  return out
}

// ── Public forecast ──────────────────────────────────────────────────────────

export interface Forecast {
  dates: string[] // ISO days, anchor first
  median: number[]
  lo50: number[]
  hi50: number[]
  lo90: number[]
  hi90: number[]
  anchorDate: string
  anchorValue: number
}

const isoDay = (n: number): string => new Date(n * MS_PER_DAY).toISOString().slice(0, 10)

// Fit income & expense from the whole ledger and project the cumulative balance
// `horizonDays` into the future. The fan is anchored at today's net worth and
// begins the next day. Returns null when there is too little history to fit.
export function forecast(txns: Txn[], horizonDays = 30, cfg: ForecastCfg = DEFAULT_CFG): Forecast | null {
  if (txns.length === 0) return null
  const days = txns.map((t) => dayNum(t.period))
  const start = Math.min(...days)
  const end = Math.max(...days)
  const span = end - start
  // Need at least a couple of weeks and more days than parameters to fit.
  const p = designMatrix([0], cfg)[0].length
  if (span < 14 || span + 1 <= p) return null

  const t = Array.from({ length: span + 1 }, (_, i) => i)
  const X = designMatrix(t, cfg)
  // Most-recent day weight 1; older days decay by the half-life.
  const w = t.map((ti) => 0.5 ** ((span - ti) / cfg.halfLifeDays))

  const inc = wls(X, dailySeries(txns, 'Income', start, end), w)
  const exp = wls(X, dailySeries(txns, 'Expense', start, end), w)

  const anchorValue = netWorth(txns)
  const anchorIdx = span // today = last trained day
  const anchorDate = isoDay(start + anchorIdx)

  const futureT = Array.from({ length: horizonDays }, (_, i) => anchorIdx + 1 + i)
  const Xf = designMatrix(futureT, cfg)
  const muInc = matVec(Xf, inc.coef).map((v) => Math.max(v, 0))
  const muExp = matVec(Xf, exp.coef).map((v) => Math.max(v, 0))

  const dates = [anchorDate]
  const median = [anchorValue]
  const lo50 = [anchorValue]
  const hi50 = [anchorValue]
  const lo90 = [anchorValue]
  const hi90 = [anchorValue]

  let cum = anchorValue
  let residVar = 0
  const Sx = new Array(p).fill(0)
  for (let i = 0; i < horizonDays; i++) {
    cum += muInc[i] - muExp[i]
    residVar += inc.sigma2 + exp.sigma2
    for (let j = 0; j < p; j++) Sx[j] += Xf[i][j]
    const paramVar = quad(Sx, inc.cov) + quad(Sx, exp.cov)
    const sd = Math.sqrt(Math.max(0, residVar + paramVar))
    dates.push(isoDay(start + anchorIdx + 1 + i))
    median.push(cum)
    lo50.push(cum - Z50 * sd)
    hi50.push(cum + Z50 * sd)
    lo90.push(cum - Z90 * sd)
    hi90.push(cum + Z90 * sd)
  }

  return { dates, median, lo50, hi50, lo90, hi90, anchorDate, anchorValue }
}

// Net worth = Σ signed amount (transfers cancel across legs).
function netWorth(txns: Txn[]): number {
  return txns.reduce((s, t) => s + signedAmount(t.type, t.amount), 0)
}

// vᵀ M v — the parameter-variance quadratic form.
function quad(v: number[], m: number[][]): number {
  return dot(v, matVec(m, v))
}

// Exposed for tests.
export const _internal = { designMatrix, wls, invert }
