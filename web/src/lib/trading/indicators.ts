// Streaming indicators.
//
// Every one of these is incremental — O(1) per bar, writing into a Float64Array
// ring that is aligned to the series, because the chart walks a few hundred bars
// every frame and re-deriving a 200-period EMA from scratch on each tick would
// put the whole indicator set on the render loop's critical path.
//
// `amend(v)` is the non-obvious half of the interface, and the reason this file
// is written the way it is. The forming candle's close changes several times a
// second; a naive `push` per tick would fold every intermediate price into the
// average permanently, and an EMA would drift away from the closes it claims to
// average within a minute of watching. So every indicator keeps an UNDO of its
// most recent commit — scalars only, no allocation — and `amend` is exactly
// "roll the last commit back, then commit this value instead". The invariant the
// tests pin is: amend·amend·…·push(final) === push(final) alone.
//
// Nothing here imports from lib/chart/. The seam is structural: a layer receives
// a Float64Array of values and never learns what produced them.

/** A single-output indicator over a stream of prices. */
export interface Indicator {
  /** Ring aligned to the series: the value for push #n lives at (n-1) % out.length.
   *  NaN until the indicator has warmed up. */
  readonly out: Float64Array
  readonly period: number
  /** How many samples have been pushed. */
  readonly count: number
  /** Newest output, or NaN before warm-up. */
  readonly last: number
  push(v: number): number
  /** Replace the newest sample. Equivalent to never having pushed it. */
  amend(v: number): number
  reset(): void
}

export interface IndicatorSpec {
  id: string
  kind: 'sma' | 'ema' | 'rsi' | 'macd' | 'bb' | 'vwap'
  period: number
  color: string
  pane: 'main' | 'sub'
}

function ringOf(cap: number): Float64Array {
  const a = new Float64Array(Math.max(1, Math.floor(cap)))
  a.fill(NaN)
  return a
}

const periodOf = (p: number) => Math.max(1, Math.floor(p))

// ── Simple moving average ────────────────────────────────────────────────────

export function sma(period: number, cap: number): Indicator {
  const p = periodOf(period)
  const out = ringOf(cap)
  const win = new Float64Array(p)
  let n = 0
  let sum = 0

  // Undo of the most recent commit. Scalars, held on the closure — an object
  // here would allocate once per tick per indicator, which at eight indicators
  // and four ticks a second is exactly the GC churn C.1 forbids.
  let uN = 0
  let uSum = 0
  let uWin = 0
  let uOut = NaN
  let canUndo = false

  function commit(v: number): number {
    const slot = n % p
    uN = n
    uSum = sum
    uWin = win[slot]
    uOut = out[n % out.length]
    // Only subtract the evicted sample once the window is actually full;
    // before that `win[slot]` is a zero that was never part of the sum.
    sum += v - (n >= p ? uWin : 0)
    win[slot] = v
    n++
    const val = n >= p ? sum / p : NaN
    out[(n - 1) % out.length] = val
    canUndo = true
    return val
  }

  function rollback(): void {
    if (!canUndo) return
    n = uN
    sum = uSum
    win[uN % p] = uWin
    out[uN % out.length] = uOut
    canUndo = false
  }

  return {
    out,
    period: p,
    get count() {
      return n
    },
    get last() {
      return n > 0 ? out[(n - 1) % out.length] : NaN
    },
    push: commit,
    amend(v: number) {
      rollback()
      return commit(v)
    },
    reset() {
      n = 0
      sum = 0
      canUndo = false
      win.fill(0)
      out.fill(NaN)
    },
  }
}

// ── Exponential moving average ───────────────────────────────────────────────

/** The EMA state machine without an output ring, so MACD can hold three of them
 *  and roll all three back as one unit. */
interface EmaCore {
  /** NaN until `period` samples have been seen. */
  readonly value: number
  readonly ready: boolean
  push(v: number): number
  rollback(): void
  reset(): void
}

