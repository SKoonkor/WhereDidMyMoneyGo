// First-run defaults — mirror the Python app's seed data so a fresh install
// starts with the same accounts and categories.
//   accounts       ← src/analytics/accounts.py DEFAULT_ACCOUNTS
//   categories     ← src/analytics/transaction_categories.py DEFAULT_CATEGORIES

export const DEFAULT_ACCOUNTS: string[] = [
  'Cash',
  'Bank Accounts',
  'Wallet',
  'Credit Card',
  'Brokerage',
  'Savings',
]

// Deletion sentinels. Deleting an account/category funnels its transactions into
// OTHER (a normal, selectable catch-all, created on demand). Deleting OTHER itself
// funnels into UNKNOWN — a name that is NOT offered in the Add form; such rows stay
// flagged in the list until the user reassigns them.
export const OTHER_NAME = 'Other'
export const UNKNOWN_NAME = 'Unknown'

// The app's display name, used in prose that refers to the app by name (kept the
// same in every language — it's the product name, not a translated phrase).
export const APP_NAME = 'Where Did My Money Go?'

// Income categories have no subcategories by design; expense categories may.
export interface Categories {
  income: Record<string, string[]>
  expense: Record<string, string[]>
}

export const DEFAULT_CATEGORIES: Categories = {
  income: {
    Gift: [],
    Salary: [],
    'Petty cash': [],
    Bonus: [],
    Other: [],
  },
  expense: {
    Bills: ['Rent', 'Phone', 'Internet', 'Electricity', 'Water', 'Tax'],
    Food: ['Breakfast', 'Lunch', 'Dinner', 'Eating out', 'Beverage', 'Ingredients'],
    Household: ['Kitchen', 'Electronics', 'Furniture', 'Toiletries', 'Tools'],
    'Social Life': ['Friend', 'Alumni', 'Trip', 'Nightout'],
    Car: ['Fuel', 'Maintenance', 'Parking'],
    Travel: ['Flights', 'Transportation'],
    Transport: ['Bus', 'Subway', 'Taxi'],
    Health: ['Supplements', 'Gym', 'Hospital', 'Medicine'],
    Family: [],
    Beauty: ['Haircut', 'Makeup', 'Cosmetics', 'Accessories'],
    Apparel: ['Clothing', 'Fashion', 'Shoes', 'Laundry'],
    Education: ['School supplies', 'Textbooks', 'Books', 'Schooling'],
    Gift: [],
    Other: [],
    Subscription: [],
  },
}

export interface Settings {
  baseCurrency: string
  appName: string
  resetDay: number // budget period start day (1–28); Budget uses it later
  // Savings pool (Financial Goals). Which accounts count toward the pool, and
  // the Emergency Fund base = monthlyRequired × targetMonths.
  savingsAccounts: string[]
  monthlyRequired: number
  targetMonths: number
}

export const DEFAULT_SETTINGS: Settings = {
  baseCurrency: 'THB',
  appName: 'Where Did My Money Go',
  resetDay: 1,
  savingsAccounts: ['Savings'],
  monthlyRequired: 20000,
  targetMonths: 3,
}

// ── Financial goals (savings pool) ───────────────────────────────────────────
// Mirrors src/analytics/goals.py. The Emergency Fund is the implied pool base
// (its target comes from Settings: monthlyRequired × targetMonths) and is NOT
// stored here. `goals` are user goals (name → target); `factors` scale a goal's
// target before it counts (xTimes rule, >1); `selected` are the goals ticked
// into the pool (EF excluded — it's always included).
export const EMERGENCY_FUND = 'Emergency Fund'

export interface GoalsCfg {
  goals: Record<string, number>
  factors: Record<string, number>
  selected: string[]
}

export const DEFAULT_GOALS: GoalsCfg = { goals: {}, factors: {}, selected: [] }

// ── Debts ────────────────────────────────────────────────────────────────────
// The mirror image of the goals above: what the user owes rather than what they
// are saving for. Analytics live in src/lib/analytics/debt.ts.
//
// A debt is either LINKED to one of the user's accounts — a credit card is
// already a default account, and everything charged to it is already in the
// ledger, so its balance and its payments need no re-entry — or STANDALONE, for a
// mortgage the user would rather not track transaction by transaction. A
// standalone debt's balance is derived forward from `openingBalance`, never
// stored, so it cannot drift out of step with its payments.

export type DebtKind = 'revolving' | 'installment'
export type PayoffStrategy = 'avalanche' | 'snowball'

