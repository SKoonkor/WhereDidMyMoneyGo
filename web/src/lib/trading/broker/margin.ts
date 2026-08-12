// Margin, liquidation and funding — everything paper.py never had.
//
// paper.py was a cash account: you could not owe more than you had, so there was
// nothing to liquidate. Perps change that, and the whole point of this file is
// that the user can see WHERE they get liquidated before they place the order.
// That number has to be exact and it has to be closed-form; an iterative solver
// would give a slightly different answer on the preview than on the fill, and a
// liquidation price that moves when you look at it destroys all trust in the sim.
//
// Everything is measured against `markPrice`, never `last` (types.ts explains
// why): a thin book must not be pushable through someone's liquidation.
import { uuid } from '../ids'
import type { Px, Qty } from '../types'
import { applyFill, instrumentLabel } from './fills'
import {
  instMult,
  posMark,
  type BrokerAccount,
  type BrokerEvent,
  type BrokerSettings,
  type MarketView,
  type Position,
  type Trade,
} from './types'

// ── The maintenance ladder ───────────────────────────────────────────────────

export interface MarginTier {
  /** Upper bound of the tier, in notional. */
  maxNotional: number
  rate: number
  /** The continuity term. Without it maintenance would jump at every tier edge
   *  and a position could be liquidated by growing one dollar. */
  deduction: number
}

/**
 * A conventional exchange ladder: bigger positions are harder to unwind, so they
 * carry more maintenance.
 *
 * Each `deduction` is chosen so maintenance is CONTINUOUS across the boundary —
 * e.g. at 50,000 both tiers give 250. Verified by a test, because a ladder that
 * is discontinuous by a rounding error liquidates people at tier edges.
 */
export const DEFAULT_TIERS: readonly MarginTier[] = [
  { maxNotional: 50_000, rate: 0.005, deduction: 0 },
  { maxNotional: 250_000, rate: 0.01, deduction: 250 },
  { maxNotional: 1_000_000, rate: 0.025, deduction: 4_000 },
  { maxNotional: 5_000_000, rate: 0.05, deduction: 29_000 },
  { maxNotional: Infinity, rate: 0.1, deduction: 279_000 },
]

export function maintenanceRate(
  notional: number,
  tiers: readonly MarginTier[] = DEFAULT_TIERS,
): { rate: number; deduction: number } {
  for (const t of tiers) {
    if (notional <= t.maxNotional) return { rate: t.rate, deduction: t.deduction }
  }
  const last = tiers[tiers.length - 1]
  return { rate: last.rate, deduction: last.deduction }
}

/** C.5: `maintenance = notional · r − D`, and never below zero. */
export function maintenanceFor(
  pos: Position,
  tiers: readonly MarginTier[] = DEFAULT_TIERS,
  mark = posMark(pos),
): number {
  if (pos.kind !== 'perp') return 0 // see marginSummary() for why
  const notional = Math.abs(pos.qty) * mark
  const { rate, deduction } = maintenanceRate(notional, tiers)
  return Math.max(0, notional * rate - deduction)
}

/** Collateral a position ties up. Perps reserve margin; a short option reserves
 *  the CBOE-rule amount the options workstream computes at open. */
export function usedMargin(pos: Position): number {
  if (pos.kind === 'perp') {
    if (pos.margin !== undefined) return pos.margin
    const lev = pos.leverage && pos.leverage > 0 ? pos.leverage : 1
    return (Math.abs(pos.qty) * pos.avgCost) / lev
  }
  return pos.optionMargin ?? 0
}

/** Initial margin for a new or enlarged perp position. */
export function initialMargin(qty: Qty, price: Px, leverage: number): number {
  const lev = leverage > 0 ? leverage : 1
  return (Math.abs(qty) * price) / lev
}

// ── Liquidation price ────────────────────────────────────────────────────────

/**
 * Closed form, from C.5. With `q = |qty|`, `σ = +1` long / −1 short:
 *
 *   M + σq(L − E) = r′qL − D
 *   ⇒  Long : L = (qE − M − D) / (q(1 − r′))
 *      Short: L = (qE + M + D) / (q(1 + r′))
 *
 * The liquidation fee is folded in as a RATE (`r′ = r + liqFeeBps/10000`), not as
 * a lump. That is the whole trick: as a lump the fee depends on L, which depends
 * on the fee, and the equation stops being solvable without iteration.
 *
 * `M` is the reserved margin net of funding already paid, so funding moves the
 * liquidation price monotonically adverse — which is exactly what a real venue
 * does and what a perp trader expects to see.
 *
 * Returns null for anything unmargined (a fully-paid spot or option position
 * cannot be liquidated) and for a long whose `r′ ≥ 1`, where the denominator
 * flips sign and the "price" would be meaningless.
 */
