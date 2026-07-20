// On-device data store (IndexedDB via Dexie). Nothing here ever leaves the
// browser — this is the "data stays on your device" layer.
//
// Schema mirrors the Dash app's SQLite ledger (src/io/store.py): a transaction
// row is (period, account, amount, type, category, subcategory, note, currency),
// and a TRANSFER is stored as two paired rows sharing a `transferId` — a
// Transfer-Out on the source account and a Transfer-In on the destination.
// Config (accounts / categories / settings) mirrors the app's JSON config files,
// stored as key→value rows.
import Dexie, { type EntityTable } from 'dexie'
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  type Categories,
  type Settings,
} from './data/defaults'

// Signed types stored on rows (the Dash "Income/Expense" column). The user-facing
// "add" choices are Income / Expense / Transfer / Saving; a Transfer expands into
// the two -In/-Out legs, and reconciliation writes the Adjustment legs later.
export type TxnType =
  | 'Income'
  | 'Expense'
  | 'Transfer-In'
  | 'Transfer-Out'
  | 'Saving'
  | 'Adjustment-In'
  | 'Adjustment-Out'

export interface Txn {
  id: number
  period: string // ISO date (YYYY-MM-DD)
  account: string
  amount: number
  type: TxnType
  category: string
  subcategory?: string
  note?: string
  currency: string
  // Set on both legs of a transfer to link them; absent for single rows.
  transferId?: string
}

interface ConfigRow {
  key: 'accounts' | 'categories' | 'settings'
  value: unknown
}

const db = new Dexie('money-tracker') as Dexie & {
  transactions: EntityTable<Txn, 'id'>
  config: EntityTable<ConfigRow, 'key'>
}

// v1 shipped only `transactions`. v2 adds the transferId index + the config store.
db.version(1).stores({ transactions: '++id, period, account, type, category' })
db.version(2).stores({
  transactions: '++id, period, account, type, category, transferId',
  config: 'key',
})

export { db }

// ── Seeding (idempotent) ─────────────────────────────────────────────────────
// Runs on startup; only writes config keys that are missing, so it safely covers
// both a fresh install and a v1→v2 upgrade.
export async function ensureSeeded(): Promise<void> {
  const existing = new Set((await db.config.toArray()).map((r) => r.key))
  const puts: ConfigRow[] = []
  if (!existing.has('accounts')) puts.push({ key: 'accounts', value: DEFAULT_ACCOUNTS })
  if (!existing.has('categories')) puts.push({ key: 'categories', value: DEFAULT_CATEGORIES })
  if (!existing.has('settings')) puts.push({ key: 'settings', value: DEFAULT_SETTINGS })
  if (puts.length) await db.config.bulkPut(puts)
}

// ── Config accessors ─────────────────────────────────────────────────────────
export async function getAccounts(): Promise<string[]> {
  return ((await db.config.get('accounts'))?.value as string[]) ?? DEFAULT_ACCOUNTS
}
export async function saveAccounts(accounts: string[]): Promise<void> {
  await db.config.put({ key: 'accounts', value: accounts })
}
export async function getCategories(): Promise<Categories> {
  return ((await db.config.get('categories'))?.value as Categories) ?? DEFAULT_CATEGORIES
}
export async function saveCategories(cats: Categories): Promise<void> {
  await db.config.put({ key: 'categories', value: cats })
}

// Inline "add from the picker" helpers (mirror accounts.py / transaction_categories.py).
export async function addAccount(name: string): Promise<void> {
  const accounts = await getAccounts()
  if (name && !accounts.includes(name)) await saveAccounts([...accounts, name])
}
export async function addCategory(kind: 'income' | 'expense', name: string): Promise<void> {
  const cats = await getCategories()
  if (name && !(name in cats[kind])) {
    cats[kind] = { ...cats[kind], [name]: [] }
    await saveCategories(cats)
  }
}
export async function addSubcategory(category: string, sub: string): Promise<void> {
  const cats = await getCategories()
  const subs = cats.expense[category]
  if (subs && sub && !subs.includes(sub)) {
    cats.expense = { ...cats.expense, [category]: [...subs, sub] }
    await saveCategories(cats)
  }
}
export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await db.config.get('settings'))?.value as Settings) }
}
export async function saveSettings(settings: Settings): Promise<void> {
  await db.config.put({ key: 'settings', value: settings })
}

// ── Transactions ─────────────────────────────────────────────────────────────
export type NewTxn = Omit<Txn, 'id' | 'currency' | 'transferId'> & { currency?: string }

async function currency(): Promise<string> {
  return (await getSettings()).baseCurrency
}

export async function addTxn(txn: NewTxn): Promise<number> {
  return db.transactions.add({ ...txn, currency: txn.currency ?? (await currency()) } as Txn)
}

export async function updateTxn(id: number, patch: Partial<Txn>): Promise<void> {
  await db.transactions.update(id, patch)
}

export async function deleteTxn(id: number): Promise<void> {
  const row = await db.transactions.get(id)
  if (row?.transferId) return deleteTransfer(row.transferId) // remove both legs
  await db.transactions.delete(id)
}

export async function listTxns(): Promise<Txn[]> {
  return (await db.transactions.toArray()).sort((a, b) => b.period.localeCompare(a.period))
}

// ── Transfers (two linked legs) ──────────────────────────────────────────────
// Mirrors store.py `_transfer_rows`: the Out leg carries the destination account
// in its Category, the In leg carries the source — so import/export round-trips.
export interface TransferInput {
  period: string
  amount: number
  from: string
  to: string
  note?: string
}

export async function addTransfer(tr: TransferInput): Promise<string> {
  const transferId = crypto.randomUUID()
  const cur = await currency()
  await db.transactions.bulkAdd([
    {
      period: tr.period, account: tr.from, amount: tr.amount, type: 'Transfer-Out',
      category: tr.to, note: tr.note, currency: cur, transferId,
    },
    {
      period: tr.period, account: tr.to, amount: tr.amount, type: 'Transfer-In',
      category: tr.from, note: tr.note, currency: cur, transferId,
    },
  ] as Txn[])
  return transferId
}

export async function updateTransfer(transferId: string, tr: TransferInput): Promise<void> {
  const cur = await currency()
  await db.transaction('rw', db.transactions, async () => {
    const legs = await db.transactions.where('transferId').equals(transferId).toArray()
    const out = legs.find((l) => l.type === 'Transfer-Out')
    const inc = legs.find((l) => l.type === 'Transfer-In')
    if (out)
      await db.transactions.update(out.id, {
        period: tr.period, account: tr.from, amount: tr.amount,
        category: tr.to, note: tr.note, currency: cur,
      })
    if (inc)
      await db.transactions.update(inc.id, {
        period: tr.period, account: tr.to, amount: tr.amount,
        category: tr.from, note: tr.note, currency: cur,
      })
  })
}

export async function deleteTransfer(transferId: string): Promise<void> {
  await db.transactions.where('transferId').equals(transferId).delete()
}
