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
}

export const DEFAULT_SETTINGS: Settings = {
  baseCurrency: 'THB',
  appName: 'Where Did My Money Go',
  resetDay: 1,
}