export function liquidationPrice(
  pos: Position,
  s: BrokerSettings,
  tiers: readonly MarginTier[] = DEFAULT_TIERS,
): Px | null {
  if (pos.kind !== 'perp' || pos.qty === 0) return null
  const q = Math.abs(pos.qty)
  const E = pos.avgCost
  const M = (pos.margin ?? initialMargin(pos.qty, pos.avgCost, pos.leverage ?? 1)) - (pos.fundingPaid ?? 0)

  // The tier is sampled at the CURRENT notional, matching C.5's
  // `notional = |qty| · mark`. Sampling it at entry instead would make
  // maintenanceFor() and this function disagree the moment the mark moved.
  const notional = q * posMark(pos)
  const { rate, deduction } = maintenanceRate(notional, tiers)
  const rPrime = rate + s.liquidationFeeBps / 10_000

  if (pos.qty > 0) {
    if (rPrime >= 1) return null
    const L = (q * E - M - deduction) / (q * (1 - rPrime))
    return L > 0 ? L : null // an unreachable liquidation is not a price
  }
  return (q * E + M + deduction) / (q * (1 + rPrime))
}

// ── Account health ───────────────────────────────────────────────────────────

export interface MarginSummary {
  equity: number
  /** Σ initial margin — collateral currently tied up. */
  used: number
  free: number
  /** Σ maintenance requirement. */
  maintenance: number
  /** equity / maintenance. < 1 → liquidate. Infinity when maintenance is 0. */
  marginRatio: number
  /** equity / used, as a percentage — the number the UI shows. */
  marginLevel: number
  /** Symbols that can be liquidated, largest maintenance first. */
  liquidatable: string[]
}

/**
 * Account health, all of it in one pass.
 *
 * `equity` is the architecture's `cash + Σ unrealised`, made precise for an
 * account that holds both cash-paid and margined instruments — the shorthand is
 * only right when every position is a perp:
 *
 *   perp         cash was NOT debited the notional (only margin was RESERVED),
 *                so the position contributes its unrealised P/L
 *   spot/option  cash WAS debited the full notional by applyFill, so the position
 *                contributes its whole market value, `qty · mark · mult`
 *
 * Mixing those up is the single easiest way to get a wrong equity: use the
 * shorthand on a spot buy and equity drops by the cost of every purchase.
 *
 * Maintenance is charged on perps only. A fully-paid spot or option long cannot
 * go negative, and a naked spot short is left at paper.py's parity — it is
 * collateralised by the cash `checkFunds` insisted on at open. Short OPTION risk
 * is handled where it actually bites, at assignment (see C.6).
 */
export function marginSummary(
  a: BrokerAccount,
  m: MarketView,
  tiers: readonly MarginTier[] = DEFAULT_TIERS,
): MarginSummary {
  let equity = a.cash
  let used = 0
  let maintenance = 0
  const risky: { symbol: string; mm: number }[] = []

  for (const pos of Object.values(a.positions)) {
    const mark = markOf(m, pos)
    if (pos.kind === 'perp') {
      equity += pos.qty * (mark - pos.avgCost)
      const mm = maintenanceFor(pos, tiers, mark)
      maintenance += mm
      risky.push({ symbol: pos.symbol, mm })
    } else {
      equity += pos.qty * mark * instMult(pos)
    }
    used += usedMargin(pos)
  }

  risky.sort((x, y) => y.mm - x.mm || x.symbol.localeCompare(y.symbol))
  return {
    equity,
    used,
    free: equity - used,
    maintenance,
    marginRatio: maintenance > 0 ? equity / maintenance : Infinity,
    marginLevel: used > 0 ? (equity / used) * 100 : Infinity,
    liquidatable: risky.map((r) => r.symbol),
  }
}

/** The live mark, falling back to the position's own cached one so valuation
 *  never silently reads zero for a symbol the feed has not caught up on. */
export function markOf(m: MarketView, pos: Position): Px {
  const q = m.quote(pos.symbol)
  return q ? q.markPrice : posMark(pos)
}

// ── Liquidation ──────────────────────────────────────────────────────────────

/** Stop closing positions once equity is comfortably clear of maintenance.
 *  Unwinding to exactly 1.0 would re-liquidate on the next tick. */
export const LIQ_TARGET_RATIO = 1.3

/**
 * PARTIAL liquidation: close the largest-maintenance position, repeatedly, until
 * equity ≥ 1.3 × maintenance or nothing margined is left.
 *
 * Nuking the whole account is easier to write and much worse: a user with five
 * positions who is 2% short on one of them should lose that one, not everything.
 * It is also the version that is trivially testable — "leaves the smallest
 * positions open" is a sentence you can assert.
 *
 * Cash floors at ZERO. A liquidation that leaves the account owing money is not
 * something this app can collect on, so the shortfall is reported as `socialised`
 * on the event and surfaced in the blotter rather than silently swallowed.
 */
