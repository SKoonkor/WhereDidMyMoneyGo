// UI preferences (theme / privacy / language) persisted in localStorage and
// reflected on <html data-*> — the same scheme the Dash app uses, so theme.css
// and the pre-paint script in index.html apply instantly.
import { useCallback, useSyncExternalStore } from 'react'
import { THEMES, coerceThemeId, schemeOf, type Scheme, type ThemeId } from './themes'

type Censor = 'on' | 'off'

function read(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback
}

const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function emit() {
  listeners.forEach((cb) => cb())
}

// ── Theme ────────────────────────────────────────────────────────────────────
// `pref-theme` holds a theme id (see themes.ts). Two attributes go on <html>:
// data-theme="<id>" keys the token block, data-scheme="light|dark" is for the
// rules that only care which side of the fence a theme is on (the header pill).
// `pref-theme-dark` remembers the last dark-family id, so the sun/moon pill
// takes someone who chose Pixel back to Pixel rather than to plain Dark.

export function currentThemeId(): ThemeId {
  return coerceThemeId(read('pref-theme', 'dark'))
}

export function setThemeId(id: ThemeId): void {
  localStorage.setItem('pref-theme', id)
  if (schemeOf(id) === 'dark') localStorage.setItem('pref-theme-dark', id)
  const html = document.documentElement
  html.setAttribute('data-theme', id)
  html.setAttribute('data-scheme', schemeOf(id))
  // The iOS status bar / Android address bar follow this meta, not the CSS.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES[id].chrome)
  emit()
}

export interface ThemeState {
  id: ThemeId
  scheme: Scheme
  set: (id: ThemeId) => void
  /** Light ↔ the last dark-family theme (Dark until another is chosen). */
  toggleScheme: () => void
}

export function useTheme(): ThemeState {
  const id = useSyncExternalStore(subscribe, currentThemeId)
  const toggleScheme = useCallback(() => {
    // The remembered id must itself be a dark theme, or the pill would go
    // Light → Light and look stuck.
    const lastDark = coerceThemeId(read('pref-theme-dark', 'dark'))
    setThemeId(schemeOf(currentThemeId()) === 'light'
      ? (schemeOf(lastDark) === 'dark' ? lastDark : 'dark')
      : 'light')
  }, [])
  return { id, scheme: schemeOf(id), set: setThemeId, toggleScheme }
}

export function useCensor(): [boolean, () => void] {
  const on = useSyncExternalStore(
    subscribe,
    () => read('pref-censor', 'off') === 'on',
  )
  const toggle = useCallback(() => {
    const next: Censor = read('pref-censor', 'off') === 'on' ? 'off' : 'on'
    localStorage.setItem('pref-censor', next)
    document.documentElement.setAttribute('data-censor', next)
    emit()
  }, [])
  return [on, toggle]
}

export function useLang(): ['en' | 'th', () => void] {
  const lang = useSyncExternalStore(
    subscribe,
    () => (read('pref-lang', 'en') === 'th' ? 'th' : 'en'),
  )
  const toggle = useCallback(() => {
    const next = read('pref-lang', 'en') === 'th' ? 'en' : 'th'
    localStorage.setItem('pref-lang', next)
    document.documentElement.setAttribute('data-lang', next)
    emit()
  }, [])
  return [lang, toggle]
}
