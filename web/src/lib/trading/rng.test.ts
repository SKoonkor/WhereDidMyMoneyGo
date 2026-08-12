import { describe, it, expect } from 'vitest'
import { createRng, hashSeed } from './rng'

describe('hashSeed', () => {
  it('is stable and spreads similar seeds apart', () => {
    // A seed has to mean the same thing on every device, so this value is
    // pinned rather than merely "some number".
    expect(hashSeed('btc')).toBe(hashSeed('btc'))
    expect(hashSeed('btc')).not.toBe(hashSeed('btd'))
    expect(hashSeed('')).toBe(0x811c9dc5)
  })
})

describe('createRng', () => {
  it('replays exactly from the same seed', () => {
    const a = createRng('seed-1')
    const b = createRng('seed-1')
    const xs = Array.from({ length: 200 }, () => a.u())
    const ys = Array.from({ length: 200 }, () => b.u())
    expect(xs).toEqual(ys)
  })

  it('gives different streams for different seeds', () => {
    const a = createRng('seed-1')
    const b = createRng('seed-2')
    expect(a.u()).not.toBe(b.u())
  })

  it('stays inside [0, 1)', () => {
    const r = createRng('range')
    for (let i = 0; i < 5000; i++) {
      const v = r.u()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('produces a normal distribution with the right moments', () => {
    const r = createRng('normal')
    const n = 40000
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const v = r.normal()
      sum += v
      sumSq += v * v
    }
    const mean = sum / n
    const sd = Math.sqrt(sumSq / n - mean * mean)
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(Math.abs(sd - 1)).toBeLessThan(0.03)
  })

  it('round-trips its state, including the cached Box-Muller spare', () => {
    // The spare is the trap: Box-Muller makes two normals at a time and caches
    // one. Leaving it out of the snapshot looks harmless and desynchronises a
    // restore by exactly one draw — which surfaces as "the price jumped when I
    // reopened the app".
    const r = createRng('spare')
    r.normal() // consumes a pair, leaving a spare cached
    const snap = JSON.parse(JSON.stringify(r.state()))
    expect(snap.spare).not.toBeNull()

    const expected = Array.from({ length: 50 }, () => r.normal())
    const restored = createRng('spare')
    restored.restore(snap)
    const actual = Array.from({ length: 50 }, () => restored.normal())
    expect(actual).toEqual(expected)
  })

  it('round-trips mid-stream for uniforms too', () => {
    const r = createRng('mid')
    for (let i = 0; i < 137; i++) r.u()
    const snap = r.state()
    const expected = Array.from({ length: 20 }, () => r.u())

    const b = createRng('mid')
    b.restore(snap)
    expect(Array.from({ length: 20 }, () => b.u())).toEqual(expected)
  })

  it('forks independent streams that do not disturb the parent', () => {
    // This is what lets a symbol be added to the watchlist without changing the
    // prices of the ones already there.
    const parent = createRng('root')
    const before = Array.from({ length: 10 }, () => parent.u())

    const parent2 = createRng('root')
    const btc = parent2.fork('BTC')
    for (let i = 0; i < 100; i++) btc.u()
    const after = Array.from({ length: 10 }, () => parent2.u())

    expect(after).toEqual(before)
    expect(createRng('root').fork('BTC').u()).toBe(createRng('root').fork('BTC').u())
    expect(createRng('root').fork('BTC').u()).not.toBe(createRng('root').fork('ETH').u())
  })

  it('draws exponentials with mean 1 and never returns Infinity', () => {
    const r = createRng('exp')
    let sum = 0
    for (let i = 0; i < 20000; i++) {
      const v = r.exp()
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      sum += v
    }
    expect(Math.abs(sum / 20000 - 1)).toBeLessThan(0.04)
  })

  // Monte Carlo, so it gets an explicit budget rather than the 5s default. It
  // twice exceeded that default under full-suite parallel load — 5779ms once —
  // while passing in isolation every time. A sampling test whose pass/fail
  // depends on how busy the machine is tells you nothing, so the timeout is
  // stated rather than inherited.
  it('draws Poisson counts with the right mean on both branches', { timeout: 30_000 }, () => {
    // 4,000 draws. Knuth's method loops about `lambda` times per draw, so the
    // lambda=29 case dominates the cost of this whole file. The statistics do
    // not need more: the standard error is sqrt(lambda/n), which at lambda=29
    // and n=4000 is 0.085, leaving the 5% tolerance below about 17 sigma out.
    for (const lambda of [0.5, 4, 29, 30, 120]) {
      const r = createRng(`pois-${lambda}`)
      let sum = 0
      const n = 4000
      for (let i = 0; i < n; i++) {
        const k = r.poisson(lambda)
        expect(Number.isInteger(k)).toBe(true)
        expect(k).toBeGreaterThanOrEqual(0)
        sum += k
      }
      // Standard error is sqrt(lambda/n); 5% is comfortably outside the noise.
      expect(Math.abs(sum / n - lambda)).toBeLessThan(lambda * 0.05 + 0.05)
    }
  })

  it('treats a non-positive rate as no events', () => {
    const r = createRng('pois-zero')
    expect(r.poisson(0)).toBe(0)
    expect(r.poisson(-1)).toBe(0)
  })
})
