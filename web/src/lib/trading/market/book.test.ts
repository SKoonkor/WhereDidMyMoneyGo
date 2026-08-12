import { describe, it, expect } from 'vitest'
import { createBook, decayImbalance } from './book'
import type { BookParams } from './book'

const P: BookParams = {
  baseSpreadTicks: 2,
  depth: 12,
  baseSize: 5,
  sizeDecay: 0.12,
  imbalanceGain: 0.4,
  imbalanceHalfLifeMs: 20_000,
}

const TICK = 0.1

function built(mid = 100, imb = 0, salt = 7) {
  const b = createBook(P, TICK)
  b.rebuild(1_000, mid, imb, salt)
  return b
}

describe('the depth book', () => {
  it('quotes bids descending and asks ascending', () => {
    const book = built().book
    for (let i = 1; i < book.bids.length; i++) {
      expect(book.bids[i].p).toBeLessThan(book.bids[i - 1].p)
      expect(book.asks[i].p).toBeGreaterThan(book.asks[i - 1].p)
    }
  })

  it('keeps every level at a positive price and a positive size', () => {
    for (const mid of [0.0002, 0.5, 1.085, 100, 68_000]) {
      const book = built(mid).book
      for (let i = 0; i < book.bids.length; i++) {
        expect(book.bids[i].p).toBeGreaterThan(0)
        expect(book.bids[i].q).toBeGreaterThan(0)
        expect(book.asks[i].q).toBeGreaterThan(0)
      }
    }
  })

  it('never closes the spread below one tick, at any mid', () => {
    const b = createBook(P, TICK)
    // Sweep mids across a whole tick in small steps, because the failure only
    // shows up when mid lands exactly on or just beside a tick boundary.
    for (let k = 0; k < 400; k++) {
      const mid = 100 + k * 0.0037
      const book = b.rebuild(0, mid, 0, k)
      expect(book.asks[0].p - book.bids[0].p).toBeGreaterThanOrEqual(TICK - 1e-9)
      expect(book.bids[0].p).toBeLessThanOrEqual(mid)
      expect(book.asks[0].p).toBeGreaterThanOrEqual(mid)
    }
  })

  it('holds the spread open even on a one-tick preset', () => {
    const tight = createBook({ ...P, baseSpreadTicks: 0 }, TICK)
    const book = tight.rebuild(0, 100, 0, 1)
    expect(book.asks[0].p - book.bids[0].p).toBeGreaterThanOrEqual(TICK - 1e-9)
  })

  it('thins the side that aggressive flow has been eating', () => {
    const buyers = built(100, 1)
    const thinAsk = buyers.book.asks[0].q
    const fatBid = buyers.book.bids[0].q
    // Same salt, so the level wobble is identical and only the skew differs.
    const sellers = built(100, -1)
    expect(thinAsk).toBeLessThan(sellers.book.asks[0].q)
    expect(fatBid).toBeGreaterThan(sellers.book.bids[0].q)
  })

  it('sizes fall off with depth', () => {
    const book = built().book
    // Level wobble means it is not strictly monotone level to level, so compare
    // the top of the book with the bottom of it.
    expect(book.asks[0].q).toBeGreaterThan(book.asks[P.depth - 1].q)
    expect(book.bids[0].q).toBeGreaterThan(book.bids[P.depth - 1].q)
  })

  it('is a pure function of its inputs — the same call twice gives the same book', () => {
    const a = built(100.37, 0.3, 42).book
    const b = built(100.37, 0.3, 42).book
    expect(a.bids.map((l) => [l.p, l.q])).toEqual(b.bids.map((l) => [l.p, l.q]))
    expect(a.asks.map((l) => [l.p, l.q])).toEqual(b.asks.map((l) => [l.p, l.q]))
  })

  it('fills a tiny order at the touch', () => {
    const b = built()
    const tiny = b.book.asks[0].q / 100
    expect(b.fillPrice('buy', tiny)).toBeCloseTo(b.book.asks[0].p, 9)
    expect(b.fillPrice('sell', tiny)).toBeCloseTo(b.book.bids[0].p, 9)
  })

  it('prices a buy at or above the ask and a sell at or below the bid', () => {
    const b = built()
    const sizes = [0.01, 1, 5, 50, 500, 50_000]
    for (const q of sizes) {
      expect(b.fillPrice('buy', q)).toBeGreaterThanOrEqual(b.book.asks[0].p - 1e-9)
      expect(b.book.asks[0].p).toBeGreaterThan(b.book.bids[0].p)
      expect(b.fillPrice('sell', q)).toBeLessThanOrEqual(b.book.bids[0].p + 1e-9)
    }
  })

  it('gets monotonically worse with size, including past the last level', () => {
    const b = built()
    const total = b.restingSize('buy')
    const sizes = [0.001, 0.1, 1, 4, 12, total * 0.9, total, total * 3, total * 40]
    let prevBuy = -Infinity
    let prevSell = Infinity
    for (const q of sizes) {
      const buy = b.fillPrice('buy', q)
      const sell = b.fillPrice('sell', q)
      expect(buy).toBeGreaterThanOrEqual(prevBuy - 1e-9)
      expect(sell).toBeLessThanOrEqual(prevSell + 1e-9)
      expect(Number.isFinite(buy)).toBe(true)
      expect(sell).toBeGreaterThan(0)
      prevBuy = buy
      prevSell = sell
    }
    // Sweeping the whole book has to cost more than clearing the touch, or
    // "impact" is a word the model does not actually implement.
    expect(b.fillPrice('buy', total * 3)).toBeGreaterThan(b.fillPrice('buy', total * 0.5))
  })

  it('answers a zero or negative size with the touch rather than a NaN', () => {
    const b = built()
    expect(b.fillPrice('buy', 0)).toBe(b.book.asks[0].p)
    expect(b.fillPrice('sell', -3)).toBe(b.book.bids[0].p)
  })

  it('reuses the same level objects across rebuilds', () => {
    const b = createBook(P, TICK)
    const first = b.rebuild(0, 100, 0, 1)
    const bid0 = first.bids[0]
    const second = b.rebuild(100, 101, 0, 2)
    expect(second).toBe(first)
    expect(second.bids[0]).toBe(bid0)
  })
})

describe('imbalance decay', () => {
  it('halves over one half-life', () => {
    expect(decayImbalance(1, 20_000, 20_000)).toBeCloseTo(0.5, 12)
    expect(decayImbalance(1, 40_000, 20_000)).toBeCloseTo(0.25, 12)
    expect(decayImbalance(1, 0, 20_000)).toBe(1)
  })

  it('collapses to zero when the half-life is meaningless', () => {
    expect(decayImbalance(5, 100, 0)).toBe(0)
    expect(decayImbalance(5, 100, -1)).toBe(0)
  })
})
