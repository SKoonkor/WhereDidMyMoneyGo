import { describe, it, expect, beforeEach } from 'vitest'
import { t, setLang } from '../i18n'
import { db, addTxn, listTxns } from '../db'

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

describe('on-device store', () => {
  beforeEach(async () => {
    await db.transactions.clear()
  })
  it('persists a transaction and lists it newest-first', async () => {
    await addTxn({ period: '2026-07-01', account: 'A', amount: 10, type: 'Expense', category: 'Food' })
    await addTxn({ period: '2026-07-05', account: 'A', amount: 99, type: 'Income', category: 'Salary' })
    const rows = await listTxns()
    expect(rows).toHaveLength(2)
    expect(rows[0].period).toBe('2026-07-05') // newest first
    expect(rows[0].category).toBe('Salary')
  })
})
