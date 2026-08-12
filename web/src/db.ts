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
  DEFAULT_BUDGET,
  DEFAULT_CATEGORIES,
  DEFAULT_AI,
  DEFAULT_DEBTS,
  DEFAULT_GOALS,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_RECONCILE,
  DEFAULT_RETIREMENT,
  DEFAULT_SETTINGS,
  DEFAULT_TRADING,
  OTHER_NAME,
  UNKNOWN_NAME,
  normalizeLimits,
  type AiCfg,
  type BudgetCfg,
  type Categories,
  type DebtsCfg,
  type GoalsCfg,
  type NotificationCfg,
  type ReconcileState,
  type RetirementInputs,
  type Settings,
} from './data/defaults'
import type { SimTime, Timeframe } from './lib/trading/types'
import { DEFAULT_TAX, type TaxCfg } from './lib/analytics/income_tax'
import {
  DEFAULT_HOME_LAYOUT, applyLegacyCollapsed, normalizeLayout, type HomeLayout,
} from './lib/homeLayout'
import { remapBudget, type BudgetRename } from './lib/analytics/budgetMaintenance'
import { RECON_CATEGORY, ADJUST_IN, ADJUST_OUT } from './lib/analytics/reconcile'
import { UNALLOCATED, allocations, type GoalMove, type NewGoalMove } from './lib/analytics/goalSavings'

// Signed types stored on rows (the Dash "Income/Expense" column). The user-facing
// "add" choices are Income / Expense / Transfer; a Transfer expands into the two
// -In/-Out legs, and reconciliation writes the Adjustment legs later. (Saving is
// kept in the union only for defensive handling of any legacy/imported rows —
// saving is modelled as a Transfer into a savings account.)
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
  // The standalone debt (by id) this row pays toward or borrows from. Only ever
  // set on rows for a debt that ISN'T linked to an account — a linked debt reads
  // its own account's rows and needs no tag. See lib/analytics/debt.ts.
  debt?: string
}

interface ConfigRow {
  key: 'accounts' | 'categories' | 'settings' | 'budget' | 'goals' | 'debts' | 'reconcile' | 'tax' | 'retirement' | 'notifications' | 'ai' | 'home' | 'trading'
  value: unknown
}

// ── The paper-trading sandbox (v5) ───────────────────────────────────────────
// Five stores that belong to the simulator and to nothing else. They are separate
// tables rather than tagged rows in `transactions` for one reason above all the
// others: the sandbox trades imaginary money, and keeping it in its own stores is
// what makes `resetSandbox()` a table wipe instead of a filtered delete whose
// filter could one day be wrong and take real transactions with it.
//
// The row shapes below declare the primary key and the INDEXED columns, and stop
// there. The rest of each record — a BrokerAccount's positions and orders, a
// Trade's price and fee, a WorldSnapshot's market state — rides along as stored
// data whose shape belongs to lib/trading/, which db.ts deliberately does not
// import: the ledger must not learn the sandbox's internals. Exactly one module,
// features/trading/store.ts, knows both sides.

/** One paper account. The key is the account's own uuid, so a save is idempotent. */
export interface SimAccountRow { id: string }

/** One executed trade. A Trade carries its own uuid, which becomes the row key —
 *  so re-writing a batch after a failed flush updates rows instead of throwing
 *  ConstraintError and losing the rest of the batch. `++` covers a row written
 *  without one. */
export interface SimTradeRow { id: number | string; accountId: string; t: SimTime; symbol: string }

/** One point on an account's equity curve — small enough to declare whole. */
export interface SimEquityRow { id: number; accountId: string; t: SimTime; v: number }

/** The world, as a singleton row under the key 'world'. */
export interface SimWorldRow { id: 'world' }

/**
 * BAR_CHUNK candles packed into one row, columns as typed arrays.
 *
 * Two things make this the shape rather than a row per candle. IndexedDB
 * structured-clones a Float64Array natively and fast, with none of the
 * per-element boxing an array of objects costs; and a thousand candles written
 * one row at a time is a thousand IndexedDB commits, which on Safari land on the
 * main thread and stutter the very chart they are there to draw.
 *
 * The columns mirror CandleSeries exactly, `n` (the trade count in the bar)
 * included. It is tempting to drop `n` as a generation-time detail, but it is
 * what volume is bucketed by, so a reloaded series without it draws a visibly
 * different volume histogram from the one the user was looking at.
 */
