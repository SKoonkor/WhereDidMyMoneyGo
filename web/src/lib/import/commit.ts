// Commit parsed import rows into the on-device ledger. Mirrors
// build_insert_tuples/commit_rows: transfer groups get a fresh shared id, and
// `accountMap` lets the user merge an unknown account onto an existing one.
// Any still-unknown accounts/categories are created so no row is dropped.
import { db, getAccounts, saveAccounts, getCategories, saveCategories, getSettings, type Txn, type TxnType } from '../../db'
import { TRANSFER_TYPES } from './presets'
import type { Categories } from '../../data/defaults'
import type { ParsedRow } from './parse'

export interface CommitResult {
  inserted: number
  newAccounts: string[]
  newCategories: string[]
}

export async function commitImport(
  rows: ParsedRow[],
  accountMap: Record<string, string> = {},
): Promise<CommitResult> {
  const baseCurrency = (await getSettings()).baseCurrency
  const accounts = await getAccounts()
  const cats: Categories = await getCategories()

  const acctSet = new Set(accounts)
  const newAccounts: string[] = []
  const newCategories: string[] = []
  const ensureAccount = (name: string) => {
    if (name && !acctSet.has(name)) { acctSet.add(name); accounts.push(name); newAccounts.push(name) }
  }
  const ensureCategory = (kind: 'income' | 'expense', name: string) => {
    if (name && !(name in cats[kind])) {
      cats[kind] = { ...cats[kind], [name]: [] }
      newCategories.push(name)
    }
  }

  const linkMap = new Map<string, string>()
  const toInsert: Txn[] = rows.map((r) => {
    const account = accountMap[r.account] ?? r.account
    let category = r.category
    if (TRANSFER_TYPES.includes(r.type)) category = accountMap[category] ?? category

    ensureAccount(account)
    if (TRANSFER_TYPES.includes(r.type)) {
      ensureAccount(category) // counter-account
    } else if (category && (r.type === 'Income' || r.type === 'Expense')) {
      ensureCategory(r.type === 'Income' ? 'income' : 'expense', category)
    }

    let transferId: string | undefined
    if (r.transferGroup) {
      if (!linkMap.has(r.transferGroup)) linkMap.set(r.transferGroup, crypto.randomUUID())
      transferId = linkMap.get(r.transferGroup)
    }

    return {
      period: r.period,
      account,
      amount: r.amount,
      type: r.type as TxnType,
      category,
      subcategory: r.subcategory || undefined,
      note: r.note || undefined,
      currency: r.currency || baseCurrency,
      transferId,
    } as Txn
  })

  await saveAccounts(accounts)
  await saveCategories(cats)
  await db.transactions.bulkAdd(toInsert)

  return { inserted: toInsert.length, newAccounts, newCategories }
}
