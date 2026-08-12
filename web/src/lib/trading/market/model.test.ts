import { describe, it, expect } from 'vitest'
import { createMarket, PRESETS } from './model'
import type { MarketParams } from './model'
import { createRng } from '../rng'
import { TICK_QUANTUM_MS } from '../types'
import type { SimTime, Px, Qty, TickSink } from '../types'

const Q = TICK_QUANTUM_MS

class Recorder implements TickSink {
  readonly t: number[] = []
  readonly p: number[] = []
  readonly q: number[] = []
  readonly s: number[] = []
  onTick(t: SimTime, p: Px, qty: Qty, side: 1 | -1): void {
    this.t.push(t)
    this.p.push(p)
    this.q.push(qty)
    this.s.push(side)
  }
}

/** Counts and watches, but keeps nothing — for the long runs where holding a few
 *  million ticks is the only thing that would make the test slow. */
class Watcher implements TickSink {
  n = 0
  bad = 0
  min = Infinity
  max = -Infinity
  onTick(_t: SimTime, p: Px, q: Qty, _s: 1 | -1): void {
    this.n++
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(q) || q <= 0) this.bad++
    if (p < this.min) this.min = p
    if (p > this.max) this.max = p
  }
}

const PRESET_NAMES = Object.keys(PRESETS) as (keyof typeof PRESETS)[]

describe('deterministic replay', () => {
  it('produces a bit-identical tick stream however the time was sliced', () => {
    const T = 4_000 * Q

    const one = new Recorder()
    createMarket(PRESETS.btc).advanceTo(T, one)

    const many = new Recorder()
    const m = createMarket(PRESETS.btc)
    const rng = createRng('slices')
    let t = 0
    let calls = 0
    while (t < T) {
      // Ragged, and deliberately mostly sub-quantum: a slicing that never lands
      // on a boundary is exactly what a 60fps frame loop produces.
      t = Math.min(T, t + rng.u() * 2 * (T / 1000))
      m.advanceTo(t, many)
      calls++
    }
    m.advanceTo(T, many)

    expect(calls).toBeGreaterThan(800)
    expect(many.t.length).toBe(one.t.length)
    expect(many.t.length).toBeGreaterThan(1_000)
    expect(many.t).toEqual(one.t)
    expect(many.p).toEqual(one.p)
    expect(many.q).toEqual(one.q)
    expect(many.s).toEqual(one.s)
  })

  it('survives a snapshot, a JSON round trip and a restore', () => {
    const half = 500 * Q
    const full = 1_000 * Q

    const straight = createMarket(PRESETS.eth)
    straight.advanceTo(half, new Watcher())
    const mid = JSON.parse(JSON.stringify(straight.snapshot()))
    const rest = new Recorder()
    straight.advanceTo(full, rest)

    const restored = createMarket(PRESETS.eth, mid)
    const after = new Recorder()
    restored.advanceTo(full, after)

    expect(after.t.length).toBeGreaterThan(100)
    expect(after.t).toEqual(rest.t)
    expect(after.p).toEqual(rest.p)
    expect(after.q).toEqual(rest.q)
    expect(after.s).toEqual(rest.s)
    expect(restored.snapshot()).toEqual(straight.snapshot())
  })

  it('restores through reset() as well as through the constructor', () => {
    const a = createMarket(PRESETS.forex)
    a.advanceTo(300 * Q, new Watcher())
    const saved = JSON.parse(JSON.stringify(a.snapshot()))

    const b = createMarket(PRESETS.forex)
    b.advanceTo(9_999 * Q, new Watcher())
    b.reset(saved)

    const x = new Recorder()
    const y = new Recorder()
    a.advanceTo(600 * Q, x)
    b.advanceTo(600 * Q, y)
    expect(y.p).toEqual(x.p)
    expect(b.snapshot()).toEqual(a.snapshot())
  })

  it('gives two engines on the same seed the same world', () => {
    const a = new Recorder()
    const b = new Recorder()
    createMarket(PRESETS.meme).advanceTo(500 * Q, a)
    createMarket(PRESETS.meme).advanceTo(500 * Q, b)
    expect(b.p).toEqual(a.p)
  })

  it('gives two engines on different seeds different worlds', () => {
    const a = new Recorder()
    const b = new Recorder()
    createMarket(PRESETS.btc).advanceTo(500 * Q, a)
    createMarket({ ...PRESETS.btc, seed: 'other' }).advanceTo(500 * Q, b)
    expect(b.p).not.toEqual(a.p)
  })
})

