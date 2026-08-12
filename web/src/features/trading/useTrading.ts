// The view models. `undefined` while loading, exactly as `useDebts` does — the
// pages can then tell "nothing here yet" apart from "not read yet", which is the
// difference between an empty state and a flash of one.
//
// Note what does NOT live here: anything that has to move at 60fps. The runtime
// notifies at 8 Hz (NOTIFY_HZ) and these hooks ride that, because re-rendering a
// positions table sixty times a second is how a React trading screen ends up
// slower than the canvas it wraps. The chart subscribes to nothing at all — it
// reads `runtime.bars` inside its own rAF.

import { useEffect, useMemo, useRef, useState } from 'react'
import { acquireRuntime, releaseRuntime, type CatchUpState, type TradingRuntime } from './runtime'
import { positionRows, summarize, type AccountSummary, type PositionRow } from '../../lib/trading/broker/analytics'
import type { BrokerAccount, BrokerEvent, Order, Trade } from '../../lib/trading/broker/types'
import type { OptionChain } from '../../lib/trading/options/chain'
import { standardExpiries } from '../../lib/trading/options/chain'
import type { FeedStatus } from '../../lib/trading/market/feed'
import type { Instrument, OrderBook, Quote, SimTime } from '../../lib/trading/types'
import { precisionFromTick } from './fmt'
import type { TradingCfg } from '../../data/defaults'

/**
 * Hold the world for as long as this component is mounted.
 *
 * The acquire/release pair is the whole contract; the deferred teardown inside
 * `releaseRuntime` is what makes it survive StrictMode's double mount. Nothing
 * here needs a StrictMode guard of its own — that would only move the problem.
 */
export function useRuntime(): TradingRuntime | undefined {
  const [rt, setRt] = useState<TradingRuntime | undefined>()
  useEffect(() => {
    let live = true
    void acquireRuntime().then((r) => { if (live) setRt(r) })
    return () => {
      live = false
      releaseRuntime()
    }
  }, [])
  return rt
}

/** A counter that ticks at ≤ NOTIFY_HZ. Used as a memo key rather than as data:
 *  everything the pages read is a getter on the runtime, which is mutated in
 *  place by the loop. */
export function useRuntimeVersion(rt: TradingRuntime | undefined): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!rt) return
    setV((n) => n + 1)
    return rt.subscribe(() => setV((n) => n + 1))
  }, [rt])
  return v
}

export interface TradingView {
  runtime: TradingRuntime
  cfg: TradingCfg
  account: BrokerAccount
  accounts: readonly BrokerAccount[]
  summary: AccountSummary
  positions: PositionRow[]
  openOrders: Order[]
  /** Newest first — a blotter reads downward from what just happened. */
  trades: Trade[]
  quote: Quote | undefined
  instrument: Instrument | undefined
  /** Decimal places for every price on screen, from the instrument's tick size. */
  precision: number
  status: FeedStatus
  catchUp: CatchUpState
  currency: string
  /** Free collateral: what the quick-size row is a percentage OF. */
  buyingPower: number
}

export function useTrading(): TradingView | undefined {
  const rt = useRuntime()
  const version = useRuntimeVersion(rt)

  return useMemo(() => {
    if (!rt) return undefined
    const account = rt.account
    if (!account) return undefined
    const summary = summarize(account, rt.market)
    const instrument = rt.market.instrument(rt.symbol)
    return {
      runtime: rt,
      cfg: rt.cfg,
      account,
      accounts: rt.accounts,
      summary,
      positions: positionRows(account, rt.market, (p, m) => rt.market.greeks(p, m)),
      openOrders: account.orders.filter((o) => o.status === 'open').sort((a, b) => b.seq - a.seq),
      trades: [...rt.trades].reverse(),
      quote: rt.quote(rt.symbol),
      instrument,
      precision: instrument && 'pricePrecision' in instrument ? instrument.pricePrecision : 2,
      status: rt.status,
      catchUp: rt.catchUp,
      currency: account.currency,
      // Cash is the wrong number for a margined account: a perp reserves
      // collateral rather than spending it, so free margin is what actually
      // limits the next order.
      buyingPower: Math.max(0, Math.min(summary.cash, summary.margin.free)),
    }
    // `version` is the dependency that matters — the runtime object's identity
    // never changes, but everything hanging off it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, version])
}

/**
 * The option chain for one expiry.
 *
 * Rebuilt on the 8 Hz notify like everything else. `buildChain` is deterministic
 * in its four arguments, so this is a pure recompute and never a fetch — but it
 * is also ~15 Black-Scholes evaluations per row, which is exactly why it is not
 * on the chart's rAF.
 */
export function useChain(underlying: string, expiry: SimTime | null): OptionChain | undefined {
  const rt = useRuntime()
  const version = useRuntimeVersion(rt)
  return useMemo(() => {
    if (!rt || expiry === null) return undefined
    return rt.market.chain(underlying, expiry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, underlying, expiry, version])
}

/** The next few standard expiries, recomputed only when the sim day changes —
 *  the ladder is Fridays at 08:00Z, so re-deriving it eight times a second would
 *  produce the identical array 691,199 times out of 691,200. */
export function useExpiries(rt: TradingRuntime | undefined, weeklies = 4, monthlies = 3): SimTime[] {
  // Subscribed purely so the sim day below is re-read; the value is unused.
  useRuntimeVersion(rt)
  const day = rt ? Math.floor(rt.feed.clock.now() / 86_400_000) : 0
  return useMemo(() => {
    if (!rt) return []
    return standardExpiries(rt.feed.clock.now(), weeklies, monthlies)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, day, weeklies, monthlies])
}

/**
 * The order book, at 10 Hz.
 *
 * Its own timer rather than the 8 Hz notify, and a COPY rather than the live
 * object: the market engine rebuilds the book in place and reuses the level
 * arrays, so holding a reference across a render shows whatever the next rebuild
 * happened to leave there.
 */
export function useOrderBook(rt: TradingRuntime | undefined, symbol: string, on: boolean): OrderBook | undefined {
  const [book, setBook] = useState<OrderBook | undefined>()
  useEffect(() => {
    if (!rt || !on) {
      setBook(undefined)
      return
    }
    const read = () => {
      const b = rt.book(symbol)
      setBook(b ? { t: b.t, bids: b.bids.map((l) => ({ ...l })), asks: b.asks.map((l) => ({ ...l })) } : undefined)
    }
    read()
    const timer = setInterval(read, 100)
    return () => clearInterval(timer)
  }, [rt, symbol, on])
  return book
}

/** Broker events as they happen, for toasts. Unthrottled on purpose: two fills
 *  inside one notify window are two things the user did, and collapsing them
 *  would silently swallow one. */
export function useBrokerEvents(rt: TradingRuntime | undefined, cb: (e: BrokerEvent) => void): void {
  const latest = useRef(cb)
  latest.current = cb
  useEffect(() => {
    if (!rt) return
    return rt.events((e) => latest.current(e))
  }, [rt])
}

export { precisionFromTick }
