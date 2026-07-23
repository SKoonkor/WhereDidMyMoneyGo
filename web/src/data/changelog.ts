// App version history (SemVer — https://semver.org).
//
// This is the single source of truth for the app's version and its user-facing
// release notes (shown via the "Version history" link at the bottom of Settings).
//
// Keep entries NEWEST-FIRST: the first entry is the current running version and is
// marked "(this version)" in the UI. On each release, add a new entry on top.
//   patch (0.0.x) = bug fixes · minor (0.x.0) = new backwards-compatible features ·
//   major (x.0.0) = breaking changes.
//
// Each `text` and the kind labels are English strings that double as i18n keys, so
// they translate through t() at render time (add TH in src/i18n.ts).

export type ChangeKind = 'new' | 'improved' | 'fixed' | 'removed'

export interface ChangeItem {
  kind: ChangeKind
  text: string
}

export interface Release {
  version: string
  changes: ChangeItem[]
}

// Short, translatable label shown as a tag in front of each change line.
export const CHANGE_LABEL: Record<ChangeKind, string> = {
  new: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
  removed: 'Removed',
}

export const CHANGELOG: Release[] = [
  {
    version: '0.2.0',
    changes: [
      { kind: 'new', text: 'Version history — see what changed in each update, right here in Settings.' },
      { kind: 'improved', text: 'Clearer wording in the first-run tour, plus a tip that you can scan a receipt with AI by holding the ＋ button.' },
      { kind: 'improved', text: '“Add to home screen” guide now warns if you opened the app inside another app’s browser (like Instagram or Facebook) and shows how to reopen it in Safari or Chrome.' },
    ],
  },
  {
    version: '0.1.0',
    changes: [
      { kind: 'new', text: 'First public beta.' },
      { kind: 'new', text: 'Track income, expenses, and transfers — all stored on your device.' },
      { kind: 'new', text: 'Insights & planners: Income/Expense, Money Flow, Budget, Financial Goals, Income Tax, and Retirement.' },
      { kind: 'new', text: 'Import from other money apps (CSV or Excel), plus full export, backup, and restore.' },
      { kind: 'new', text: 'AI receipt scanning using your own API key (optional).' },
      { kind: 'new', text: 'Daily reminders, English/Thai, light/dark theme, and a hide-amounts privacy toggle.' },
      { kind: 'new', text: 'Installable as an app, works offline, and your data never leaves your device.' },
    ],
  },
]

// The current running version (the newest changelog entry).
export const APP_VERSION = CHANGELOG[0].version
