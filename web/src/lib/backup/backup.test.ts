import { describe, it, expect, beforeEach } from 'vitest'
import { db, ensureSeeded, addTxn, addTransfer, listTxns, getAccounts, getBudget, getGoals, getTax, saveBudget, saveGoals, saveTax } from '../../db'
import { toExportRecords, toCsv } from './exporter'
import { makeBackup, parseBackup, restoreBackup } from './backup'

beforeEach(async () => {
  await db.transactions.clear()
  await db.config.clear()
  await ensureSeeded()
})

describe('exporter', () => {
  it('emits rows in the EXPORT_COLUMNS shape, oldest first', async () => {
    await addTxn({ period: '2026-07-05', account: 'Cash', amount: 200, type: 'Expense', category: 'Food' })
    await addTxn({ period: '2026-07-01', account: 'Bank', amount: 5000, type: 'Income', category: 'Salary' })
    const recs = toExportRecords(await listTxns())
    expect(recs[0].Date).toBe('2026-07-01 00:00:00') // oldest first
    expect(recs[0].Type).toBe('Income')
    expect(recs[1].Account).toBe('Cash')
    expect(Object.keys(recs[0])).toEqual([
      'Id', 'Date', 'Type', 'Account', 'Category', 'Subcategory',
      'Amount', 'Currency', 'Note', 'Description', 'TransferId',
    ])
  })

  it('CSV quotes cells with commas and starts with a UTF-8 BOM', async () => {
    await addTxn({ period: '2026-07-01', account: 'Cash', amount: 10, type: 'Expense', category: 'Food', note: 'a,b' })
    const csv = toCsv(toExportRecords(await listTxns()))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"a,b"')
    expect(csv.split('\r\n')[0].endsWith('Id,Date,Type,Account,Category,Subcategory,Amount,Currency,Note,Description,TransferId')).toBe(true)
  })

  it('keeps a transfer pair linked by TransferId in the export', async () => {
    const gid = await addTransfer({ period: '2026-07-02', amount: 500, from: 'Cash', to: 'Bank Accounts' })
    const recs = toExportRecords(await listTxns())
    const legs = recs.filter((r) => r.Type.startsWith('Transfer'))
    expect(legs).toHaveLength(2)
    expect(legs[0].TransferId).toBe(gid)
    expect(legs[0].TransferId).toBe(legs[1].TransferId)
  })
})

describe('backup / restore', () => {
  it('round-trips transactions, accounts, categories', async () => {
    await addTxn({ period: '2026-07-01', account: 'Cash', amount: 10, type: 'Expense', category: 'Food' })
    await addTransfer({ period: '2026-07-02', amount: 500, from: 'Cash', to: 'Bank Accounts' })
    const backup = await makeBackup()
    expect(backup.app).toBe('where-did-my-money-go')

    // Wipe, then restore from the JSON we serialized.
    await db.transactions.clear()
    await db.config.clear()
    const parsed = parseBackup(JSON.stringify(backup))
    const res = await restoreBackup(parsed)

    expect(res.transactions).toBe(3) // 1 expense + 2 transfer legs
    expect((await listTxns()).length).toBe(3)
    expect(await getAccounts()).toContain('Bank Accounts')
    // Transfer pair still linked after restore (transferId preserved).
    const legs = (await listTxns()).filter((r) => r.type.startsWith('Transfer'))
    expect(legs[0].transferId).toBeTruthy()
    expect(legs[0].transferId).toBe(legs[1].transferId)
  })

  it('round-trips budget + goals + tax config (v3)', async () => {
    await saveBudget({ ...(await getBudget()), mode: 'rolling', fixedIncome: 12345, assignments: { Food: 'Wants' } })
    await saveGoals({ goals: { Car: 300000 }, factors: { Car: 2 }, selected: ['Car'] })
    await saveTax({ country: 'Thailand', allowances: { spouse: true, children: 2 }, incomeSelections: ['Salary'], taxSelections: ['Bills'] })

    const backup = await makeBackup()
    expect(backup.version).toBe(3)
    expect(backup.budget?.mode).toBe('rolling')
    expect(backup.goals?.selected).toEqual(['Car'])
    expect(backup.tax?.allowances.children).toBe(2)

    await db.transactions.clear()
    await db.config.clear()
    await restoreBackup(parseBackup(JSON.stringify(backup)))

    expect((await getBudget()).fixedIncome).toBe(12345)
    expect((await getBudget()).assignments.Food).toBe('Wants')
    expect((await getGoals()).factors.Car).toBe(2)
    expect((await getGoals()).selected).toEqual(['Car'])
    expect((await getTax()).allowances.spouse).toBe(true)
    expect((await getTax()).incomeSelections).toEqual(['Salary'])
  })

  it('restores an older v1 file (no budget/goals) without wiping current config', async () => {
    await saveGoals({ goals: { Trip: 50000 }, factors: {}, selected: [] })
    const v1 = {
      app: 'where-did-my-money-go', version: 1, exportedAt: new Date().toISOString(),
      transactions: [], accounts: ['Cash'], categories: { income: {}, expense: {} },
    }
    await restoreBackup(parseBackup(JSON.stringify(v1)))
    // The v1 file had no goals key → the existing goals config is left intact.
    expect((await getGoals()).goals.Trip).toBe(50000)
  })

  it('rejects a non-backup file', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/)
    expect(() => parseBackup('{"app":"something-else"}')).toThrow(/Where Did My Money Go\? backup/)
  })
})
