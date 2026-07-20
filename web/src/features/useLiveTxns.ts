import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn } from '../db'

// Live-updating list of transactions, newest first. Re-renders automatically
// whenever the on-device IndexedDB store changes.
export function useLiveTxns(): Txn[] {
  return (
    useLiveQuery(
      async () =>
        (await db.transactions.toArray()).sort((a, b) =>
          b.period.localeCompare(a.period),
        ),
      [],
      [] as Txn[],
    ) ?? []
  )
}