function emaCore(period: number): EmaCore {
  const p = periodOf(period)
  const k = 2 / (p + 1)
  let val = NaN
  let seed = 0
  let n = 0

  let uVal = NaN
  let uSeed = 0
  let uN = 0
  let canUndo = false

  return {
    get value() {
      return val
    },
    get ready() {
      return n >= p
    },
    push(v: number) {
      uVal = val
      uSeed = seed
      uN = n
      canUndo = true
      n++
      if (n < p) {
        // Seeded with the simple average of the first `period` samples, which is
        // what every charting package does; seeding with the first price instead
        // leaves a visible hook at the left edge of the line.
        seed += v
        val = NaN
      } else if (n === p) {
        seed += v
        val = seed / p
      } else {
        val = v * k + val * (1 - k)
      }
      return val
    },
    rollback() {
      if (!canUndo) return
      val = uVal
      seed = uSeed
      n = uN
      canUndo = false
    },
    reset() {
      val = NaN
      seed = 0
      n = 0
      canUndo = false
    },
  }
}

export function ema(period: number, cap: number): Indicator {
  const p = periodOf(period)
  const out = ringOf(cap)
  const core = emaCore(p)
  let n = 0
  let uOut = NaN
  let canUndo = false

  function commit(v: number): number {
    uOut = out[n % out.length]
    const val = core.push(v)
    n++
    out[(n - 1) % out.length] = val
    canUndo = true
    return val
  }

  return {
    out,
    period: p,
    get count() {
      return n
    },
    get last() {
      return n > 0 ? out[(n - 1) % out.length] : NaN
    },
    push: commit,
    amend(v: number) {
      if (canUndo) {
        core.rollback()
        n--
        out[n % out.length] = uOut
        canUndo = false
      }
      return commit(v)
    },
    reset() {
      core.reset()
      n = 0
      canUndo = false
      out.fill(NaN)
    },
  }
}

// ── Relative strength index (Wilder) ─────────────────────────────────────────

export function rsi(period: number, cap: number): Indicator {
  const p = periodOf(period)
  const out = ringOf(cap)
  let n = 0 // samples pushed
  let d = 0 // deltas seen
  let prev = NaN
  let avgG = 0
  let avgL = 0

  let uN = 0
  let uD = 0
  let uPrev = NaN
  let uG = 0
  let uL = 0
  let uOut = NaN
  let canUndo = false

  function level(): number {
    // A run with no down-closes has zero average loss: RSI is 100, not a
    // division by zero. Guarding this is why a monotone rise reads 100 rather
    // than NaN — and a NaN here silently blanks the whole sub-pane.
    if (avgL === 0) return avgG === 0 ? 50 : 100
    const rs = avgG / avgL
    return 100 - 100 / (1 + rs)
  }

  function commit(v: number): number {
    uN = n
    uD = d
    uPrev = prev
    uG = avgG
    uL = avgL
    uOut = out[n % out.length]
    canUndo = true

    let val = NaN
    if (n === 0) {
      prev = v
    } else {
      const delta = v - prev
      const g = delta > 0 ? delta : 0
      const l = delta < 0 ? -delta : 0
      d++
      if (d < p) {
        // Accumulating into the same fields the smoother uses keeps the state to
        // two numbers; they only become averages on the seeding delta.
        avgG += g
        avgL += l
      } else if (d === p) {
        avgG = (avgG + g) / p
        avgL = (avgL + l) / p
        val = level()
      } else {
        avgG = (avgG * (p - 1) + g) / p
        avgL = (avgL * (p - 1) + l) / p
        val = level()
      }
      prev = v
    }
    n++
    out[(n - 1) % out.length] = val
    return val
  }

  return {
    out,
    period: p,
    get count() {
      return n
    },
    get last() {
      return n > 0 ? out[(n - 1) % out.length] : NaN
    },
    push: commit,
    amend(v: number) {
      if (canUndo) {
        n = uN
        d = uD
        prev = uPrev
        avgG = uG
        avgL = uL
        out[uN % out.length] = uOut
        canUndo = false
      }
      return commit(v)
    },
    reset() {
      n = 0
      d = 0
      prev = NaN
      avgG = 0
      avgL = 0
      canUndo = false
      out.fill(NaN)
    },
  }
}

// ── MACD ─────────────────────────────────────────────────────────────────────

