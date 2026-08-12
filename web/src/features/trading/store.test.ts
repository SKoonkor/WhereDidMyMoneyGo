import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { db, ensureSeeded, addTxn, addTransfer, addGoalMove, listTxns, listGoalMoves, getSettings, getGoals, BAR_CHUNK } from '../../db'
import { DEFAULT_TRADING } from '../../data/defaults'
import { MAX_CURVE, type Candle, type Timeframe } from '../../lib/trading/types'
import {
  getTrading, saveTrading, listAccounts, getAccount, saveAccount, deleteAccount,
  appendTrades, listTrades, appendEquity, listEquity, saveWorld, loadWorld,
  saveBars, loadBars, pruneBars, flush, resetSandbox,
} from './store'

const MIN = 60_000
const TF: Timeframe = '1m'

/** A run of candles a minute apart, each one a plausible bar rather than a
 *  placeholder — the round-trip is only worth asserting on real numbers. */
function candles(count: number, from = 0): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < count; i++) {
    const o = 100 + i * 0.25
    out.push({ t: from + i * MIN, o, h: o + 0.5, l: o - 0.75, c: o + 0.125, v: 10 + i, n: 3 })
  }
  return out
}

beforeEach(async () => {
  await resetSandbox()
  await db.transactions.clear()
  await db.config.clear()
  await db.goalMoves.clear()
  await ensureSeeded()
})

describe('the sandbox guarantee', () => {
  it('leaves transactions and goal moves byte-identical when the sandbox is wiped', async () => {
    // The one genuinely dangerous failure in this feature is a simulator that can
    // reach the real ledger, so this asserts the whole of both tables, before and
    // after, rather than a count.
    await addTxn({ period: '2026-08-01', account: 'Cash', amount: 250, type: 'Expense', category: 'Food' })
    await addTransfer({ period: '2026-08-02', amount: 5000, from: 'Cash', to: 'Savings', goal: 'Car' })
    await addGoalMove({ period: '2026-08-03', from: '', to: 'Car', amount: 1200 })

    const before = {
      transactions: await db.transactions.toArray(),
      goalMoves: await db.goalMoves.toArray(),
    }

    const acct = { id: 'a1', name: 'Practice', cash: 10_000, positions: {}, orders: [] }
    const buy = { id: 't1', accountId: 'a1', t: 1_000, symbol: 'BTC', side: 'buy', qty: 1, price: 100 }
    await saveAccount(acct)
    await appendTrades([buy])
    await appendEquity('a1', [{ t: 1_000, v: 10_000 }])
    await saveWorld({ seed: 'abc', clock: { simNow: 1_000 }, savedAtWall: 42 })
    await saveBars('BTC', TF, candles(3))
    await flush('hidden')

    await resetSandbox()

    const after = {
      transactions: await db.transactions.toArray(),
      goalMoves: await db.goalMoves.toArray(),
    }
    expect(after).toEqual(before)
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
    // …and the sandbox really is empty, or the assertion above proves nothing.
    expect(await listAccounts()).toEqual([])
    expect(await listTrades('a1')).toEqual([])
    expect(await listEquity('a1')).toEqual([])
    expect(await loadWorld()).toBeNull()
    expect(await loadBars('BTC', TF, 100)).toEqual([])
  })

  it('forgets staged writes too, so the next flush cannot rebuild what was erased', async () => {
    const acct = { id: 'a1', name: 'Practice', cash: 10_000 }
    await saveAccount(acct)
    await saveWorld({ seed: 'abc', clock: {}, savedAtWall: 1 })
    await resetSandbox()
    await flush('unmount')
    expect(await listAccounts()).toEqual([])
    expect(await loadWorld()).toBeNull()
  })
})

describe('the v4 → v5 upgrade', () => {
  it('carries transactions, config and goal moves across untouched', async () => {
    // Written by the previous schema, opened by this one — the only way to catch a
    // v5 block that forgot to restate an earlier store, which would silently drop
    // the table it forgot.
    db.close()
    await Dexie.delete('money-tracker')
    const v4 = new Dexie('money-tracker')
    v4.version(4).stores({
      transactions: '++id, period, account, type, category, transferId, debt',
      config: 'key',
      goalMoves: '++id, period, transferId',
    })
    await v4.open()
    await v4.table('transactions').add({
      period: '2026-07-01', account: 'Cash', amount: 42, type: 'Expense',
      category: 'Food', currency: 'THB',
    })
    await v4.table('config').put({ key: 'goals', value: { goals: { Car: 300000 }, factors: {}, selected: ['Car'] } })
    await v4.table('config').put({ key: 'settings', value: { baseCurrency: 'JPY', savingsAccounts: ['Savings'] } })
    await v4.table('goalMoves').add({ period: '2026-07-02', from: '', to: 'Car', amount: 900 })
    v4.close()

    await db.open()

    expect((await listTxns()).map((t) => t.amount)).toEqual([42])
    expect((await listGoalMoves()).map((m) => m.amount)).toEqual([900])
    expect((await getGoals()).goals.Car).toBe(300000)
    expect((await getSettings()).baseCurrency).toBe('JPY')
    // The new stores exist and are empty, which is what "additive" has to mean.
    expect(await db.simAccounts.count()).toBe(0)
    expect(await db.simBars.count()).toBe(0)
  })
})

