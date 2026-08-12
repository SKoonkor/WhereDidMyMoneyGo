// Option expiry: what an ITM contract is worth at the bell, and what it does to
// the account.
//
// Two decisions, both of which the UI has to reflect:
//
//   1. **CASH SETTLED, never physical delivery.** Assigning a short call into a
//      short spot position would need an instrument the sim may not even trade,
//      would have to pass through the margin model on a leg the user never
//      opened, and would make expiry the single most bug-prone moment in the
//      engine. Cash settlement is arithmetically exact, is what index options
//      actually do, and is trivially testable. The chain UI must print "Cash
//      settled" on every contract so this reads as a design choice, not a
//      missing feature.
//
//   2. **The settlement price is a 30-minute TWAP of the underlying's 1m closes,
//      not the last print.** A last-price settlement is gameable: the sandbox has
//      a pause button, so a user could stop the clock on a favourable tick and
//      settle there. Real exchanges settle on an averaging window for exactly
//      that reason, the 1m aggregator already produces the closes for free, and
//      a mean of 30 numbers is exactly reproducible on replay.
//
// Everything here is PURE. It computes outcomes; the caller applies the cash,
// books the realized P&L and removes the positions. That split is what lets the
// broker decide what a resulting negative balance means without this file having
// an opinion about margin.

import { DUST_QTY, OPTION_MULT, TF_MS, type Candle, type Px, type Qty, type SimTime } from '../types'

export const SETTLEMENT_TWAP_MS = 30 * 60_000

/** ITM by less than this settles as worthless. Without a threshold, a position
 *  0.0000001 in the money would "exercise" for a cash amount that rounds to zero
 *  and still flip the blotter row to Exercised, which is just confusing. */
export const DEFAULT_ITM_THRESHOLD = 0.01

/**
 * The only shape settlement needs from a position.
 *
 * Declared structurally rather than imported from `broker/types.ts` on purpose:
 * a `Position` satisfies this interface without either module importing the
 * other, the same seam the chart engine uses with `OhlcvColumns`. Passing a
 * `readonly Position[]` here type-checks with no adapter and no cycle.
 *
 * The option fields are optional because the caller hands over its WHOLE book —
 * spot and perp positions included — and settlement is responsible for ignoring
 * the ones that are not options rather than the caller pre-filtering.
 */
export interface SettleablePosition {
  symbol: string
  /** Signed: < 0 is short. */
  qty: Qty
  /** Average entry price per unit of underlying, NOT per contract. */
  avgCost: Px
  expiry?: SimTime
  right?: 'call' | 'put'
  strike?: Px
  multiplier?: number
  underlying?: string
}

export interface ExpiryOutcome {
  symbol: string
  qty: Qty
  settlementPrice: Px
  intrinsic: Px
  /** Signed cash movement: + credited to the account, − debited from it. */
  cash: number
  /** Realized P&L for the blotter, including the premium paid or received. */
  realized: number
  exercised: boolean
  assigned: boolean
}

/**
 * Mean of the 1m closes in the 30 minutes ENDING at `expiry`.
 *
 * Bars are stamped by their OPEN time (the aggregator's convention), so a bar
 * counts when its close, `t + 60_000`, lands inside `(expiry - window, expiry]`.
 * Using the open time for the comparison instead would quietly include a bar that
 * is still forming at the bell — i.e. settle on a price that had not happened yet.
 *
 * A short history is tolerated rather than rejected: a contract can expire in the
 * first half hour of a fresh sandbox, and refusing to settle it would strand the
 * position forever. With nothing in the window at all it falls back to the most
 * recent close at or before expiry, and only returns undefined when there is no
 * history whatsoever.
 */
export function twapFromCandles(
  bars: readonly Candle[], expiry: SimTime, windowMs: number = SETTLEMENT_TWAP_MS,
): Px | undefined {
  const barMs = TF_MS['1m']
  let sum = 0
  let n = 0
  let lastClose: Px | undefined
  let lastT = -Infinity
  for (const b of bars) {
    const closeT = b.t + barMs
    if (closeT > expiry) continue
    if (closeT > lastT) {
      lastT = closeT
      lastClose = b.c
    }
    if (closeT > expiry - windowMs) {
      sum += b.c
      n++
    }
  }
  if (n > 0) return sum / n
  return lastClose
}

/** An options position, or not. Narrowing here keeps `settleExpiries` readable
 *  and means a spot row can never accidentally acquire an intrinsic value. */
function isOption(p: SettleablePosition): boolean {
  return (
    typeof p.expiry === 'number' &&
    typeof p.strike === 'number' &&
    (p.right === 'call' || p.right === 'put')
  )
}

/**
 * Settle every option position whose expiry has passed.
 *
 * `twap` resolves an underlying to its settlement price; returning undefined
 * means "no history for that symbol yet", and the position is skipped so the
 * caller can retry on the next step rather than settling against a made-up price.
 *
 * The cash and realized arithmetic is deliberately sign-uniform:
 *
 *     cash     = itm ? qty * intrinsic * mult : 0
 *     realized = cash - qty * avgCost * mult
 *
 * A long (qty > 0) that expires worthless books −qty·avgCost·mult, the premium it
 * paid; a short (qty < 0) books +|qty|·avgCost·mult, the premium it received.
 * Both fall out of the same two lines, which is what keeps the blotter consistent
 * with the cash ledger by construction instead of by a matched pair of branches
 * that can drift apart.
 *
 * **A short ITM assignment can drive cash negative, and that is not clamped
 * here.** It is exactly what happens to a real account that sold a naked option
 * through the strike; the broker records the deficit, blocks opening orders and
 * liquidates. Clamping it in this function would hide the one risk short options
 * exist to teach.
 */
export function settleExpiries(
  positions: readonly SettleablePosition[],
  twap: (underlying: string) => Px | undefined,
  now: SimTime,
  threshold: number = DEFAULT_ITM_THRESHOLD,
): ExpiryOutcome[] {
  const out: ExpiryOutcome[] = []
  for (const p of positions) {
    if (!isOption(p)) continue
    if (p.expiry! > now) continue
    // A dust residual is float noise from a full close, not a position; settling
    // it would emit a blotter row for a contract the user does not hold.
    if (Math.abs(p.qty) < DUST_QTY) continue

    const settlementPrice = twap(p.underlying ?? p.symbol)
    if (settlementPrice === undefined || !Number.isFinite(settlementPrice)) continue

    const k = p.strike!
    const mult = p.multiplier ?? OPTION_MULT
    const intrinsic =
      p.right === 'call' ? Math.max(0, settlementPrice - k) : Math.max(0, k - settlementPrice)
    const itm = intrinsic > threshold

    const cash = itm ? p.qty * intrinsic * mult : 0
    out.push({
      symbol: p.symbol,
      qty: p.qty,
      settlementPrice,
      intrinsic,
      cash,
      realized: cash - p.qty * p.avgCost * mult,
      exercised: itm && p.qty > 0,
      assigned: itm && p.qty < 0,
    })
  }
  return out
}
