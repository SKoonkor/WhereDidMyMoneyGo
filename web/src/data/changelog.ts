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
    version: '0.5.0',
    date: '28-07-2026',
    changes: [
      { kind: 'new', text: 'Goal savings: split your savings pool between individual goals, so you can see how much of it is the house and how much is the trip.' },
      { kind: 'new', text: 'Money paid into a savings account waits as "unallocated" until you assign it — move it to a goal, back out again, or straight from one goal to another.' },
      { kind: 'new', text: 'A transfer in or out of a savings account can name the goal it belongs to, and the earmark follows the transfer when you edit or delete it.' },
      { kind: 'new', text: 'Home warns you when your goals hold more than your savings accounts actually contain, until you move some back.' },
      { kind: 'new', text: 'Goal savings widgets for Home — a ring per goal, or a small tile for the goal closest to done.' },
      { kind: 'improved', text: 'Goal moves appear in your transaction list alongside everything else, without counting toward income or spending.' },
      { kind: 'improved', text: 'Deleting a goal returns whatever it was holding to your unallocated savings instead of losing track of it.' },
      { kind: 'improved', text: 'Backups now include your goal allocations.' },
      { kind: 'fixed', text: 'The page no longer scrolls behind a pop-up — opening the tour, a form or a picker holds your place until you close it.' },
      { kind: 'improved', text: 'Savings activity shows the latest 10, with a "See all" pop-up for the full history.' },
      { kind: 'improved', text: 'The Goals app is now called Financial Goals, and it links back and forth with Goal savings.' },
    ],
  },
  {
    version: '0.4.0',
    date: '28-07-2026',
    changes: [
      { kind: 'new', text: 'Editing a saved transaction now asks you to confirm before it overwrites the row — an edit sheet opened by accident can no longer change anything.' },
      { kind: 'improved', text: 'Tap Save with a required field missing and those fields shake, every time you tap — not just the first.' },
      { kind: 'improved', text: 'Every spending-limit row is marked with the same grey bar, on the page and on the Home widget.' },
      { kind: 'new', text: 'Home screen layout editor: tap "Edit layout" to drag boxes into the order you want, remove the ones you never look at, and add them back later.' },
      { kind: 'new', text: 'Widget rows — a box that holds up to three small previews side by side: 3-month money flow, budget bars, budget used, spending limits, savings pool, and this month\'s income vs output.' },
      { kind: 'new', text: 'Spending limits: set a monthly cap on any category or sub-category, see how close you are to each, and get nudged when one is nearly spent.' },
      { kind: 'new', text: 'Money Flow can now show a single account, with its own forecast — including money moved in by transfers.' },
      { kind: 'improved', text: 'Home gestures swapped: double-tap a box to fold it, hold it to open its page or remove it.' },
      { kind: 'improved', text: 'Budget bars turn amber at 75% and red past 95%, instead of 50% and 85%.' },
      { kind: 'improved', text: 'The Money Flow chart is shorter, with the empty space above it removed.' },
      { kind: 'improved', text: 'Small preview tiles line up properly and show amounts left rather than percentages.' },
      { kind: 'improved', text: 'Your Home arrangement is now included in backups.' },
      { kind: 'fixed', text: 'Renaming a category no longer detaches its budget bucket or its spending limit.' },
    ],
  },
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