describe('trading config', () => {
  it('gives a fresh install the defaults', async () => {
    expect(await getTrading()).toEqual(DEFAULT_TRADING)
  })

  it('merges saved preferences over the defaults', async () => {
    await saveTrading({ ...DEFAULT_TRADING, speed: 60, symbol: 'ETH', indicators: ['sma-20', 'rsi-14'] })
    const cfg = await getTrading()
    expect(cfg.speed).toBe(60)
    expect(cfg.symbol).toBe('ETH')
    expect(cfg.indicators).toEqual(['sma-20', 'rsi-14'])
    expect(cfg.chartType).toBe(DEFAULT_TRADING.chartType) // untouched keys still arrive
  })

  it('fills in a key added after the config was written', async () => {
    await db.config.put({ key: 'trading', value: { speed: 4 } })
    const cfg = await getTrading()
    expect(cfg.speed).toBe(4)
    expect(cfg.timeframe).toBe(DEFAULT_TRADING.timeframe)
  })

  it('drops an indicator list that is not a list, and keeps the rest of the config', async () => {
    await db.config.put({ key: 'trading', value: { symbol: 'ETH', indicators: 'sma-20' } })
    const cfg = await getTrading()
    expect(cfg.indicators).toEqual(DEFAULT_TRADING.indicators)
    expect(cfg.symbol).toBe('ETH') // scalars still merge — only the ordered list falls back
  })

  it('drops an indicator list holding something that is not a string', async () => {
    // Wholesale, not filtered: an ordered list with one bad entry is a list whose
    // order can no longer be trusted, and half-restoring it is worse than resetting.
    await db.config.put({ key: 'trading', value: { indicators: ['sma-20', 7, 'rsi-14'] } })
    expect((await getTrading()).indicators).toEqual(DEFAULT_TRADING.indicators)
  })

  it('refuses a speed that is not a finite number', async () => {
    await db.config.put({ key: 'trading', value: { speed: null } })
    expect((await getTrading()).speed).toBe(DEFAULT_TRADING.speed)
  })
})

describe('accounts', () => {
  it('reads back a staged account before any flush', async () => {
    const acct = { id: 'a1', name: 'Practice', cash: 10_000, positions: {}, orders: [], orderSeq: 3 }
    await saveAccount(acct)
    expect(await getAccount('a1')).toEqual(acct)
    expect(await listAccounts()).toEqual([acct])
  })

  it('round-trips an account whole, nested positions and all', async () => {
    const acct = {
      id: 'a1', name: 'Practice', cash: 9_500, orderSeq: 2,
      positions: { BTC: { symbol: 'BTC', qty: 0.5, avgCost: 1000, mark: 1100 } },
      orders: [{ id: 'o1', symbol: 'BTC', side: 'buy', qty: 1 }],
      watchlist: ['BTC', 'ETH'],
    }
    await saveAccount(acct)
    await flush('action')
    expect(await getAccount('a1')).toEqual(acct)
  })

  it('takes an account’s trades and equity with it when it is deleted', async () => {
    const acct = { id: 'a1', name: 'Practice', cash: 100 }
    await saveAccount(acct)
    await appendTrades([{ id: 't1', accountId: 'a1', t: 1, symbol: 'BTC' }])
    await appendEquity('a1', [{ t: 1, v: 100 }])
    await flush('action')

    await deleteAccount('a1')

    expect(await listAccounts()).toEqual([])
    expect(await listTrades('a1')).toEqual([])
    expect(await listEquity('a1')).toEqual([])
  })
})