export interface SimBarChunk {
  id: number
  symbol: string
  tf: Timeframe
  t0: SimTime
  count: number
  t: Float64Array; o: Float64Array; h: Float64Array
  l: Float64Array; c: Float64Array; v: Float64Array; n: Float64Array
}

/** Candles per `simBars` row. */
export const BAR_CHUNK = 500

const db = new Dexie('money-tracker') as Dexie & {
  transactions: EntityTable<Txn, 'id'>
  config: EntityTable<ConfigRow, 'key'>
  goalMoves: EntityTable<GoalMove, 'id'>
  simAccounts: EntityTable<SimAccountRow, 'id'>
  simTrades: EntityTable<SimTradeRow, 'id'>
  simEquity: EntityTable<SimEquityRow, 'id'>
  simWorld: EntityTable<SimWorldRow, 'id'>
  simBars: EntityTable<SimBarChunk, 'id'>
}

// v1 shipped only `transactions`. v2 adds the transferId index + the config store.
// v3 adds `goalMoves` — the per-goal allocation layer. v4 adds the `debt` index,
// which tags a row as a payment toward (or a draw on) a standalone debt. v5 adds
// the five paper-trading stores; it is purely additive, so an existing ledger
// upgrades with nothing rewritten and nothing to lose. Dexie needs the whole
// schema restated per version, so earlier stores are repeated.
db.version(1).stores({ transactions: '++id, period, account, type, category' })
db.version(2).stores({
  transactions: '++id, period, account, type, category, transferId',
  config: 'key',
})
db.version(3).stores({
  transactions: '++id, period, account, type, category, transferId',
  config: 'key',
  goalMoves: '++id, period, transferId',
})
db.version(4).stores({
  transactions: '++id, period, account, type, category, transferId, debt',
  config: 'key',
  goalMoves: '++id, period, transferId',
})
db.version(5).stores({
  transactions: '++id, period, account, type, category, transferId, debt',
  config: 'key',
  goalMoves: '++id, period, transferId',
  simAccounts: 'id',                    // uuid string
  simTrades: '++id, accountId, t, symbol, [accountId+t]',
  simEquity: '++id, accountId, t, [accountId+t]',
  simWorld: 'id',                       // singleton, id = 'world'
  simBars: '++id, [symbol+tf], t0, [symbol+tf+t0]',
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
  if (!existing.has('budget')) puts.push({ key: 'budget', value: DEFAULT_BUDGET })
  if (!existing.has('goals')) puts.push({ key: 'goals', value: DEFAULT_GOALS })
  if (!existing.has('debts')) puts.push({ key: 'debts', value: DEFAULT_DEBTS })
  if (!existing.has('reconcile')) puts.push({ key: 'reconcile', value: DEFAULT_RECONCILE })
  if (!existing.has('tax')) puts.push({ key: 'tax', value: DEFAULT_TAX })
  if (!existing.has('notifications')) puts.push({ key: 'notifications', value: DEFAULT_NOTIFICATIONS })
  if (!existing.has('ai')) puts.push({ key: 'ai', value: DEFAULT_AI })
  if (!existing.has('trading')) puts.push({ key: 'trading', value: DEFAULT_TRADING })
  // The Home layout starts as the pre-editor arrangement, carrying over whichever
  // boxes the user had folded before 0.4 (collapse state used to live in
  // localStorage, keyed by the same ids the singleton uids use).
  if (!existing.has('home')) {
    puts.push({ key: 'home', value: applyLegacyCollapsed(DEFAULT_HOME_LAYOUT, readLegacyCollapsed()) })
  }
  if (puts.length) await db.config.bulkPut(puts)
}

// Pre-0.4 CollapsibleCard collapse state. Read once during seeding and then left
// alone — deleting it costs nothing to keep and means a stale service-worker
// shell serving an older build still finds the user's folds.
function readLegacyCollapsed(): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = JSON.parse(localStorage.getItem('home-collapsed') || '[]') as unknown
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
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
// ── Manage: rename / delete / reorder (mirrors manage.py) ────────────────────
// Every leg of a transfer stores its own account in `account` and the *other*
// account in `category`, so an account can appear in either column.

// How many transactions reference each account (by its own `account` column —
// which, for transfers, covers both legs). Blocks deleting an account in use.
export async function accountUsage(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const r of await db.transactions.toArray()) counts[r.account] = (counts[r.account] ?? 0) + 1
  return counts
}