export function liquidate(
  a: BrokerAccount,
  m: MarketView,
  out: BrokerEvent[],
  tiers: readonly MarginTier[] = DEFAULT_TIERS,
): void {
  // Each pass fully closes one position, so this cannot spin: the bound is the
  // number of positions held when it started.
  for (let guard = Object.keys(a.positions).length; guard > 0; guard--) {
    const s = marginSummary(a, m, tiers)
    if (s.maintenance <= 0) return
    if (s.equity >= LIQ_TARGET_RATIO * s.maintenance) return
    const symbol = s.liquidatable[0]
    if (!symbol) return
    const pos = a.positions[symbol]
    if (!pos) return
    closeAtMarket(a, m, pos, out)
  }
}

/** Force-close one position at its mark, charging the liquidation fee. */
function closeAtMarket(a: BrokerAccount, m: MarketView, pos: Position, out: BrokerEvent[]): void {
  const meta = m.instrument(pos.symbol)
  const price = markOf(m, pos)
  const qty = Math.abs(pos.qty)
  const side = pos.qty > 0 ? 'sell' : 'buy'
  const mult = instMult(pos)
  const fee = (qty * price * mult * a.settings.liquidationFeeBps) / 10_000

  // Without an instrument we still have to get the risk off the book, so fall
  // back to the position's own terms rather than leaving it open forever.
  const inst = meta ?? positionAsInstrument(pos)
  const r = applyFill(pos, inst, side, qty, price, fee, m.now())

  if (pos.kind === 'perp') {
    // Perp cash moves by realized P/L; the notional was never in cash to return.
    a.cash += r.realized - fee
  } else {
    a.cash += r.cashDelta - fee
  }
  a.realized += r.realized
  delete a.positions[pos.symbol]

  let socialised = 0
  if (a.cash < 0) {
    socialised = -a.cash
    a.cash = 0
  }

  const trade: Trade = {
    id: uuid(),
    t: m.now(),
    accountId: a.id,
    symbol: pos.symbol,
    label: instrumentLabel(inst),
    kind: pos.kind,
    side: 'liquidation',
    qty,
    price,
    value: qty * price * mult,
    fee,
    realized: r.realized,
    note: 'liquidation',
  }
  out.push({ type: 'fill', trade })
  out.push({
    type: 'liquidation',
    symbol: pos.symbol,
    qty,
    price,
    loss: r.realized - fee,
    socialised,
  })
}

/** A position carries enough of its own terms to be valued when the instrument
 *  registry has lost it (a delisted synthetic, a restored account). */
function positionAsInstrument(pos: Position): Parameters<typeof applyFill>[1] {
  if (pos.kind === 'option') {
    return {
      kind: 'option',
      symbol: pos.symbol,
      underlying: pos.underlying ?? pos.symbol,
      expiry: pos.expiry ?? 0,
      right: pos.right ?? 'call',
      strike: pos.strike ?? 0,
      multiplier: pos.multiplier ?? instMult(pos),
      tickSize: 0.01,
      pricePrecision: 2,
    }
  }
  if (pos.kind === 'perp') {
    return {
      kind: 'perp',
      symbol: pos.symbol,
      underlying: pos.underlying ?? pos.symbol,
      tickSize: 0.01,
      lotSize: 0,
      pricePrecision: 2,
      qtyPrecision: 8,
      maxLeverage: pos.leverage ?? 1,
      fundingIntervalMs: 28_800_000,
    }
  }
  return {
    kind: 'spot',
    symbol: pos.symbol,
    base: pos.symbol,
    quote: 'USD',
    tickSize: 0.01,
    lotSize: 0,
    pricePrecision: 2,
    qtyPrecision: 8,
  }
}

// ── Funding ──────────────────────────────────────────────────────────────────

/** The interest component of the funding rate, per interval — the fixed leg that
 *  makes perps track spot even when the premium is flat. 0.01% is the industry's. */
export const FUNDING_INTEREST_PER_INTERVAL = 0.0001

/**
 * Deterministic from the mark/index spread, which is what makes funding replay
 * exactly: nothing here depends on when the interval happened to be evaluated.
 *
 * Positive → longs pay shorts. Clamped to ±`fundingCap` in both directions so a
 * momentary dislocation cannot empty an account.
 */
export function fundingRate(mark: Px, index: Px, s: BrokerSettings): number {
  const intervalsPerDay = s.fundingIntervalMs > 0 ? 86_400_000 / s.fundingIntervalMs : 3
  const premium = index > 0 ? (mark - index) / index : 0
  const raw = premium / intervalsPerDay + FUNDING_INTEREST_PER_INTERVAL
  return Math.max(-s.fundingCap, Math.min(s.fundingCap, raw))
}
