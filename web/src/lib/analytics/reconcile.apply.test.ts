// applyReconciliation lives in db.ts (it writes rows), so it's exercised here
// against fake-indexeddb. Focus: same-day reconciliations for an account MERGE
// into a single adjustment row; a net-zero result removes it; different days and
// different accounts stay separate.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, ensureSeeded, applyReconciliation, getReconcileState, saveReconcileState } from '../../db'
import { RECON_CATEGORY, ADJUST_IN, ADJUST_OUT } from './reconcile'

beforeEach(async () => {
  await db.transactions.clear()
  await db.config.clear()
  await ensureSeeded()
})

const reconRows = async (account: string, day?: string) =>
  (await db.transactions.toArray()).filter(
    (r) =>
      r.category === RECON_CATEGORY &&
      (r.type === ADJUST_IN || r.type === ADJUST_OUT) &&
      r.account === account &&
      (day ? r.period === day : true),
  )

describe('applyReconciliation — same-day merge', () => {
  it('folds two same-day adjustments for an account into one row', async () => {
    await applyReconciliation([{ account: 'Cash', delta: 20 }], '2026-07-10')
    await applyReconciliation([{ account: 'Cash', delta: 10 }], '2026-07-10')
    const rows = await reconRows('Cash', '2026-07-10')
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe(ADJUST_IN)
    expect(rows[0].amount).toBe(30)
  })

  it('flips the row type when the merged sign flips', async () => {
    await applyReconciliation([{ account: 'Cash', delta: 20 }], '2026-07-10')
    await applyReconciliation([{ account: 'Cash', delta: -30 }], '2026-07-10')
    const rows = await reconRows('Cash', '2026-07-10')
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe(ADJUST_OUT)
    expect(rows[0].amount).toBe(10)
  })

  it('removes the row entirely when the merged result nets to zero', async () => {
    await applyReconciliation([{ account: 'Bank', delta: 20 }], '2026-07-11')
    const n = await applyReconciliation([{ account: 'Bank', delta: -20 }], '2026-07-11')
    expect(n).toBe(1) // the account was still touched
    expect(await reconRows('Bank', '2026-07-11')).toHaveLength(0)
  })

  it('keeps adjustments on different days separate', async () => {
    await applyReconciliation([{ account: 'Wallet', delta: 5 }], '2026-07-12')
    await applyReconciliation([{ account: 'Wallet', delta: 5 }], '2026-07-13')
    expect(await reconRows('Wallet', '2026-07-12')).toHaveLength(1)
    expect(await reconRows('Wallet', '2026-07-13')).toHaveLength(1)
    expect(await reconRows('Wallet')).toHaveLength(2)
  })

  it('merges only the re-entered account, leaving others that day untouched', async () => {
    await applyReconciliation(
      [{ account: 'Cash', delta: 20 }, { account: 'Bank', delta: 40 }],
      '2026-07-14',
    )
    await applyReconciliation([{ account: 'Cash', delta: 5 }], '2026-07-14')
    const cash = await reconRows('Cash', '2026-07-14')
    const bank = await reconRows('Bank', '2026-07-14')
    expect(cash).toHaveLength(1)
    expect(cash[0].amount).toBe(25)
    expect(bank).toHaveLength(1)
    expect(bank[0].amount).toBe(40) // unchanged
  })

  it('drops sub-cent deltas without stamping a spurious row', async () => {
    const n = await applyReconciliation([{ account: 'Cash', delta: 0.003 }], '2026-07-15')
    expect(n).toBe(0)
    expect(await reconRows('Cash', '2026-07-15')).toHaveLength(0)
  })
})

// The reconcile record holds two things written by two different people: the date
// (stamped by reconciling) and the reminder switch (set on the page). A
// whole-record write from either one used to revert the other.
describe('applyReconciliation — reconcile state', () => {
  it('keeps the reminder switch off across a reconciliation', async () => {
    await saveReconcileState({ remindersOn: false })
    await applyReconciliation([{ account: 'Cash', delta: 20 }], '2026-07-10')
    expect(await getReconcileState()).toEqual({ lastReconciled: '2026-07-10', remindersOn: false })
  })

  it('keeps it off on the nothing-to-record path too', async () => {
    await saveReconcileState({ remindersOn: false })
    // Under EPS, so pending is empty and the early return stamps the date.
    await applyReconciliation([{ account: 'Cash', delta: 0.003 }], '2026-07-11')
    expect(await getReconcileState()).toEqual({ lastReconciled: '2026-07-11', remindersOn: false })
  })

  it('patches one field without disturbing the other', async () => {
    await saveReconcileState({ lastReconciled: '2026-07-02' })
    await saveReconcileState({ remindersOn: false })
    expect(await getReconcileState()).toEqual({ lastReconciled: '2026-07-02', remindersOn: false })
  })

  it('reads a record written before the switch existed as reminders-on', async () => {
    await db.config.put({ key: 'reconcile', value: { lastReconciled: '2026-07-01' } })
    expect(await getReconcileState()).toEqual({ lastReconciled: '2026-07-01', remindersOn: true })
  })

  // The clock is pinned to an instant where the local and UTC dates DISAGREE
  // (23:30 UTC is already the 11th in Bangkok), so this fails the moment anyone
  // puts toISOString() back. vite.config.ts pins TZ for the same reason — without
  // it this assertion is vacuous on a UTC CI runner.
  it('stamps the local day, not the UTC day', async () => {
    // Date ONLY. Faking the whole timer set stalls fake-indexeddb, which needs
    // real scheduling to settle a transaction — the await never resolves.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 10, 23, 30)))
    try {
      await applyReconciliation([{ account: 'Cash', delta: 5 }])
      expect(new Date().toISOString().slice(0, 10)).toBe('2026-07-10') // the UTC day
      expect((await getReconcileState()).lastReconciled).toBe('2026-07-11') // the local one
    } finally {
      vi.useRealTimers()
    }
  })

  // The switch and the date have different writers. Merging without a transaction
  // is still a lost update, just a narrower one: tapping the reminder off and
  // reconciling in the same breath had both read the same record, and the second
  // put wrote back its stale copy of the other's field.
  it('keeps both fields when two writes overlap', async () => {
    // Launched together, so both reads are in flight before either write lands —
    // which is the shape of tapping the switch and reconciling in one breath.
    // Un-transactioned, the second put writes back its stale copy of the first's
    // field and one of these two assertions fails.
    await Promise.all([
      saveReconcileState({ remindersOn: false }),
      saveReconcileState({ lastReconciled: '2026-07-12' }),
    ])
    expect(await getReconcileState()).toEqual({ lastReconciled: '2026-07-12', remindersOn: false })
  })
})