// How many transactions use each category of a kind. Transfer legs are typed
// Transfer-In/-Out (their `category` holds an account), so filtering by the
// Income/Expense type correctly excludes them.
export async function categoryUsage(kind: 'income' | 'expense'): Promise<Record<string, number>> {
  const type: TxnType = kind === 'income' ? 'Income' : 'Expense'
  const counts: Record<string, number> = {}
  for (const r of await db.transactions.toArray()) {
    if (r.type === type) counts[r.category] = (counts[r.category] ?? 0) + 1
  }
  return counts
}

// How many Expense transactions use each subcategory of a category.
export async function subcategoryUsage(category: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const r of await db.transactions.toArray()) {
    if (r.type === 'Expense' && r.category === category && r.subcategory)
      counts[r.subcategory] = (counts[r.subcategory] ?? 0) + 1
  }
  return counts
}

// Rename an account everywhere: the config list (position kept) AND every
// transaction — both a leg's own `account` and any transfer counterpart stored
// in `category`. No-op on an empty/clashing name (caller surfaces the clash).
export async function renameAccount(oldName: string, newName: string): Promise<boolean> {
  const name = newName.trim()
  const accounts = await getAccounts()
  if (!name || !accounts.includes(oldName) || (name !== oldName && accounts.includes(name)))
    return false
  await saveAccounts(accounts.map((a) => (a === oldName ? name : a)))
  await db.transaction('rw', db.transactions, async () => {
    await db.transactions.where('account').equals(oldName).modify({ account: name })
    await db.transactions
      .filter((r) => (r.type === 'Transfer-In' || r.type === 'Transfer-Out') && r.category === oldName)
      .modify({ category: name })
  })
  return true
}

// Delete an account and reassign its transactions: a normal account funnels into
// "Other" (created if missing); deleting "Other" funnels into "Unknown". Covers
// both a leg's own `account` and a transfer counterpart stored in `category`.
export async function deleteAccount(name: string): Promise<void> {
  const dest = name === OTHER_NAME ? UNKNOWN_NAME : OTHER_NAME
  const accounts = (await getAccounts()).filter((a) => a !== name)
  if (dest === OTHER_NAME && !accounts.includes(OTHER_NAME)) accounts.push(OTHER_NAME)
  await saveAccounts(accounts)
  await db.transaction('rw', db.transactions, async () => {
    await db.transactions.where('account').equals(name).modify({ account: dest })
    await db.transactions
      .filter((r) => (r.type === 'Transfer-In' || r.type === 'Transfer-Out') && r.category === name)
      .modify({ category: dest })
  })
}

export async function reorderAccounts(order: string[]): Promise<void> {
  await saveAccounts(order)
}

// Rename a category: swap the key in place (keeping order + subcategories) and
// cascade to every Income/Expense transaction of that kind.
export async function renameCategory(
  kind: 'income' | 'expense',
  oldName: string,
  newName: string,
): Promise<boolean> {
  const name = newName.trim()
  const cats = await getCategories()
  const group = cats[kind]
  if (!name || !(oldName in group) || (name !== oldName && name in group)) return false
  cats[kind] = Object.fromEntries(
    Object.entries(group).map(([k, v]) => [k === oldName ? name : k, v]),
  )
  await saveCategories(cats)
  const type: TxnType = kind === 'income' ? 'Income' : 'Expense'
  await db.transactions
    .filter((r) => r.type === type && r.category === oldName)
    .modify({ category: name })
  // Budget buckets and spending limits are keyed by name — carry them across, or
  // the limit quietly stops capping and the bucket falls back to Wants.
  if (kind === 'expense') await remapBudgetCfg({ kind: 'category', from: oldName, to: name })
  return true
}

// Apply a rename/delete to the budget config. Kept next to the callers so every
// category mutation remembers to do it.
async function remapBudgetCfg(op: BudgetRename): Promise<void> {
  await saveBudget(remapBudget(await getBudget(), op))
}

// Delete a category and reassign its transactions: a normal category funnels into
// "Other" (created if missing); deleting "Other" funnels into "Unknown". The old
// subcategory is dropped (it belonged to the deleted category).
export async function deleteCategory(kind: 'income' | 'expense', name: string): Promise<void> {
  const type: TxnType = kind === 'income' ? 'Income' : 'Expense'
  const dest = name === OTHER_NAME ? UNKNOWN_NAME : OTHER_NAME
  const cats = await getCategories()
  delete cats[kind][name]
  if (dest === OTHER_NAME && !(OTHER_NAME in cats[kind])) cats[kind] = { ...cats[kind], [OTHER_NAME]: [] }
  await saveCategories(cats)
  await db.transactions
    .filter((r) => r.type === type && r.category === name)
    .modify((r) => { r.category = dest; delete r.subcategory })
  if (kind === 'expense') await remapBudgetCfg({ kind: 'category-delete', name, into: dest })
}

