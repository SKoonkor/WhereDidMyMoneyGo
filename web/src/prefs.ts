// UI preferences (theme / privacy / language) persisted in localStorage and
// reflected on <html data-*> — the same scheme the Dash app uses, so theme.css
// and the pre-paint script in index.html apply instantly.
import { useCallback, useSyncExternalStore } from 'react'

type Theme = 'dark' | 'light'
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

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    subscribe,
    () => (read('pref-theme', 'dark') as Theme),
  )
  const toggle = useCallback(() => {
    const next: Theme = read('pref-theme', 'dark') === 'light' ? 'dark' : 'light'
    localStorage.setItem('pref-theme', next)
    document.documentElement.setAttribute('data-theme', next)
    emit()
  }, [])
  return [theme, toggle]
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
