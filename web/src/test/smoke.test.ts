import { describe, it, expect, beforeEach } from 'vitest'
import { t, setLang } from '../i18n'
import {
  db, addTxn, listTxns, addTransfer, deleteTxn, deleteTransfer,
  getAccounts, getCategories, getSettings, ensureSeeded,
} from '../db'
import { accountBalances, signedAmount } from '../lib/balances'

describe('i18n', () => {
  it('returns the English key as-is', () => {
    setLang('en')
    expect(t('Transactions')).toBe('Transactions')
  })
  it('looks up Thai and fills placeholders', () => {
    setLang('th')
    expect(t('Income')).toBe('รายรับ')
    setLang('en')
  })
})

describe('seeding', () => {
  beforeEach(async () => {
    await db.config.clear()
  })
  it('seeds default accounts, categories, settings once', async () => {
    await ensureSeeded()
    expect(await getAccounts()).toContain('Cash')
    expect(Object.keys((await getCategories()).expense)).toContain('Food')
    expect((await getSettings()).baseCurrency).toBe('THB')
  })
})

describe('transactions', () => {
  beforeEach(async () => {
    await db.transactions.clear()
  })
  it('persists a transaction and lists it newest-first', async () => {
    await addTxn({ period: '2026-07-01', account: 'A', amount: 10, type: 'Expense', category: 'Food' })
    await addTxn({ period: '2026-07-05', account: 'A', amount: 99, type: 'Income', category: 'Salary' })
    const rows = await listTxns()
    expect(rows).toHaveLength(2)
    expect(rows[0].period).toBe('2026-07-05')
    expect(rows[0].currency).toBe('THB') // stamped from settings
  })
})

describe('transfers (two linked legs)', () => {
  beforeEach(async () => {
    await db.transactions.clear()
  })
  it('creates a Transfer-Out + Transfer-In pair sharing a transferId', async () => {
    const id = await addTransfer({ period: '2026-07-03', amount: 500, from: 'Cash', to: 'Bank' })
    const rows = await listTxns()
    expect(rows).toHaveLength(2)
    const out = rows.find((r) => r.type === 'Transfer-Out')!
    const inc = rows.find((r) => r.type === 'Transfer-In')!
    expect(out.account).toBe('Cash')
    expect(out.category).toBe('Bank') // Out carries destination in Category
    expect(inc.account).toBe('Bank')
    expect(inc.category).toBe('Cash') // In carries source
    expect(out.transferId).toBe(id)
    expect(inc.transferId).toBe(id)
  })
  it('deleting one leg removes both', async () => {
    await addTransfer({ period: '2026-07-03', amount: 500, from: 'Cash', to: 'Bank' })
    const one = (await listTxns())[0]
    await deleteTxn(one.id) // any leg
    expect(await listTxns()).toHaveLength(0)
  })
  it('deleteTransfer removes the whole pair', async () => {
    const id = await addTransfer({ period: '2026-07-03', amount: 500, from: 'Cash', to: 'Bank' })
    await deleteTransfer(id)
    expect(await listTxns()).toHaveLength(0)
  })
})

describe('balances (port of balances.py)', () => {
  it('signs each type correctly', () => {
    expect(signedAmount('Income', 100)).toBe(100)
    expect(signedAmount('Expense', 100)).toBe(-100)
    expect(signedAmount('Saving', 100)).toBe(-100)
    expect(signedAmount('Transfer-In', 100)).toBe(100)
    expect(signedAmount('Transfer-Out', 100)).toBe(-100)
  })
  it('moves money between accounts without changing net worth', () => {
    const bal = accountBalances([
      { id: 1, period: '2026-07-01', account: 'Cash', amount: 500, type: 'Transfer-Out', category: 'Bank', currency: 'THB', transferId: 'x' },
      { id: 2, period: '2026-07-01', account: 'Bank', amount: 500, type: 'Transfer-In', category: 'Cash', currency: 'THB', transferId: 'x' },
      { id: 3, period: '2026-07-02', account: 'Cash', amount: 1000, type: 'Income', category: 'Salary', currency: 'THB' },
    ])
    expect(bal.Cash).toBe(500) // 1000 income − 500 out
    expect(bal.Bank).toBe(500) // 500 in
    const net = Object.values(bal).reduce((s, v) => s + v, 0)
    expect(net).toBe(1000) // transfer nets to 0; only the income counts
  })
})
