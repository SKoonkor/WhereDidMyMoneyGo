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
//
// HOUSE STYLE: one clause per line, the way 0.1.0 was written. The whole log is
// rendered uncollapsed in a single modal, so a paragraph per change makes it
// unreadable — say what changed and stop. Releases old enough that nobody is
// upgrading from them get folded into the "Earlier releases" block at the bottom
// rather than kept line by line.

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
    version: '0.10.0',
    date: '20-08-2026',
    changes: [
      { kind: 'improved', text: 'Money Flow chart: drag to pan, pinch or ctrl-scroll to zoom, double-tap to reset.' },
      { kind: 'improved', text: 'The chart’s scale now fits whatever is on screen, so a quiet month is no longer a flat line.' },
      { kind: 'new', text: 'Hold anywhere on the Money Flow chart to read that day’s balance and what you spent.' },
      { kind: 'improved', text: 'That readout groups repeats of the same category, and colours income green, spending red.' },
      { kind: 'improved', text: 'A taller Money Flow chart, with the account picker moved below the balances.' },
      { kind: 'removed', text: 'Paper trading is unavailable for now while it is reworked. Nothing you track is affected.' },
    ],
  },
  {
    version: '0.9.0',
    date: '11-08-2026',
    changes: [
      { kind: 'new', text: 'Paper trading: a market simulator under Apps — candles, orders, margin and options, on invented money sealed off from your real records. Withdrawn again in 0.10.0.' },
      { kind: 'improved', text: 'Hide amounts now blanks charts as well as the lists.' },
    ],
  },
  {
    version: '0.8.0',
    date: '08-08-2026',
    changes: [
      { kind: 'new', text: 'An in-app keypad for every number box, so the minus sign is never hidden behind a symbols page.' },
      { kind: 'new', text: 'Money boxes get + − × ÷ and =, with multiplication done first: 500 − 3 × 45 is 365.' },
      { kind: 'new', text: 'Whole-number boxes get a plain digit pad, with no arithmetic to mis-tap.' },
      { kind: 'improved', text: 'Hold backspace to keep deleting.' },
      { kind: 'improved', text: 'Reconcile adds up too, so you can count cash straight into it.' },
      { kind: 'fixed', text: 'Tapping the date or account picker with the pad up no longer closes Add transaction.' },
    ],
  },
  {
    version: '0.7.0',
    date: '07-08-2026',
    changes: [
      { kind: 'new', text: 'The Amount box adds up: type 500 - 75 + 25 and the total is what gets saved.' },
      { kind: 'new', text: 'A running total appears as you type, and a sum asks you to confirm before saving.' },
      { kind: 'new', text: 'Whatever you subtracted is kept as a floating “still to record” note — tap it to carry that amount into another transaction.' },
      { kind: 'improved', text: 'The note clears when you save your next transaction, and never survives a restart.' },
      { kind: 'fixed', text: 'An amount with a space in it used to save wrong — “500 - 75” quietly became 500.' },
    ],
  },
  {
    version: '0.6.0',
    date: '03-08-2026',
    changes: [
      { kind: 'new', text: 'Debts: track cards, loans and anything else with a balance and a rate.' },
      { kind: 'new', text: 'A debt can follow an account you already use, or just hold a figure you update yourself.' },
      { kind: 'new', text: 'See what share of your income goes out as debt payments, against the 36% / 50% / 70% lines lenders use.' },
      { kind: 'new', text: 'Payoff plan: avalanche or snowball, with your debt-free date, the total interest, and what the other order would cost.' },
      { kind: 'new', text: 'What paying only the minimum would take, and what it would cost.' },
      { kind: 'new', text: 'What-if: try a loan you are considering and see what it does to all of the above.' },
      { kind: 'new', text: 'Home widgets for debts, and debts are included in backups.' },
      { kind: 'improved', text: 'Net worth now subtracts hand-entered debts, so the figure may drop the first time you open it.' },
    ],
  },
  // Folded: nobody is upgrading from these, and line-by-line they were half the
  // modal. One block, one entry per thing that shipped.
  {
    version: '0.1.0 – 0.5.0',
    date: '22-07-2026 – 28-07-2026',
    changes: [
      { kind: 'new', text: 'First public beta: track income, expenses and transfers on-device, offline and installable.' },
      { kind: 'new', text: 'Charts and planners — Money Flow, Budget, Financial Goals, Income Tax, Retirement.' },
      { kind: 'new', text: 'Import from CSV and Excel, plus export, backup and restore.' },
      { kind: 'new', text: 'Optional AI receipt scanning with your own key; daily reminders; EN/TH; light/dark; hide amounts.' },
      { kind: 'new', text: 'Goal savings: split your savings pool between goals, with transfers earmarked to the goal they belong to.' },
      { kind: 'new', text: 'Spending limits: a monthly cap on any category, with a nudge when one is nearly spent.' },
      { kind: 'new', text: 'Home layout editor: drag boxes into order, remove them, and add rows of small preview tiles.' },
      { kind: 'new', text: 'Money Flow can show a single account, with its own forecast.' },
      { kind: 'fixed', text: 'Pop-ups hold your place instead of scrolling the page behind them.' },
      { kind: 'fixed', text: 'Renaming a category no longer detaches its budget bucket or spending limit.' },
    ],
  },
]

// The current running version (the newest changelog entry).
export const APP_VERSION = CHANGELOG[0].version
