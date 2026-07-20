import { useLiveQuery } from 'dexie-react-hooks'
import { getAccounts, getCategories, getSettings } from '../../db'
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, DEFAULT_SETTINGS, type Categories, type Settings } from '../../data/defaults'

// Live accounts list (re-renders when Manage edits it).
export function useAccounts(): string[] {
  return useLiveQuery(() => getAccounts(), [], DEFAULT_ACCOUNTS) ?? DEFAULT_ACCOUNTS
}

// Live categories tree.
export function useCategories(): Categories {
  return useLiveQuery(() => getCategories(), [], DEFAULT_CATEGORIES) ?? DEFAULT_CATEGORIES
}

// Live full settings object.
export function useSettings(): Settings {
  return useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS
}

// Live settings-derived base currency (for display).
export function useBaseCurrency(): string {
  return useSettings().baseCurrency
}

// Live app name (drives the header brand + document title).
export function useAppName(): string {
  return useSettings().appName
}
