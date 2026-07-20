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

// ── Budget (50/30/20) ────────────────────────────────────────────────────────
// Mirrors src/analytics/budget.py DEFAULT_BUDGET. The reset day is NOT stored
// here — Budget reads it from Settings.resetDay so there's one source of truth.
export type Bucket = 'Needs' | 'Wants' | 'Savings'

export interface BudgetCfg {
  mode: 'fixed' | 'rolling'
  fixedIncome: number
  rollingMonths: number
  percentages: Record<Bucket, number>
  assignments: Record<string, Bucket> // expense category → Needs | Wants
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
}