export async function reorderCategories(kind: 'income' | 'expense', order: string[]): Promise<void> {
  const cats = await getCategories()
  const group = cats[kind]
  cats[kind] = Object.fromEntries(order.filter((k) => k in group).map((k) => [k, group[k]]))
  await saveCategories(cats)
}

// Rename a subcategory within an expense category, cascading to matching rows.
export async function renameSubcategory(
  category: string,
  oldName: string,
  newName: string,
): Promise<boolean> {
  const name = newName.trim()
  const cats = await getCategories()
  const subs = cats.expense[category]
  if (!subs || !name || !subs.includes(oldName) || (name !== oldName && subs.includes(name)))
    return false
  cats.expense = { ...cats.expense, [category]: subs.map((s) => (s === oldName ? name : s)) }
  await saveCategories(cats)
  await db.transactions
    .filter((r) => r.type === 'Expense' && r.category === category && r.subcategory === oldName)
    .modify({ subcategory: name })
  await remapBudgetCfg({ kind: 'sub', category, from: oldName, to: name })
  return true
}

// Delete a subcategory. Affected transactions keep their main category — only the
// subcategory tag is dropped.
export async function deleteSubcategory(category: string, name: string): Promise<void> {
  const cats = await getCategories()
  const subs = cats.expense[category]
  if (subs) {
    cats.expense = { ...cats.expense, [category]: subs.filter((s) => s !== name) }
    await saveCategories(cats)
  }
  await db.transactions
    .filter((r) => r.type === 'Expense' && r.category === category && r.subcategory === name)
    .modify((r) => { delete r.subcategory })
  await remapBudgetCfg({ kind: 'sub-delete', category, name })
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await db.config.get('settings'))?.value as Settings) }
}
export async function saveSettings(settings: Settings): Promise<void> {
  await db.config.put({ key: 'settings', value: settings })
}

export async function getBudget(): Promise<BudgetCfg> {
  const row = (await db.config.get('budget'))?.value as Partial<BudgetCfg> | undefined
  // `limits` is normalized rather than merged: the spread above is shallow, so a
  // config saved before limits existed would otherwise arrive half-formed.
  return { ...DEFAULT_BUDGET, ...row, limits: normalizeLimits(row?.limits) }
}
export async function saveBudget(cfg: BudgetCfg): Promise<void> {
  await db.config.put({ key: 'budget', value: cfg })
}

export async function getGoals(): Promise<GoalsCfg> {
  return { ...DEFAULT_GOALS, ...((await db.config.get('goals'))?.value as GoalsCfg) }
}
export async function saveGoals(cfg: GoalsCfg): Promise<void> {
  await db.config.put({ key: 'goals', value: cfg })
}

// Like the Home layout and unlike the other getters, `debts` is NOT merged with
// its default: the debt list is an ordered collection, not a patchable record, and
// `{ ...DEFAULT_DEBTS, ...row }` would be fine today but silently resurrect an
// empty list the moment the default gains a seeded entry. Fall back wholesale.
export async function getDebts(): Promise<DebtsCfg> {
  const row = (await db.config.get('debts'))?.value as Partial<DebtsCfg> | undefined
  if (!row || !Array.isArray(row.debts)) return DEFAULT_DEBTS
  return {
    debts: row.debts,
    strategy: row.strategy === 'snowball' ? 'snowball' : 'avalanche',
    extraPayment: Number.isFinite(row.extraPayment) ? Number(row.extraPayment) : 0,
  }
}
export async function saveDebts(cfg: DebtsCfg): Promise<void> {
  await db.config.put({ key: 'debts', value: cfg })
}

// Remove a debt and untag whatever pointed at it. Only standalone debts have
// tagged rows; a linked debt's transactions belong to its account and must be left
// exactly as they are — deleting the debt record forgets the terms, not the money.
export async function deleteDebt(id: string): Promise<void> {
  const cfg = await getDebts()
  await saveDebts({ ...cfg, debts: cfg.debts.filter((d) => d.id !== id) })
  await db.transactions.where('debt').equals(id).modify((r) => { delete r.debt })
}