export interface MacdIndicator {
  readonly macd: Float64Array
  readonly signal: Float64Array
  readonly hist: Float64Array
  readonly count: number
  push(v: number): void
  amend(v: number): void
  reset(): void
}

export function macd(fast: number, slow: number, signal: number, cap: number): MacdIndicator {
  const f = emaCore(fast)
  const s = emaCore(slow)
  const g = emaCore(signal)
  const mOut = ringOf(cap)
  const sOut = ringOf(cap)
  const hOut = ringOf(cap)
  let n = 0

  let uM = NaN
  let uS = NaN
  let uH = NaN
  let uFedSignal = false
  let canUndo = false

  function commit(v: number): void {
    uM = mOut[n % mOut.length]
    uS = sOut[n % sOut.length]
    uH = hOut[n % hOut.length]
    f.push(v)
    s.push(v)
    const line = f.ready && s.ready ? f.value - s.value : NaN
    // The signal line is an EMA of the MACD line, so it must not be fed until
    // the MACD line exists. Feeding it NaN once poisons it forever, and feeding
    // it a zero puts a fake crossover in the first bars.
    uFedSignal = Number.isFinite(line)
    const sig = uFedSignal ? g.push(line) : NaN
    n++
    const i = (n - 1) % mOut.length
    mOut[i] = line
    sOut[i] = sig
    hOut[i] = Number.isFinite(line) && Number.isFinite(sig) ? line - sig : NaN
    canUndo = true
  }

  return {
    macd: mOut,
    signal: sOut,
    hist: hOut,
    get count() {
      return n
    },
    push: commit,
    amend(v: number) {
      if (canUndo) {
        if (uFedSignal) g.rollback()
        s.rollback()
        f.rollback()
        n--
        const i = n % mOut.length
        mOut[i] = uM
        sOut[i] = uS
        hOut[i] = uH
        canUndo = false
      }
      commit(v)
    },
    reset() {
      f.reset()
      s.reset()
      g.reset()
      n = 0
      canUndo = false
      mOut.fill(NaN)
      sOut.fill(NaN)
      hOut.fill(NaN)
    },
  }
}

// ── Bollinger bands ──────────────────────────────────────────────────────────

export interface BollingerIndicator {
  readonly mid: Float64Array
  readonly up: Float64Array
  readonly lo: Float64Array
  readonly period: number
  readonly count: number
  push(v: number): void
  amend(v: number): void
  reset(): void
}

export function bollinger(period: number, k: number, cap: number): BollingerIndicator {
  const p = periodOf(period)
  const mid = ringOf(cap)
  const up = ringOf(cap)
  const lo = ringOf(cap)
  const win = new Float64Array(p)
  let n = 0
  let sum = 0
  let sumSq = 0

  let uN = 0
  let uSum = 0
  let uSumSq = 0
  let uWin = 0
  let uMid = NaN
  let uUp = NaN
  let uLo = NaN
  let canUndo = false

  function commit(v: number): void {
    const slot = n % p
    uN = n
    uSum = sum
    uSumSq = sumSq
    uWin = win[slot]
    const i0 = n % mid.length
    uMid = mid[i0]
    uUp = up[i0]
    uLo = lo[i0]

    const evicted = n >= p ? uWin : 0
    sum += v - evicted
    sumSq += v * v - evicted * evicted
    win[slot] = v
    n++

    const i = (n - 1) % mid.length
    if (n >= p) {
      const m = sum / p
      // Population variance, which is what every charting package uses for
      // Bollinger; the sample variance would widen the bands by ~4% at period 20
      // and put the price outside them noticeably more often.
      const varr = Math.max(0, sumSq / p - m * m)
      const sd = Math.sqrt(varr)
      mid[i] = m
      up[i] = m + k * sd
      lo[i] = m - k * sd
    } else {
      mid[i] = NaN
      up[i] = NaN
      lo[i] = NaN
    }
    canUndo = true
  }

  return {
    mid,
    up,
    lo,
    period: p,
    get count() {
      return n
    },
    push: commit,
    amend(v: number) {
      if (canUndo) {
        n = uN
        sum = uSum
        sumSq = uSumSq
        win[uN % p] = uWin
        const i = uN % mid.length
        mid[i] = uMid
        up[i] = uUp
        lo[i] = uLo
        canUndo = false
      }
      commit(v)
    },
    reset() {
      n = 0
      sum = 0
      sumSq = 0
      canUndo = false
      win.fill(0)
      mid.fill(NaN)
      up.fill(NaN)
      lo.fill(NaN)
    },
  }
}

