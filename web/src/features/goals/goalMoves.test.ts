import { describe, it, expect, beforeEach } from 'vitest'
import {
  db, ensureSeeded, addTransfer, updateTransfer, deleteTransfer, deleteTxn,
  listGoalMoves, addGoalMove, deleteGoalMove, getTransferGoal, deleteGoal,
  getGoals, saveGoals, saveSettings, getSettings, listTxns,
} from '../../db'
import { UNALLOCATED, allocations } from '../../lib/analytics/goalSavings'

// 'Savings' is a pool account out of the box (DEFAULT_SETTINGS.savingsAccounts).
beforeEach(async () => {
  await db.transactions.clear()
  await db.config.clear()
  await db.goalMoves.clear()
  await ensureSeeded()
  await saveGoals({ goals: { Car: 300000, Italy: 100000 }, factors: {}, selected: [] })
})

describe('tagging a transfer with a goal', () => {
  it('earmarks money moving INTO the pool as Unallocated → goal', async () => {
    await addTransfer({ period: '2026-07-10', amount: 10000, from: 'Bank Accounts', to: 'Savings', goal: 'Car' })
    const moves = await listGoalMoves()
    expect(moves).toHaveLength(1)
    expect(moves[0].from).toBe(UNALLOCATED)
    expect(moves[0].to).toBe('Car')
    expect(moves[0].amount).toBe(10000)
    expect(moves[0].transferId).toBeTruthy()
  })

  it('takes money leaving the pool OUT of the named goal', async () => {
    await addTransfer({ period: '2026-07-10', amount: 4000, from: 'Savings', to: 'Bank Accounts', goal: 'Car' })
    const [move] = await listGoalMoves()
    expect(move.from).toBe('Car')
    expect(move.to).toBe(UNALLOCATED)
  })

  it('creates nothing when the transfer misses the pool entirely', async () => {
    await addTransfer({ period: '2026-07-10', amount: 500, from: 'Cash', to: 'Wallet', goal: 'Car' })
    expect(await listGoalMoves()).toHaveLength(0)
  })

  it('creates nothing when BOTH sides are pool accounts', async () => {
    // The pool total doesn't change, so there is nothing to earmark.
    await saveSettings({ ...(await getSettings()), savingsAccounts: ['Savings', 'Brokerage'] })
    await addTransfer({ period: '2026-07-10', amount: 500, from: 'Savings', to: 'Brokerage', goal: 'Car' })
    expect(await listGoalMoves()).toHaveLength(0)
  })

  it('creates nothing when no goal was picked', async () => {
    await addTransfer({ period: '2026-07-10', amount: 10000, from: 'Bank Accounts', to: 'Savings' })
    expect(await listGoalMoves()).toHaveLength(0)
  })
})

describe('editing and deleting a tagged transfer', () => {
  it('carries the amount, date and goal through an edit', async () => {
    const id = await addTransfer({ period: '2026-07-10', amount: 10000, from: 'Bank Accounts', to: 'Savings', goal: 'Car' })
    await updateTransfer(id, { period: '2026-07-12', amount: 12000, from: 'Bank Accounts', to: 'Savings', goal: 'Italy' })
    const moves = await listGoalMoves()
    expect(moves).toHaveLength(1) // rewritten, not duplicated
    expect(moves[0]).toMatchObject({ period: '2026-07-12', amount: 12000, to: 'Italy', from: UNALLOCATED })
  })

  it('drops the move when the goal is cleared', async () => {
    const id = await addTransfer({ period: '2026-07-10', amount: 10000, from: 'Bank Accounts', to: 'Savings', goal: 'Car' })
    await updateTransfer(id, { period: '2026-07-10', amount: 10000, from: 'Bank Accounts', to: 'Savings' })
    expect(await listGoalMoves()).toHaveLength(0)
  })

  it('flips direction when the edit reverses the transfer', async () => {
    const id = await addTransfer({ period: '2026-07-10', amount: 5000, from: 'Bank Accounts', to: 'Savings', goal: 'Car' })
    await updateTransfer(id, { period: '2026-07-10', amount: 5000, from: 'Savings', to: 'Bank Accounts', goal: 'Car' })
    const [move] = await listGoalMoves()
    expect(move.from).toBe('Car')
    expect(move.to).toBe(UNALLOCATED)
  })

  it('removes the move when the transfer is deleted', async () => {
    const id = await addTransfer({ period: '2026-07-10', amount: 10000, from: 'Bank Accounts', to: 'Savings', goal: 'Car' })
    await deleteTransfer(id)
    expect(await listGoalMoves()).toHaveLength(0)
  })

  it('removes the move when a leg is deleted from the transaction list', async () => {
    // deleteTxn routes a linked row to deleteTransfer — the move must follow.
    await addTransfer({ period: '2026-07-10', amount: 10000, from: 'Bank Accounts', to: 'Savings', goal: 'Car' })
    const leg = (await listTxns()).find((t) => t.type === 'Transfer-Out')!
    await deleteTxn(leg.id)
    expect(await listGoalMoves()).toHaveLength(0)
    expect(await listTxns()).toHaveLength(0)
  })
})

describe('getTransferGoal', () => {
  it('reads back the goal on either direction', async () => {
    const into = await addTransfer({ period: '2026-07-10', amount: 1000, from: 'Cash', to: 'Savings', goal: 'Car' })
    const out = await addTransfer({ period: '2026-07-11', amount: 500, from: 'Savings', to: 'Cash', goal: 'Italy' })
    expect(await getTransferGoal(into)).toBe('Car')
    expect(await getTransferGoal(out)).toBe('Italy')
  })

  it('is blank for an untagged transfer', async () => {
    const id = await addTransfer({ period: '2026-07-10', amount: 1000, from: 'Cash', to: 'Savings' })
    expect(await getTransferGoal(id)).toBe('')
  })
})

describe('manual moves and goal deletion', () => {
  it('round-trips a hand-made move', async () => {
    const id = await addGoalMove({ period: '2026-07-10', from: UNALLOCATED, to: 'Car', amount: 2000 })
    expect(allocations(await listGoalMoves())).toEqual({ Car: 2000 })
    await deleteGoalMove(id)
    expect(await listGoalMoves()).toHaveLength(0)
  })

  it('refunds a deleted goal’s allocation instead of stranding it', async () => {
    await addGoalMove({ period: '2026-07-10', from: UNALLOCATED, to: 'Car', amount: 5000 })
    await deleteGoal('Car')
    // The goal is gone from the config…
    expect(Object.keys((await getGoals()).goals)).toEqual(['Italy'])
    // …and holds nothing, so `unallocatedAmount` gives the 5,000 back.
    expect(allocations(await listGoalMoves()).Car).toBe(0)
    expect(await listGoalMoves()).toHaveLength(2) // history kept, refund appended
  })

  it('refunds the other way when the goal was overdrawn', async () => {
    await addGoalMove({ period: '2026-07-10', from: 'Car', to: UNALLOCATED, amount: 800 })
    await deleteGoal('Car')
    expect(allocations(await listGoalMoves()).Car).toBe(0)
  })

  it('adds no refund row when the goal held nothing', async () => {
    await deleteGoal('Italy')
    expect(await listGoalMoves()).toHaveLength(0)
  })
})
