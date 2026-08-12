// The L2 order book, and what a market order actually costs.
//
// The book is a pure function of (mid, imbalance, params) — it draws no random
// numbers at all. That is deliberate: the book is rebuilt on a wall-ish cadence
// (BOOK_REBUILD_MS) and read on demand by the UI, so if building it consumed the
// simulation's RNG stream then how often someone opened the depth panel would
// change the prices. Rebuild timing has to be invisible to replay, and the only
// way to guarantee that is for the book to draw nothing.
//
// It still has to look alive rather than like a decaying exponential drawn twice
// a second, so the per-level size wobble comes from an integer hash of
// (quantum, level) instead. Same visual effect, no state, no draws.

import type { OrderBook, Px, Qty, Side, SimTime } from '../types'

export interface BookParams {
  /** Distance from mid to the best quote on each side, in ticks. Half of it per
   *  side, floored so the spread can never close to zero. */
  baseSpreadTicks: number
  /** Levels per side. */
  depth: number
  /** Resting size at the top of book, before decay and skew. */
  baseSize: Qty
  /** Sizes fall off as exp(-sizeDecay * level). ~0.15 gives a book that thins
   *  gradually; above ~0.5 everything past level 5 is dust. */
  sizeDecay: number
  /** How hard net aggressive flow leans the book, as a fraction of resting size
   *  at full imbalance. Must stay below 1 or a side could go negative. */
  imbalanceGain: number
  /** Sim-milliseconds for accumulated flow to lose half its influence. */
  imbalanceHalfLifeMs: number
}

export interface DepthBook {
  /**
   * The SAME OrderBook object every call, with the SAME level arrays inside it.
   * Copy anything you intend to keep past the next rebuild.
   */
  readonly book: OrderBook
  /**
   * Rebuild in place around `mid`. `imbalance` is already normalised to [-1, 1]
   * (positive = buyers have been the aggressors); `salt` only has to differ
   * between rebuilds for the size wobble to move.
   */
  rebuild(t: SimTime, mid: Px, imbalance: number, salt: number): OrderBook
  /** Average price a market order of `qty` would pay, walking the depth and then
   *  charging a widening tail past the last level. */
  fillPrice(side: Side, qty: Qty): Px
  /** Total resting size on one side — what `fillPrice`'s tail is scaled against. */
  restingSize(side: Side): Qty
}

/**
 * Exponential decay of accumulated aggressive flow.
 *
 * Lives here rather than in model.ts because the half-life is a book parameter
 * and this is the only place that gives it meaning; the market just applies it
 * once per quantum.
 */
export function decayImbalance(imb: number, dtMs: number, halfLifeMs: number): number {
  if (!(halfLifeMs > 0)) return 0
  return imb * Math.pow(2, -dtMs / halfLifeMs)
}

/** Deterministic size wobble in [0.75, 1.25]. Integer-only so it costs nothing
 *  and, more importantly, so it never touches the RNG stream. */
function wobble(a: number, b: number): number {
  let h = (Math.imul(a, 0x9e3779b1) + Math.imul(b, 0x85ebca6b)) | 0
  h ^= h >>> 15
  h = Math.imul(h, 0x2545f491)
  h ^= h >>> 13
  return 0.75 + ((h >>> 0) / 4294967296) * 0.5
}

/** How far past the last level a huge order pushes, per multiple of the whole
 *  resting book it has to eat. Sweeping the entire depth again costs ~5% more. */
const TAIL_IMPACT = 0.05

class Book implements DepthBook {
  readonly book: OrderBook
  private readonly p: BookParams
  private readonly tick: Px
  private readonly spacing: number
  private bidQty = 0
  private askQty = 0

  constructor(p: BookParams, tickSize: Px) {
    this.p = p
    this.tick = tickSize > 0 ? tickSize : 1
    // Levels a single tick apart would make a 25-deep book span 25 ticks, which
    // on a 0.1-tick instrument is a book two cents wide. Spacing tracks the
    // spread instead, so depth covers a realistic slice of the price.
    this.spacing = Math.max(1, Math.round(p.baseSpreadTicks))

    const bids = new Array(p.depth)
    const asks = new Array(p.depth)
    for (let i = 0; i < p.depth; i++) {
      bids[i] = { p: 0, q: 0 }
      asks[i] = { p: 0, q: 0 }
    }
    this.book = { t: 0, bids, asks }
  }

  rebuild(t: SimTime, mid: Px, imbalance: number, salt: number): OrderBook {
    const { p, tick, spacing } = this
    const b = this.book
    b.t = t

    // Half a tick minimum per side. Combined with floor/ceil below this is what
    // makes the spread at least one whole tick no matter how tight the preset is
    // — a crossed or zero-width book breaks every downstream fill calculation.
    const half = Math.max(0.5, p.baseSpreadTicks / 2)
    const midTicks = mid / tick
    let bidTicks = Math.floor(midTicks - half)
    const askTicks = Math.ceil(midTicks + half)
    // The deepest bid must stay above zero: a book with a level at or below zero
    // would price a fill at a negative number rather than merely a bad one.
    const floorTicks = 1 + (p.depth - 1) * spacing
    if (bidTicks < floorTicks) bidTicks = floorTicks

    // Aggressive buying eats the offers and leaves bids behind it, so flow that
    // lifted the ask thins the ask side and thickens the bid side.
    const skew = imbalance > 1 ? 1 : imbalance < -1 ? -1 : imbalance
    const g = p.imbalanceGain > 0.9 ? 0.9 : p.imbalanceGain
    const bidMul = 1 + g * skew
    const askMul = 1 - g * skew

    let bq = 0
    let aq = 0
    for (let i = 0; i < p.depth; i++) {
      const decay = Math.exp(-p.sizeDecay * i)
      const bl = b.bids[i]
      bl.p = (bidTicks - i * spacing) * tick
      bl.q = p.baseSize * decay * bidMul * wobble(salt, i)
      bq += bl.q
      const al = b.asks[i]
      al.p = (askTicks + i * spacing) * tick
      al.q = p.baseSize * decay * askMul * wobble(salt, ~i)
      aq += al.q
    }
    this.bidQty = bq
    this.askQty = aq
    return b
  }

  restingSize(side: Side): Qty {
    return side === 'buy' ? this.askQty : this.bidQty
  }

  fillPrice(side: Side, qty: Qty): Px {
    const buy = side === 'buy'
    const levels = buy ? this.book.asks : this.book.bids
    // A zero or nonsense size still has to answer with a price: callers use this
    // for previews, and a NaN here propagates into equity and margin.
    if (!(qty > 0)) return levels[0].p

    let rem = qty
    let cost = 0
    for (let i = 0; i < levels.length; i++) {
      const lv = levels[i]
      const take = rem < lv.q ? rem : lv.q
      cost += take * lv.p
      rem -= take
      if (rem <= 0) return cost / qty
    }

    // Past the book. Charging the remainder at the last level would say a size
    // ten times the depth costs the same as one that just cleared it, so the
    // tail keeps worsening linearly and we charge its average over the residual.
    const last = levels[levels.length - 1].p
    const resting = buy ? this.askQty : this.bidQty
    const push = TAIL_IMPACT * (rem / (resting > 0 ? resting : rem))
    const tail = buy ? last * (1 + push / 2) : last / (1 + push / 2)
    return (cost + rem * tail) / qty
  }
}

export function createBook(p: BookParams, tickSize: Px): DepthBook {
  return new Book(p, tickSize)
}