// ── VWAP ─────────────────────────────────────────────────────────────────────

export interface VwapIndicator {
  readonly out: Float64Array
  readonly count: number
  readonly last: number
  push(p: number, v: number, sessionStart: boolean): number
  /** Re-price the forming bar. `sessionStart` must match the pushed value's, or
   *  the accumulator that was reset cannot be put back. */
  amend(p: number, v: number, sessionStart: boolean): number
  reset(): void
}

export function vwap(cap: number): VwapIndicator {
  const out = ringOf(cap)
  let pv = 0
  let vol = 0
  let n = 0

  let uPv = 0
  let uVol = 0
  let uOut = NaN
  let canUndo = false

  function commit(p: number, v: number, sessionStart: boolean): number {
    uPv = pv
    uVol = vol
    uOut = out[n % out.length]
    if (sessionStart) {
      // VWAP is a session statistic — carrying yesterday's accumulator across
      // the open makes the line stick to the previous day's value for hours.
      pv = 0
      vol = 0
    }
    pv += p * v
    vol += v
    n++
    const val = vol > 0 ? pv / vol : NaN
    out[(n - 1) % out.length] = val
    canUndo = true
    return val
  }

  return {
    out,
    get count() {
      return n
    },
    get last() {
      return n > 0 ? out[(n - 1) % out.length] : NaN
    },
    push: commit,
    amend(p: number, v: number, sessionStart: boolean) {
      if (canUndo) {
        pv = uPv
        vol = uVol
        n--
        out[n % out.length] = uOut
        canUndo = false
      }
      return commit(p, v, sessionStart)
    },
    reset() {
      pv = 0
      vol = 0
      n = 0
      canUndo = false
      out.fill(NaN)
    },
  }
}

// ── Average true range (Wilder) ──────────────────────────────────────────────

export interface AtrIndicator {
  readonly out: Float64Array
  readonly period: number
  readonly count: number
  readonly last: number
  push(h: number, l: number, c: number): number
  amend(h: number, l: number, c: number): number
  reset(): void
}

export function atr(period: number, cap: number): AtrIndicator {
  const p = periodOf(period)
  const out = ringOf(cap)
  let n = 0
  let prevC = NaN
  let acc = 0 // TR sum while seeding, then the ATR itself

  let uN = 0
  let uPrevC = NaN
  let uAcc = 0
  let uOut = NaN
  let canUndo = false

  function commit(h: number, l: number, c: number): number {
    uN = n
    uPrevC = prevC
    uAcc = acc
    uOut = out[n % out.length]
    canUndo = true

    // The first bar has no previous close, so its true range is just the bar's
    // own range. Using 0 instead would drag the first ATR reading down for a
    // whole period.
    const tr = n === 0
      ? h - l
      : Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC))
    n++
    let val = NaN
    if (n < p) {
      acc += tr
    } else if (n === p) {
      acc = (acc + tr) / p
      val = acc
    } else {
      acc = (acc * (p - 1) + tr) / p
      val = acc
    }
    prevC = c
    out[(n - 1) % out.length] = val
    return val
  }

  return {
    out,
    period: p,
    get count() {
      return n
    },
    get last() {
      return n > 0 ? out[(n - 1) % out.length] : NaN
    },
    push: commit,
    amend(h: number, l: number, c: number) {
      if (canUndo) {
        n = uN
        prevC = uPrevC
        acc = uAcc
        out[uN % out.length] = uOut
        canUndo = false
      }
      return commit(h, l, c)
    },
    reset() {
      n = 0
      prevC = NaN
      acc = 0
      canUndo = false
      out.fill(NaN)
    },
  }
}
