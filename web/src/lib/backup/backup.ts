// Full on-device backup & restore: transactions + accounts + categories +
// settings as one JSON document. Restore is a full replace (guarded by a
// confirm in the UI). Nothing here talks to a server.
import {
  db, listTxns, getAccounts, getCategories, getSettings,
  saveAccounts, saveCategories, saveSettings, type Txn,
} from '../../db'
import type { Categories, Settings } from '../../data/defaults'

const APP_TAG = 'where-did-my-money-go'
const BACKUP_VERSION = 1

export interface Backup {
  app: typeof APP_TAG
  version: number
  exportedAt: string
  transactions: Txn[]
  accounts: string[]
  categories: Categories
  settings: Settings
}

export async function makeBackup(): Promise<Backup> {
  return {
    app: APP_TAG,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: await listTxns(),
    accounts: await getAccounts(),
    categories: await getCategories(),
    settings: await getSettings(),
  }
}

// Parse + shape-check an uploaded backup file. Throws a friendly Error on a file
// that isn't one of ours.
export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const b = data as Partial<Backup>
  if (
    !b || b.app !== APP_TAG ||
    !Array.isArray(b.transactions) || !Array.isArray(b.accounts) ||
    typeof b.categories !== 'object' || b.categories == null ||
    !('income' in b.categories) || !('expense' in b.categories)
  ) {
    throw new Error("This doesn't look like a Money Tracker backup file.")
  }
  return b as Backup
}

export interface RestoreResult { transactions: number; accounts: number }

// Replace ALL local data with the backup's contents. Transaction ids are
// dropped so IndexedDB reassigns them (transfer links use uuids in `transferId`,
// which are preserved, so pairs stay linked).
export async function restoreBackup(b: Backup): Promise<RestoreResult> {
  await db.transaction('rw', db.transactions, db.config, async () => {
    await db.transactions.clear()
    await db.transactions.bulkAdd(b.transactions.map(({ id: _id, ...rest }) => rest as Txn))
    await saveAccounts(b.accounts)
    await saveCategories(b.categories)
    if (b.settings) await saveSettings(b.settings)
  })
  return { transactions: b.transactions.length, accounts: b.accounts.length }
}
