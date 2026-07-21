// applyReconciliation lives in db.ts (it writes rows), so it's exercised here
// against fake-indexeddb. Focus: same-day reconciliations for an account MERGE
// into a single adjustment row; a net-zero result removes it; different days and
// different accounts stay separate.
import { describe, it, expect, beforeEach } from 'vitest'
import { db, ensureSeeded, applyReconciliation } from '../../db'
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