// What the lender demands each month. `percent` is the revolving rule (a share of
// the balance, so the payment shrinks as the balance does); `fixed` is the
// installment rule. `floor` is the "or ฿X, whichever is greater" clause every
// real card carries — without it a pure percentage never quite reaches zero.
export interface MinPayment {
  mode: 'percent' | 'fixed'
  value: number
  floor?: number
}

export interface Debt {
  /** uuid. Names get edited; the link from a tagged transaction must not break. */
  id: string
  name: string
  kind: DebtKind
  /** Linked: the account whose (negative) balance IS this debt. */
  account?: string
  /** Standalone: where the derivation starts. */
  openingBalance?: number
  openingDate?: string
  /** Annual percentage rate. 0 for an interest-free debt. */
  apr: number
  minPayment: MinPayment
  /** Revolving only — drives the utilisation figure. */
  creditLimit?: number
  /** Day of the month the payment is due (1–31), for the reminder line. */
  dueDay?: number
}

export interface DebtsCfg {
  debts: Debt[]
  strategy: PayoffStrategy
  /** What the user puts toward debt each month ON TOP of the minimums. */
  extraPayment: number
}

// The Bank of Thailand's reduced minimum credit-card payment (8%, in force to the
// end of 2026; 10% otherwise) — the right default for this app's users, and the
// number the "paying only the minimum" warning is built around.
export const DEFAULT_CARD_MIN_PERCENT = 8
// "…or ฿500, whichever is greater", the usual floor clause.
export const DEFAULT_MIN_FLOOR = 500

export const DEFAULT_DEBTS: DebtsCfg = { debts: [], strategy: 'avalanche', extraPayment: 0 }

// ── Reconciliation state ─────────────────────────────────────────────────────
// Just the last-reconciled date (drives the "due" reminder). The adjustment rows
// themselves are ordinary transactions.
export interface ReconcileState {
  lastReconciled: string | null // ISO date, or null if never
}
export const DEFAULT_RECONCILE: ReconcileState = { lastReconciled: null }

// ── Budget (50/30/20) ────────────────────────────────────────────────────────
// Mirrors src/analytics/budget.py DEFAULT_BUDGET. The reset day is NOT stored
// here — Budget reads it from Settings.resetDay so there's one source of truth.
export type Bucket = 'Needs' | 'Wants' | 'Savings'

// Per-category / per-subcategory spending caps for the current month.
//
// Two separate maps rather than one with a sentinel key, because they mean
// genuinely different things: a CATEGORY limit is an umbrella covering every row
// in it (its subcategories included), whereas a subcategory limit covers only
// that subcategory. Note `subAssignments` uses '' to key "rows with no
// subcategory" — a sentinel here would collide with that meaning.
export interface SpendingLimits {
  categories: Record<string, number>
  subcategories: Record<string, Record<string, number>>
  /** Nudge the user once a limit has this much or less left. Base currency. */
  warnAt: number
}

export const DEFAULT_WARN_AT = 500
export const DEFAULT_LIMITS: SpendingLimits = {
  categories: {},
  subcategories: {},
  warnAt: DEFAULT_WARN_AT,
}