describe('the quantum boundary', () => {
  it('starts at t0 with nothing advanced', () => {
    const m = createMarket(PRESETS.btc)
    expect(m.now()).toBe(0)
    expect(m.snapshot().quanta).toBe(0)
  })

  it('does not consume a partial quantum', () => {
    const m = createMarket(PRESETS.btc)
    m.advanceTo(Q - 1, new Watcher())
    expect(m.now()).toBe(0)
    m.advanceTo(Q, new Watcher())
    expect(m.now()).toBe(Q)
    m.advanceTo(2 * Q - 1, new Watcher())
    expect(m.now()).toBe(Q)
  })

  it('is a no-op when asked to go backwards', () => {
    const m = createMarket(PRESETS.btc)
    m.advanceTo(100 * Q, new Watcher())
    const before = m.snapshot()
    const w = new Watcher()
    expect(m.advanceTo(50 * Q, w)).toBe(0)
    expect(w.n).toBe(0)
    expect(m.snapshot()).toEqual(before)
  })

  it('reports the ticks it emitted', () => {
    const m = createMarket(PRESETS.btc)
    const w = new Watcher()
    const n = m.advanceTo(400 * Q, w)
    expect(n).toBe(w.n)
    expect(n).toBeGreaterThan(0)
  })

  it('emits ticks inside the quantum it advanced through, in order', () => {
    const m = createMarket(PRESETS.btc)
    const r = new Recorder()
    m.advanceTo(200 * Q, r)
    for (let i = 1; i < r.t.length; i++) expect(r.t[i]).toBeGreaterThanOrEqual(r.t[i - 1])
    expect(r.t[0]).toBeGreaterThanOrEqual(0)
    expect(r.t[r.t.length - 1]).toBeLessThan(200 * Q)
    expect(new Set(r.s).size).toBe(2)
  })
})

describe('the quote and the book', () => {
  it('returns the same objects each call rather than allocating in the loop', () => {
    const m = createMarket(PRESETS.btc)
    m.advanceTo(100 * Q, new Watcher())
    expect(m.quote()).toBe(m.quote())
    expect(m.book()).toBe(m.book())
    expect(m.book().bids[0]).toBe(m.book().bids[0])
  })

  it('marks against the index, never against the last print', () => {
    const m = createMarket(PRESETS.btc)
    m.advanceTo(2_000 * Q, new Watcher())
    const q = m.quote()
    expect(q.indexPrice).toBeGreaterThan(0)
    // Within half a percent of the index by construction, which is what stops a
    // thin book being pushed through someone's liquidation price.
    expect(Math.abs(q.markPrice / q.indexPrice - 1)).toBeLessThanOrEqual(0.005 + 1e-12)
    expect(q.bid).toBeLessThan(q.ask)
  })

  it('keeps the 24h window bracketing the last price', () => {
    const m = createMarket(PRESETS.btc)
    m.advanceTo(20_000 * Q, new Watcher())
    const q = m.quote()
    expect(q.high24h).toBeGreaterThanOrEqual(q.last)
    expect(q.low24h).toBeLessThanOrEqual(q.last)
    expect(q.volume24h).toBeGreaterThan(0)
    expect(q.open24h).toBeGreaterThan(0)
  })

  it('rolls the 24h window once a day has passed', () => {
    const m = createMarket(PRESETS.btc)
    m.advanceTo(3_600_000, new Watcher())
    const v1 = m.quote().volume24h
    m.advanceTo(25 * 3_600_000, new Watcher())
    const q = m.quote()
    expect(v1).toBeGreaterThan(0)
    // A fresh session, so the day's volume is small again rather than cumulative.
    expect(q.volume24h).toBeLessThan(v1 * 2)
  })

  it('walks its own depth for a fill', () => {
    const m = createMarket(PRESETS.btc)
    m.advanceTo(1_000 * Q, new Watcher())
    const b = m.book()
    const big = b.asks.reduce((s, l) => s + l.q, 0) * 2
    expect(m.fillPrice('buy', 0.001)).toBeCloseTo(b.asks[0].p, 9)
    expect(m.fillPrice('buy', big)).toBeGreaterThan(b.asks[0].p)
    expect(m.fillPrice('sell', big)).toBeLessThan(b.bids[0].p)
    expect(m.fillPrice('buy', big)).toBeGreaterThan(m.fillPrice('sell', big))
  })

  it('does not draw random numbers when the book is read', () => {
    // Reading the book on a UI cadence must not shift the simulation, or how
    // often someone opens the depth panel would change the prices.
    const a = createMarket(PRESETS.btc)
    const b = createMarket(PRESETS.btc)
    const ra = new Recorder()
    const rb = new Recorder()
    for (let k = 1; k <= 200; k++) {
      a.advanceTo(k * 10 * Q, ra)
      b.advanceTo(k * 10 * Q, rb)
      b.book()
      b.quote()
      b.fillPrice('buy', 1)
    }
    expect(rb.p).toEqual(ra.p)
  })
})