export async function getRetirementInputs(): Promise<RetirementInputs> {
  return { ...DEFAULT_RETIREMENT, ...((await db.config.get('retirement'))?.value as RetirementInputs) }
}
export async function saveRetirementInputs(v: RetirementInputs): Promise<void> {
  await db.config.put({ key: 'retirement', value: v })
}

// The Home screen arrangement. Deliberately NOT the `{ ...DEFAULT, ...value }`
// merge the other getters use: a layout is an ordered list, not a patchable
// record, and spreading would resurrect every widget the user removed. An absent
// row falls back to the default; a present-but-empty one is a valid empty Home.
export async function getHomeLayout(): Promise<HomeLayout> {
  const row = await db.config.get('home')
  return row ? normalizeLayout(row.value) : DEFAULT_HOME_LAYOUT
}
export async function saveHomeLayout(layout: HomeLayout): Promise<void> {
  await db.config.put({ key: 'home', value: layout })
}

export async function getReconcileState(): Promise<ReconcileState> {
  return { ...DEFAULT_RECONCILE, ...((await db.config.get('reconcile'))?.value as ReconcileState) }
}
export async function saveReconcileState(state: ReconcileState): Promise<void> {
  await db.config.put({ key: 'reconcile', value: state })
}

export async function getTax(): Promise<TaxCfg> {
  return { ...DEFAULT_TAX, ...((await db.config.get('tax'))?.value as TaxCfg) }
}
export async function saveTax(cfg: TaxCfg): Promise<void> {
  await db.config.put({ key: 'tax', value: cfg })
}

export async function getNotifications(): Promise<NotificationCfg> {
  return { ...DEFAULT_NOTIFICATIONS, ...((await db.config.get('notifications'))?.value as NotificationCfg) }
}
export async function saveNotifications(cfg: NotificationCfg): Promise<void> {
  await db.config.put({ key: 'notifications', value: cfg })
}

export async function getAi(): Promise<AiCfg> {
  return { ...DEFAULT_AI, ...((await db.config.get('ai'))?.value as AiCfg) }
}
export async function saveAi(cfg: AiCfg): Promise<void> {
  await db.config.put({ key: 'ai', value: cfg })
}

// Record a balance-adjustment per account whose actual balance differs from the
// tracked balance (|delta| ≥ half a cent): Adjustment-In for a positive gap,
// Adjustment-Out for a negative one. These carry the recorded "hidden cost". The
// reconciliation is always stamped as done today.
//
// Reconciling the same account twice on the same day MERGES into a single row for
// that day: any existing same-day Reconciliation rows for the account are folded
// into one (signed) row, and a net-zero result removes it entirely. Returns the
// number of accounts affected.
export async function applyReconciliation(
  adjustments: Array<{ account: string; delta: number }>,
  period?: string,
): Promise<number> {
  const EPS = 0.005
  const day = period ?? new Date().toISOString().slice(0, 10)
  const cur = await currency()
  const pending = adjustments.filter((a) => Math.abs(a.delta) >= EPS)
  if (pending.length === 0) {
    await saveReconcileState({ lastReconciled: day })
    return 0
  }

  // Existing same-day Reconciliation rows, grouped per account (signed + row ids).
  const sameDay = (await db.transactions.where('period').equals(day).toArray()).filter(
    (r) => r.category === RECON_CATEGORY && (r.type === ADJUST_IN || r.type === ADJUST_OUT),
  )
  const existing: Record<string, { signed: number; ids: number[] }> = {}
  for (const r of sameDay) {
    const e = existing[r.account] ?? (existing[r.account] = { signed: 0, ids: [] })
    e.signed += r.type === ADJUST_IN ? r.amount : -r.amount
    e.ids.push(r.id)
  }

  let changed = 0
  await db.transaction('rw', db.transactions, async () => {
    for (const a of pending) {
      const prior = existing[a.account]
      const combined = Math.round(((prior?.signed ?? 0) + a.delta) * 100) / 100
      if (prior?.ids.length) await db.transactions.bulkDelete(prior.ids) // collapse prior rows
      if (Math.abs(combined) >= EPS) {
        await db.transactions.add({
          period: day,
          account: a.account,
          amount: Math.round(Math.abs(combined) * 100) / 100,
          type: combined > 0 ? ADJUST_IN : ADJUST_OUT,
          category: RECON_CATEGORY,
          currency: cur,
        } as Txn)
      }
      changed++
    }
  })
  await saveReconcileState({ lastReconciled: day })
  return changed
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
  // Optional goal to earmark this transfer against, when it crosses the savings
  // pool boundary. Creates a linked GoalMove — see goalMoveFor below.
  goal?: string
}