// Coerce a stored/restored value into a usable SpendingLimits.
//
// This is not belt-and-braces: `getBudget` merges with `{ ...DEFAULT_BUDGET,
// ...row }`, a SHALLOW spread, so a config written before limits existed (or a
// hand-edited backup carrying only `categories`) would leave `warnAt` undefined.
// `remaining <= undefined` is false, so the alert would silently never fire —
// no crash, no clue. Normalising on read closes that off.
export function normalizeLimits(raw: unknown): SpendingLimits {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<SpendingLimits>

  // A limit of zero or less is meaningless — removing a cap is deleting the key.
  const amount = (v: unknown): number | null =>
    (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

  const categories: Record<string, number> = {}
  for (const [cat, v] of Object.entries(src.categories ?? {})) {
    const n = amount(v)
    if (n !== null) categories[cat] = n
  }

  const subcategories: Record<string, Record<string, number>> = {}
  for (const [cat, subs] of Object.entries(src.subcategories ?? {})) {
    if (!subs || typeof subs !== 'object') continue
    const kept: Record<string, number> = {}
    for (const [sub, v] of Object.entries(subs)) {
      const n = amount(v)
      if (n !== null) kept[sub] = n
    }
    if (Object.keys(kept).length) subcategories[cat] = kept
  }

  const warnAt = typeof src.warnAt === 'number' && Number.isFinite(src.warnAt) && src.warnAt >= 0
    ? src.warnAt
    : DEFAULT_WARN_AT

  return { categories, subcategories, warnAt }
}

export interface BudgetCfg {
  mode: 'fixed' | 'rolling'
  fixedIncome: number
  rollingMonths: number
  percentages: Record<Bucket, number>
  assignments: Record<string, Bucket> // expense category → Needs | Wants
  // Per-subcategory overrides (category → subcat → bucket). An entry exists only
  // when it differs from the parent category's bucket; setting it equal to the
  // parent removes it (so a subcat moved back auto-collapses into its category).
  subAssignments: Record<string, Record<string, Bucket>>
  limits: SpendingLimits
}

// A sensible starting Needs/Wants map for the seed categories; anything else
// falls back to Wants (see bucketFor).
export const DEFAULT_ASSIGN: Record<string, Bucket> = {
  Bills: 'Needs', Food: 'Needs', Household: 'Needs', Health: 'Needs',
  Transport: 'Needs', Car: 'Needs', Family: 'Needs', Education: 'Needs',
  'Social Life': 'Wants', Travel: 'Wants', Beauty: 'Wants', Apparel: 'Wants',
  Gift: 'Wants', Subscription: 'Wants', Other: 'Wants',
}

export const DEFAULT_BUDGET: BudgetCfg = {
  mode: 'fixed',
  fixedIncome: 37500,
  rollingMonths: 6,
  percentages: { Needs: 50, Wants: 30, Savings: 20 },
  assignments: { ...DEFAULT_ASSIGN },
  subAssignments: {},
  limits: DEFAULT_LIMITS,
}

// ── Retirement planner inputs ────────────────────────────────────────────────
// Persisted so the page reopens with the user's last entries instead of these
// defaults. All numeric fields are kept as strings (they mirror the text inputs);
// `picked` = null means "overlay every goal" (the initial state). Numeric defaults
// mirror the Dash retirement mode (RETIRE_DEFAULTS).
export interface RetirementInputs {
  curAge: string; retAge: string; life: string
  principal: string; deposit: string; increase: string; rate: string; infl: string
  bonus: string; pension: string; expense: string
  showReal: boolean; includeGoals: boolean; useMc: boolean
  picked: string[] | null
  volReturn: string; volInfl: string; volDeposit: string
}

export const DEFAULT_RETIREMENT: RetirementInputs = {
  curAge: '30', retAge: '60', life: '85', principal: '0', deposit: '10000',
  increase: '3', rate: '6', infl: '3', bonus: '0', pension: '0', expense: '30000',
  showReal: true, includeGoals: false, useMc: false, picked: null,
  volReturn: '15', volInfl: '1', volDeposit: '2',
}

// ── Daily reminder notifications ─────────────────────────────────────────────
// Off by default. When on, the app nudges the user to record expenses at `time`
// (local "HH:MM"). Delivery is best-effort and platform-dependent — see
// src/lib/notify.ts (Notification Triggers where supported; in-app-only elsewhere).
export interface NotificationCfg {
  enabled: boolean
  time: string // 'HH:MM' (24h, local)
}

export const DEFAULT_NOTIFICATIONS: NotificationCfg = { enabled: false, time: '20:00' }

// ── AI receipt scanning (bring-your-own-key) ─────────────────────────────────
// Off by default → manual entry. When on with a key, long-pressing the "+" opens
// the receipt scanner. The key is stored only on this device and sent only to the
// chosen provider. 'claude' and 'gemini' both work directly from the browser
// (CORS); 'openai' stays in the union for a future proxy but isn't selectable yet.
export type AiProvider = 'claude' | 'openai' | 'gemini'

export interface AiCfg {
  enabled: boolean
  provider: AiProvider
  apiKey: string
  model: string
  confirmBeforeSave: boolean // ask the user to review extracted details before recording
  detailsCollapsed: boolean // hide the key/model/etc. once set up (UI-only; toggled in Settings)
}

// Default vision model per provider. Used to seed the model field and to reset it
// when the user switches providers (a Claude model id is meaningless to Gemini).
// Model names change often — the Settings model field is free-text, and a
// "See available models" link points at each provider's live model list.
export const AI_MODELS: Record<AiProvider, string> = {
  claude: 'claude-sonnet-5',
  gemini: 'gemini-3.5-flash',
  openai: 'gpt-4o',
}

// Each provider's official, always-current model list (no server needed — the
// user reads it themselves and types the name in).
export const AI_MODELS_URL: Record<AiProvider, string> = {
  claude: 'https://docs.anthropic.com/en/docs/about-claude/models',
  gemini: 'https://ai.google.dev/gemini-api/docs/models',
  openai: 'https://platform.openai.com/docs/models',
}

export const DEFAULT_AI: AiCfg = {
  enabled: false,
  provider: 'claude',
  apiKey: '',
  model: AI_MODELS.claude,
  confirmBeforeSave: true,
  detailsCollapsed: false,
}
