import { useLiveQuery } from 'dexie-react-hooks'
import { db, getAccounts, getCategories } from '../../db'
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, type Categories } from '../../data/defaults'

// Live accounts list (re-renders when Manage edits it).
export function useAccounts(): string[] {
  return useLiveQuery(() => getAccounts(), [], DEFAULT_ACCOUNTS) ?? DEFAULT_ACCOUNTS
}

// Live categories tree.
export function useCategories(): Categories {
  return useLiveQuery(() => getCategories(), [], DEFAULT_CATEGORIES) ?? DEFAULT_CATEGORIES
}

// Live settings-derived base currency (for display).
export function useBaseCurrency(): string {
  return (
    useLiveQuery(
      async () => ((await db.config.get('settings'))?.value as { baseCurrency?: string })?.baseCurrency ?? 'THB',
      [],
      'THB',
    ) ?? 'THB'
  )
}