describe('trades', () => {
  it('appends without waiting for a flush — a filled order is never in limbo', async () => {
    const t1 = { id: 't1', accountId: 'a1', t: 2_000, symbol: 'BTC', side: 'buy', qty: 1, price: 100 }
    await appendTrades([t1])
    expect(await db.simTrades.count()).toBe(1)
    expect(await listTrades('a1')).toEqual([t1])
  })

  it('reads back in time order, whatever order they arrived in', async () => {
    const late = { id: 't2', accountId: 'a1', t: 5_000, symbol: 'BTC' }
    const early = { id: 't1', accountId: 'a1', t: 1_000, symbol: 'BTC' }
    await appendTrades([late])
    await appendTrades([early])
    expect((await listTrades('a1')).map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('keeps accounts apart', async () => {
    await appendTrades([
      { id: 't1', accountId: 'a1', t: 1_000, symbol: 'BTC' },
      { id: 't2', accountId: 'a2', t: 2_000, symbol: 'ETH' },
    ])
    expect((await listTrades('a1')).map((t) => t.id)).toEqual(['t1'])
    expect((await listTrades('a2')).map((t) => t.id)).toEqual(['t2'])
  })

  it('returns the newest N when a limit is given', async () => {
    await appendTrades([1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, accountId: 'a1', t: i * 1_000, symbol: 'BTC' })))
    expect((await listTrades('a1', 2)).map((t) => t.id)).toEqual(['t4', 't5'])
  })
})

describe('the equity curve', () => {
  it('appends and reads back in time order', async () => {
    await appendEquity('a1', [{ t: 3_000, v: 102 }, { t: 1_000, v: 100 }])
    await flush('action')
    expect(await listEquity('a1')).toEqual([{ t: 1_000, v: 100 }, { t: 3_000, v: 102 }])
  })

  it('shows staged points before they are written', async () => {
    await appendEquity('a1', [{ t: 1_000, v: 100 }])
    expect(await listEquity('a1')).toEqual([{ t: 1_000, v: 100 }])
    expect(await db.simEquity.count()).toBe(0)
  })

  it('holds at MAX_CURVE by thinning the curve, keeping its full range', async () => {
    const pts = Array.from({ length: MAX_CURVE + 200 }, (_, i) => ({ t: i * 8_000, v: 1_000 + i }))
    await appendEquity('a1', pts)
    await flush('hidden')

    const curve = await listEquity('a1')
    expect(curve.length).toBeLessThanOrEqual(MAX_CURVE)
    expect(curve.length).toBeGreaterThan(MAX_CURVE / 2 - 1)
    // Both ends survive: truncating the head would move the start date and make
    // the drawdown read shallower than it was.
    expect(curve[0]).toEqual(pts[0])
    expect(curve[curve.length - 1]).toEqual(pts[pts.length - 1])
    // Four thousand indexed rows is genuinely slow under fake-indexeddb, and
    // MAX_CURVE is a pinned constant, so the volume cannot be scaled down without
    // testing something other than the cap. The generous budget is for a loaded
    // CI box, not for a hang.
  }, 120_000)
})

describe('the world snapshot', () => {
  it('round-trips the seed, the clock and the market state', async () => {
    const world = {
      version: 1, seed: 'seed-9', savedAtWall: 0,
      clock: { simNow: 900_000, speed: 4, residual: 12, paused: false },
      markets: { BTC: { version: 1, quanta: 3600, logP: 11.2 } },
    }
    await saveWorld(world)
    await flush('hidden')
    // savedAtWall is the one field persistence owns rather than carries.
    expect(await loadWorld()).toEqual({ ...world, savedAtWall: expect.any(Number) })
  })

  it('is a singleton — saving again replaces it', async () => {
    await saveWorld({ seed: 'one', clock: {}, savedAtWall: 1 })
    await flush('hidden')
    await saveWorld({ seed: 'two', clock: {}, savedAtWall: 2 })
    await flush('hidden')
    expect(await db.simWorld.count()).toBe(1)
    expect((await loadWorld())?.seed).toBe('two')
  })

  it('is null before the sim has ever run', async () => {
    expect(await loadWorld()).toBeNull()
  })

  it('stamps the wall clock the feed is not allowed to read', async () => {
    // feed.snapshot() always returns savedAtWall: 0 — Date.now() is banned inside
    // lib/trading/. Persist that zero and every resume would measure its catch-up
    // from 1970 and grind through a full simulated day before showing a price.
    const before = Date.now()
    await saveWorld({ seed: 'abc', clock: {}, savedAtWall: 0 })
    await flush('hidden')
    const saved = (await loadWorld())!.savedAtWall
    expect(saved).toBeGreaterThanOrEqual(before)
    expect(saved).toBeLessThanOrEqual(Date.now())
  })
})

describe('candle storage', () => {
  it('packs 1200 bars into 3 chunks with every value intact', async () => {
    const bars = candles(1200)
    await saveBars('BTC', TF, bars)
    await flush('hidden')

    expect(await db.simBars.count()).toBe(3)
    expect((await db.simBars.toArray()).map((c) => c.count)).toEqual([BAR_CHUNK, BAR_CHUNK, 200])
    // Every column, `n` included — volume is bucketed by it, so a series that
    // loses it draws a different histogram from the one the user was watching.
    expect(await loadBars('BTC', TF, 2_000)).toEqual(bars)
  })

  it('tops up the open chunk instead of leaving a short row beside it', async () => {
    await saveBars('BTC', TF, candles(300))
    await flush('hidden')
    expect((await db.simBars.toArray()).map((c) => c.count)).toEqual([300])

    await saveBars('BTC', TF, candles(400, 300 * MIN))
    await flush('hidden')
    expect((await db.simBars.toArray()).map((c) => c.count)).toEqual([BAR_CHUNK, 200])
    expect(await db.simBars.count()).toBe(2)
    expect((await loadBars('BTC', TF, 2_000)).length).toBe(700)
  })

  it('ignores a bar the store already has, so a re-emitted candle is not doubled', async () => {
    const bars = candles(10)
    await saveBars('BTC', TF, bars)
    await flush('hidden')
    await saveBars('BTC', TF, bars.slice(7)) // the feed replays its last few
    await flush('hidden')
    expect((await loadBars('BTC', TF, 100)).map((b) => b.t)).toEqual(bars.map((b) => b.t))
  })

  it('returns the newest N in order when a limit is given', async () => {
    await saveBars('BTC', TF, candles(1200))
    await flush('hidden')
    const tail = await loadBars('BTC', TF, 30)
    expect(tail).toHaveLength(30)
    expect(tail[0].t).toBe(1170 * MIN)
    expect(tail[29].t).toBe(1199 * MIN)
  })

  it('keeps series apart', async () => {
    await saveBars('BTC', '1m', candles(5))
    await saveBars('BTC', '5m', candles(3))
    await saveBars('ETH', '1m', candles(4))
    await flush('hidden')
    expect(await loadBars('BTC', '1m', 100)).toHaveLength(5)
    expect(await loadBars('BTC', '5m', 100)).toHaveLength(3)
    expect(await loadBars('ETH', '1m', 100)).toHaveLength(4)
  })

  it('reads staged bars that no flush has written yet', async () => {
    await saveBars('BTC', TF, candles(4))
    expect(await db.simBars.count()).toBe(0)
    expect(await loadBars('BTC', TF, 100)).toHaveLength(4)
  })

  it('prunes only the chunks that are entirely older than the cutoff', async () => {
    await saveBars('BTC', TF, candles(1200))
    await flush('hidden')
    // Chunks span [0, 499], [500, 999] and [1000, 1199] minutes. A cutoff at
    // minute 583 sits INSIDE the second chunk, which must therefore survive —
    // dropping it would punch a hole in the middle of the chart.
    const now = 1199 * MIN
    const dropped = await pruneBars(now - 583 * MIN, now)
    expect(dropped).toBe(1)
    expect(await db.simBars.count()).toBe(2)
    expect((await loadBars('BTC', TF, 2_000))[0].t).toBe(500 * MIN)
  })

  it('prunes nothing when everything is inside the window', async () => {
    await saveBars('BTC', TF, candles(600))
    await flush('hidden')
    expect(await pruneBars(24 * 3_600_000, 599 * MIN)).toBe(0)
    expect(await db.simBars.count()).toBe(2)
  })
})

describe('the write gate', () => {
  it('does nothing, quietly, when nothing is dirty', async () => {
    await expect(flush('idle')).resolves.toBeUndefined()
    await expect(flush('hidden')).resolves.toBeUndefined()
    expect(await db.simAccounts.count()).toBe(0)
  })

  it('is safe to call concurrently — the writes serialize, nothing is doubled', async () => {
    const a1 = { id: 'a1', name: 'One', cash: 1 }
    const a2 = { id: 'a2', name: 'Two', cash: 2 }
    await saveAccount(a1)
    await saveAccount(a2)
    await appendEquity('a1', [{ t: 1, v: 1 }, { t: 2, v: 2 }])
    await saveBars('BTC', TF, candles(6))

    await Promise.all([flush('hidden'), flush('idle'), flush('action'), flush('unmount')])

    expect(await db.simAccounts.count()).toBe(2)
    expect(await db.simEquity.count()).toBe(2)
    expect(await loadBars('BTC', TF, 100)).toHaveLength(6)
  })

  it('writes what was staged while an earlier flush was in flight', async () => {
    const one = { id: 'a1', name: 'One', cash: 1 }
    const two = { id: 'a2', name: 'Two', cash: 2 }
    await saveAccount(one)
    const first = flush('hidden')
    await saveAccount(two)
    await first
    await flush('unmount')
    expect((await listAccounts()).map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })

  it('leaves nothing staged once it has committed', async () => {
    const one = { id: 'a1', name: 'One', cash: 1 }
    await saveAccount(one)
    await saveBars('BTC', TF, candles(3))
    await flush('unmount')
    // Proven by wiping the tables underneath: if a buffer still held the rows, the
    // next flush would put them straight back.
    await db.simAccounts.clear()
    await db.simBars.clear()
    await flush('unmount')
    expect(await db.simAccounts.count()).toBe(0)
    expect(await db.simBars.count()).toBe(0)
  })
})
