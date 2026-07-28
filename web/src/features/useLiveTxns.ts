import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn } from '../db'

// Live-updating list of transactions, newest first — `undefined` until the first
// read resolves.
//
// Most callers want `useLiveTxns`, whose `[]` default lets a page render its
// empty state immediately. Anything that must tell "still loading" apart from
// "no transactions" needs this instead: the limit alert would otherwise see an
// empty ledger on the first pass, decide nothing is over its cap, then fire on
// every already-over limit the moment the real data lands.
export function useLiveTxnsMaybe(): Txn[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.transactions.toArray()).sort((a, b) =>
        b.period.localeCompare(a.period),
      ),
    [],
  )
}

// Live-updating list of transactions, newest first. Re-renders automatically
// whenever the on-device IndexedDB store changes.
export function useLiveTxns(): Txn[] {
  return useLiveTxnsMaybe() ?? []
}
