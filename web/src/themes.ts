// The themes the app can wear. A theme is an id (what `pref-theme` stores and
// what theme.css keys its token block on) plus a scheme: whether it is a light
// or a dark look. The scheme is what the binary consumers care about — the
// header's sun/moon pill and the savings gauge's bands — so they keep working as
// themes are added without learning each id.
//
// Adding a theme = one entry here + one `:root[data-theme='<id>']` block in
// theme.css + a card in SettingsPage. The pre-paint script in index.html keeps
// its own copy of the id list (it runs before any module loads); themes.test.ts
// checks the two agree.

export type Scheme = 'light' | 'dark'
export type ThemeId = 'light' | 'dark' | 'pixel'

// `chrome` is the <meta name="theme-color"> value (browser/status bar). Light and
// Dark keep the app's original teal; Pixel blends into its own background.
export const THEMES: Record<ThemeId, { scheme: Scheme; chrome: string }> = {
  light: { scheme: 'light', chrome: '#1abc9c' },
  dark: { scheme: 'dark', chrome: '#1abc9c' },
  pixel: { scheme: 'dark', chrome: '#0c1a1c' },
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]
export const DEFAULT_THEME: ThemeId = 'dark'

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(THEMES, v)
}

/** Resolve whatever is in storage to a real id; unknown or missing → default. */
export function coerceThemeId(v: unknown): ThemeId {
  return isThemeId(v) ? v : DEFAULT_THEME
}

export const schemeOf = (id: ThemeId): Scheme => THEMES[id].scheme