// The allocation move a transfer implies, or null if it implies none.
//
// The direction is derived rather than asked for: money arriving in the pool goes
// Unallocated → goal, money leaving comes goal → Unallocated. A transfer with the
// pool on BOTH sides (Savings → Brokerage, both ticked) or NEITHER doesn't change
// the pool at all, so tagging it with a goal would be meaningless — hence the
// `inPool === outPool` guard rather than two separate checks.
//
// Reads settings itself, so callers must resolve it BEFORE opening an rw
// transaction: `config` is outside the transaction's table scope.
async function goalMoveFor(tr: TransferInput, transferId: string): Promise<NewGoalMove | null> {
  if (!tr.goal) return null
  const pool = new Set((await getSettings()).savingsAccounts)
  const inPool = pool.has(tr.to)
  const outPool = pool.has(tr.from)
  if (inPool === outPool) return null
  return {
    period: tr.period,
    from: inPool ? UNALLOCATED : tr.goal,
    to: inPool ? tr.goal : UNALLOCATED,
    amount: tr.amount,
    note: tr.note,
    transferId,
  }
}

export async function addTransfer(tr: TransferInput): Promise<string> {
  const transferId = crypto.randomUUID()
  const cur = await currency()
  const move = await goalMoveFor(tr, transferId)
  await db.transaction('rw', db.transactions, db.goalMoves, async () => {
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
    if (move) await db.goalMoves.add(move as GoalMove)
  })
  return transferId
}

export async function updateTransfer(transferId: string, tr: TransferInput): Promise<void> {
  const cur = await currency()
  // Rewritten rather than patched: the goal, the direction and the amount can all
  // change at once, and dropping the old move first keeps that from needing cases.
  const move = await goalMoveFor(tr, transferId)
  await db.transaction('rw', db.transactions, db.goalMoves, async () => {
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
    await db.goalMoves.where('transferId').equals(transferId).delete()
    if (move) await db.goalMoves.add(move as GoalMove)
  })
}

export async function deleteTransfer(transferId: string): Promise<void> {
  await db.goalMoves.where('transferId').equals(transferId).delete()
  await db.transactions.where('transferId').equals(transferId).delete()
}

// ── Per-goal savings (the allocation layer) ──────────────────────────────────
// These rows earmark parts of the savings pool for individual goals. They move no
// real money, which is why they live in their own table — see lib/analytics/goalSavings.ts.

export async function listGoalMoves(): Promise<GoalMove[]> {
  return (await db.goalMoves.toArray()).sort((a, b) => b.period.localeCompare(a.period))
}

export async function addGoalMove(move: NewGoalMove): Promise<number> {
  return db.goalMoves.add(move as GoalMove)
}

export async function updateGoalMove(id: number, patch: Partial<GoalMove>): Promise<void> {
  await db.goalMoves.update(id, patch)
}

export async function deleteGoalMove(id: number): Promise<void> {
  await db.goalMoves.delete(id)
}

// Which goal (if any) a transfer is earmarked against — the value that prefills
// the edit form's goal picker. '' when the transfer has no linked move.
export async function getTransferGoal(transferId: string): Promise<string> {
  const move = await db.goalMoves.where('transferId').equals(transferId).first()
  if (!move) return ''
  // One end is always UNALLOCATED on a transfer-linked move; the other is the goal.
  return move.to === UNALLOCATED ? move.from : move.to
}

// Delete a goal, refunding whatever it still holds back to the unallocated pool.
//
// A refund MOVE rather than deleting the goal's history: the activity list still
// explains where the money went, and the arithmetic self-heals — leaving the old
// moves in place with no compensating entry would silently strand the amount,
// since `unallocatedAmount` subtracts every allocation it finds.
export async function deleteGoal(name: string): Promise<void> {
  const held = allocations(await db.goalMoves.toArray())[name] ?? 0
  if (held !== 0) {
    await db.goalMoves.add({
      period: new Date().toISOString().slice(0, 10),
      // A negative holding refunds the other way, so the goal still lands on zero.
      from: held > 0 ? name : UNALLOCATED,
      to: held > 0 ? UNALLOCATED : name,
      amount: Math.abs(held),
    } as GoalMove)
  }
  const cfg = await getGoals()
  const goals = { ...cfg.goals }
  const factors = { ...cfg.factors }
  delete goals[name]
  delete factors[name]
  await saveGoals({ goals, factors, selected: cfg.selected.filter((g) => g !== name) })
}
