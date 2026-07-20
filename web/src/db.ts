// On-device data store (IndexedDB via Dexie). This is the "data stays on the
// phone" layer — nothing here ever leaves the browser. The ledger schema mirrors
// the Dash app: Period, Account, Amount, Income/Expense, Category.
import Dexie, { type EntityTable } from 'dexie'

export type TxnType = 'Income' | 'Expense'

export interface Txn {
  id: number
  // ISO date string (YYYY-MM-DD or full ISO) — the app's "Period".
  period: string
  account: string
  amount: number
  type: TxnType
  category: string
  note?: string
}

const db = new Dexie('money-tracker') as Dexie & {
  transactions: EntityTable<Txn, 'id'>
}

// v1 — the ledger. Indexes we query by; `++id` is the auto PK.
db.version(1).stores({
  transactions: '++id, period, account, type, category',
})

export { db }

// --- Convenience helpers (thin; feature code can also use `db` directly) ---

export async function addTxn(txn: Omit<Txn, 'id'>): Promise<number> {
  return db.transactions.add(txn as Txn)
}

export async function listTxns(): Promise<Txn[]> {
  // Newest first.
  return (await db.transactions.toArray()).sort((a, b) =>
    b.period.localeCompare(a.period),
  )
}

export async function deleteTxn(id: number): Promise<void> {
  await db.transactions.delete(id)
}
