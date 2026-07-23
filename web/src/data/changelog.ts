// App version history (SemVer — https://semver.org).
//
// Single source of truth for the app's version and its user-facing release notes
// (shown via the "Version history" link at the bottom of Settings).
//
// Keep entries NEWEST-FIRST: the first entry is the current running version and is
// marked "(this version)" in the UI. On each release, add a new entry on top.
//   patch (0.0.x) = bug fixes · minor (0.x.0) = new backwards-compatible features ·
//   major (x.0.0) = breaking changes.
//
// Notes are English-only by design (kept short, not translated) so the log stays
// easy to maintain. Dates are display strings in DD-MM-YYYY.

export type ChangeKind = 'new' | 'improved' | 'fixed' | 'removed'

export interface ChangeItem {
  kind: ChangeKind
  text: string
}

export interface Release {
  version: string
  date: string
  changes: ChangeItem[]
}

// Short tag shown in front of each change line.
export const CHANGE_LABEL: Record<ChangeKind, string> = {
  new: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
  removed: 'Removed',
}

export const CHANGELOG: Release[] = [
  {
    version: '0.3.0',
    date: '23-07-2026',
    changes: [
      { kind: 'fixed', text: 'Newest transaction now appears at the top of its day.' },
      { kind: 'improved', text: 'Add/Edit transaction highlights any missing required field in red.' },
      { kind: 'new', text: 'Confirm before saving an unusual date — in the future, or more than 10 days ago.' },
      { kind: 'improved', text: 'Day totals now match the size of the transaction amounts.' },
      { kind: 'new', text: 'Money Flow forecast marks the slider’s projected point with a dot on the chart.' },
      { kind: 'improved', text: 'Money Flow notes that the forecast is illustrative, not a guarantee.' },
    ],
  },
  {
    version: '0.2.0',
    date: '23-07-2026',
    changes: [
      { kind: 'new', text: 'Version history to track updates.' },
      { kind: 'improved', text: 'Clearer tour wording and an AI receipt-scan tip.' },
      { kind: 'improved', text: 'Install guide warns about in-app browsers (Instagram/Facebook).' },
    ],
  },
  {
    version: '0.1.0',
    date: '22-07-2026',
    changes: [
      { kind: 'new', text: 'First public beta.' },
      { kind: 'new', text: 'Track income, expenses, and transfers on-device.' },
      { kind: 'new', text: 'Charts & planners: Money Flow, Budget, Goals, Income Tax, Retirement.' },
      { kind: 'new', text: 'Import (CSV/Excel), plus export, backup & restore.' },
      { kind: 'new', text: 'Optional AI receipt scanning with your own key.' },
      { kind: 'new', text: 'Daily reminders, EN/TH, light/dark, hide amounts.' },
      { kind: 'new', text: 'Installable, offline, data stays on your device.' },
    ],
  },
]

// The current running version (the newest changelog entry).
export const APP_VERSION = CHANGELOG[0].version
