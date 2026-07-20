import { describe, it, expect, beforeEach } from 'vitest'
import {
  db, ensureSeeded, addTxn, addTransfer, listTxns,
  accountUsage, categoryUsage, subcategoryUsage,
  renameAccount, deleteAccount, reorderAccounts,
  renameCategory, deleteCategory, reorderCategories,
  renameSubcategory, deleteSubcategory,
  getAccounts, getCategories,
} from '../../db'

beforeEach(async () => {
  await db.transactions.clear()
  await db.config.clear()
  await ensureSeeded()
})

describe('usage counts', () => {
  it('counts accounts across both transfer legs', async () => {
    await addTxn({ period: '2026-07-01', account: 'Cash', amount: 10, type: 'Expense', category: 'Food' })
    await addTransfer({ period: '2026-07-02', amount: 50, from: 'Cash', to: 'Savings' })
    const use = await accountUsage()
    expect(use.Cash).toBe(2) // expense + transfer-out leg
    expect(use.Savings).toBe(1) // transfer-in leg
  })

  it('counts categories only for their kind, ignoring transfer legs', async () => {
    await addTxn({ period: '2026-07-01', account: 'Cash', amount: 10, type: 'Expense', category: 'Food' })
    await addTransfer({ period: '2026-07-02', amount: 50, from: 'Cash', to: 'Food' }) // leg category == 'Food'
    expect((await categoryUsage('expense')).Food).toBe(1) // transfer leg not counted
    expect((await categoryUsage('income')).Food ?? 0).toBe(0)
  })

  it('counts subcategories on expense rows', async () => {
    await addTxn({ period: '2026-07-01', account: 'Cash', amount: 10, type: 'Expense', category: 'Food', subcategory: 'Lunch' })
    expect((await subcategoryUsage('Food')).Lunch).toBe(1)
  })
})

describe('rename cascades to the ledger', () => {
  it('renames an account on its own rows and on transfer counterparts', async () => {
    await addTxn({ period: '2026-07-01', account: 'Cash', amount: 10, type: 'Expense', category: 'Food' })
    await addTransfer({ period: '2026-07-02', amount: 50, from: 'Cash', to: 'Savings' })
    expect(await renameAccount('Cash', 'Wallet Cash')).toBe(true)

    expect(await getAccounts()).toContain('Wallet Cash')
    expect(await getAccounts()).not.toContain('Cash')
    const rows = await listTxns()
    // Own-account rows renamed:
    expect(rows.filter((r) => r.account === 'Cash')).toHaveLength(0)
    expect(rows.filter((r) => r.account === 'Wallet Cash')).toHaveLength(2) // expense + out leg
    // Transfer-In counterpart (stored in category) also renamed:
    const inLeg = rows.find((r) => r.type === 'Transfer-In')!
    expect(inLeg.category).toBe('Wallet Cash')
  })

  it('renames an expense category on matching rows, not on transfer legs', async () => {
    await addTxn({ period: '2026-07-01', account: 'Cash', amount: 10, type: 'Expense', category: 'Food' })
    await addTransfer({ period: '2026-07-02', amount: 50, from: 'Cash', to: 'Food' })
    expect(await renameCategory('expense', 'Food', 'Groceries')).toBe(true)
    const rows = await listTxns()
    expect(rows.find((r) => r.type === 'Expense')!.category).toBe('Groceries')
    // Transfer-Out leg still points at the 'Food' account name, untouched:
    expect(rows.find((r) => r.type === 'Transfer-Out')!.category).toBe('Food')
    expect(Object.keys((await getCategories()).expense)).toContain('Groceries')
  })

  it('renames a subcategory on matching expense rows', async () => {
    await addTxn({ period: '2026-07-01', account: 'Cash', amount: 10, type: 'Expense', category: 'Food', subcategory: 'Lunch' })
    expect(await renameSubcategory('Food', 'Lunch', 'Brunch')).toBe(true)
    expect((await listTxns())[0].subcategory).toBe('Brunch')
  })

  it('rejects a rename that clashes with an existing name', async () => {
    expect(await renameAccount('Cash', 'Savings')).toBe(false) // Savings already exists
    expect(await renameCategory('expense', 'Food', 'Bills')).toBe(false)
    expect(await getAccounts()).toContain('Cash')
  })
})

describe('delete + reorder', () => {
  it('reorders accounts and preserves the set', async () => {
    const before = await getAccounts()
    const reversed = [...before].reverse()
    await reorderAccounts(reversed)
    expect(await getAccounts()).toEqual(reversed)
  })

  it('reorders categories keeping their subcategories', async () => {
    const names = Object.keys((await getCategories()).expense)
    const moved = [names[2], ...names.filter((_, i) => i !== 2)]
    await reorderCategories('expense', moved)
    const after = await getCategories()
    expect(Object.keys(after.expense)[0]).toBe(names[2])
    expect(after.expense[names[2]]).toEqual((await getCategories()).expense[names[2]])
  })

  it('deletes an unused account/category/subcategory', async () => {
    await deleteAccount('Brokerage')
    expect(await getAccounts()).not.toContain('Brokerage')
    await deleteCategory('expense', 'Subscription')
    expect(Object.keys((await getCategories()).expense)).not.toContain('Subscription')
    await deleteSubcategory('Food', 'Lunch')
    expect((await getCategories()).expense.Food).not.toContain('Lunch')
  })
})
