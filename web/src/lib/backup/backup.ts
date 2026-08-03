// Full on-device backup & restore: transactions + accounts + categories +
// settings as one JSON document. Restore is a full replace (guarded by a
// confirm in the UI). Nothing here talks to a server.
import {
  db, listTxns, listGoalMoves, getAccounts, getCategories, getSettings, getBudget, getGoals,
  getDebts, getReconcileState, getTax, getHomeLayout, saveAccounts, saveCategories, saveSettings,
  saveBudget, saveGoals, saveDebts, saveReconcileState, saveTax, saveHomeLayout, type Txn,
} from '../../db'
import type { BudgetCfg, Categories, DebtsCfg, GoalsCfg, ReconcileState, Settings } from '../../data/defaults'
import type { TaxCfg } from '../analytics/income_tax'
import type { GoalMove } from '../analytics/goalSavings'
import { normalizeLayout, type HomeLayout } from '../homeLayout'

const APP_TAG = 'where-did-my-money-go'
// v1 bundled transactions/accounts/categories/settings. v2 adds budget + goals +
// reconcile config; v3 adds tax config; v4 adds the Home screen layout; v5 adds
// the per-goal allocation moves; v6 adds the debts config. Older files still
// restore (the new keys are optional and left as-is when absent).
//
// v5 earns its bump where the 0.4.0 spending limits didn't: those were an extra
// field on a config object that already travelled, whereas goal moves are a whole
// table a v4 file has no way to represent.
//
// v6 is the debts config. The `debt` tag on a transaction needs no version of its
// own — it rides along inside the transaction rows, which have always travelled
// whole. Debt ids are uuids, so a restore keeps every tag pointing at its debt
// even though IndexedDB reassigns the row ids around them.
const BACKUP_VERSION = 6

export interface Backup {
  app: typeof APP_TAG
  version: number
  exportedAt: string
  transactions: Txn[]
  accounts: string[]
  categories: Categories
  settings: Settings
  budget?: BudgetCfg
  goals?: GoalsCfg
  reconcile?: ReconcileState
  tax?: TaxCfg
  home?: HomeLayout
  goalMoves?: GoalMove[]
  debts?: DebtsCfg
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
    budget: await getBudget(),
    goals: await getGoals(),
    reconcile: await getReconcileState(),
    tax: await getTax(),
    home: await getHomeLayout(),
    goalMoves: await listGoalMoves(),
    debts: await getDebts(),
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
    throw new Error("This doesn't look like a Where Did My Money Go? backup file.")
  }
  return b as Backup
}

export interface RestoreResult { transactions: number; accounts: number }

// Replace ALL local data with the backup's contents. Transaction ids are
// dropped so IndexedDB reassigns them (transfer links use uuids in `transferId`,
// which are preserved, so pairs stay linked).
export async function restoreBackup(b: Backup): Promise<RestoreResult> {
  await db.transaction('rw', db.transactions, db.config, db.goalMoves, async () => {
    await db.transactions.clear()
    await db.transactions.bulkAdd(b.transactions.map(({ id: _id, ...rest }) => rest as Txn))
    await saveAccounts(b.accounts)
    await saveCategories(b.categories)
    if (b.settings) await saveSettings(b.settings)
    // v2 keys — only overwrite when the backup carries them, so restoring an
    // older v1 file leaves the current budget/goals config untouched.
    if (b.budget) await saveBudget(b.budget)
    if (b.goals) await saveGoals(b.goals)
    if (b.debts) await saveDebts(b.debts)
    if (b.reconcile) await saveReconcileState(b.reconcile)
    if (b.tax) await saveTax(b.tax)
    // Normalized on the way in — a backup file is untrusted input, and one
    // written by a newer build may name widgets this version can't render.
    if (b.home) await saveHomeLayout(normalizeLayout(b.home))
    // v5 — goal allocation moves. Ids are dropped like transaction ids are, and
    // for the same reason: IndexedDB reassigns them. The link back to a transfer
    // rides in `transferId`, a uuid, so tagged transfers stay tagged.
    if (b.goalMoves) {
      await db.goalMoves.clear()
      await db.goalMoves.bulkAdd(b.goalMoves.map(({ id: _id, ...rest }) => rest as GoalMove))
    }
  })
  return { transactions: b.transactions.length, accounts: b.accounts.length }
}