describe('every preset', () => {
  it('names itself and prices itself sanely', () => {
    for (const name of PRESET_NAMES) {
      const p: MarketParams = PRESETS[name]
      expect(p.symbol.length).toBeGreaterThan(2)
      expect(p.p0).toBeGreaterThan(0)
      expect(p.tickSize).toBeGreaterThan(0)
      // Non-stationary GARCH has no unconditional variance to revert to, and the
      // series ramps away over hours rather than failing outright.
      expect(p.garch.alpha + p.garch.beta).toBeLessThan(1)
      expect(p.garch.omega).toBeGreaterThan(0)
      expect(p.book.imbalanceGain).toBeLessThan(1)
      if (p.seasonality) {
        expect(p.seasonality.length).toBe(48)
        const mean = p.seasonality.reduce((s, v) => s + v, 0) / 48
        expect(mean).toBeCloseTo(1, 9)
      }
    }
  })

  it(
    'stays finite and positive over a million quanta',
    { timeout: 180_000 },
    () => {
      for (const name of PRESET_NAMES) {
        const p = PRESETS[name]
        const m = createMarket(p)
        const w = new Watcher()
        m.advanceTo(1_000_000 * Q, w)

        expect(w.n, name).toBeGreaterThan(0)
        expect(w.bad, name).toBe(0)
        expect(Number.isFinite(w.min) && w.min > 0, name).toBe(true)
        expect(Number.isFinite(w.max), name).toBe(true)

        const q = m.quote()
        for (const v of [q.last, q.bid, q.ask, q.markPrice, q.indexPrice, q.high24h, q.low24h]) {
          expect(Number.isFinite(v), name).toBe(true)
          expect(v, name).toBeGreaterThan(0)
        }
        const st = m.snapshot()
        expect(Number.isFinite(st.logP) && Number.isFinite(st.sigma2), name).toBe(true)
        expect(st.sigma2, name).toBeGreaterThan(0)
        // The guard rails are meant to be generous, not binding: a preset that
        // spends a million quanta pinned to its clamp is a preset with bad
        // parameters, and the clamp would be hiding it.
        expect(Math.abs(Math.log(q.indexPrice / p.p0)), name).toBeLessThan(19)

        const b = m.book()
        for (let i = 1; i < b.bids.length; i++) {
          expect(b.bids[i].p, name).toBeLessThan(b.bids[i - 1].p)
          expect(b.asks[i].p, name).toBeGreaterThan(b.asks[i - 1].p)
        }
        expect(b.asks[0].p - b.bids[0].p, name).toBeGreaterThanOrEqual(p.tickSize - 1e-9)
        expect(b.bids[b.bids.length - 1].p, name).toBeGreaterThan(0)
      }
    },
  )
})
