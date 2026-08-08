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
    version: '0.8.0',
    date: '08-08-2026',
    changes: [
      { kind: 'new', text: 'Tap any box that takes a number and a keypad comes up in the app instead of your phone keyboard. No more hunting for the minus sign behind a symbols page.' },
      { kind: 'new', text: 'Money boxes get the full calculator: + − × ÷ and =. So "1200 ÷ 4" for your share of a bill, or "500 + 200 + 20" for the notes in your wallet.' },
      { kind: 'new', text: 'It does the multiplication first, the way you would on paper: 500 − 3 × 45 is 365.' },
      { kind: 'new', text: 'Boxes that only take a whole number — months, percentages, the day of the month — get a plain digit pad, with no arithmetic to mis-tap.' },
      { kind: 'improved', text: 'Hold the backspace key to clear the box in one go.' },
      { kind: 'improved', text: 'Prefer your own keyboard? Tap the keyboard icon on the pad and it hands the box back, just for that one field.' },
      { kind: 'improved', text: 'Reconcile now adds up too, so you can count cash into it rather than working the total out first.' },
      { kind: 'improved', text: 'The "still to record" note from 0.7.0 works exactly as before for a + and − sum. Once you multiply or divide there is no honest answer to what was set aside, so it stays out of the way.' },
    ],
  },
  {
    version: '0.7.0',
    date: '07-08-2026',
    changes: [
      { kind: 'new', text: 'The Amount box now adds up. Type several amounts in one go — 500 - 75 + 25 - 12 - 5 + 33 — and the total is what gets saved. Works the same for expenses, income and transfers.' },
      { kind: 'new', text: 'A running total appears under the box as you type, so you can check the sum before you commit to it.' },
      { kind: 'new', text: 'Save a sum and you are asked to confirm it first, with the arithmetic laid out. A single plain amount still saves in one tap, as before.' },
      { kind: 'new', text: 'Whatever you subtracted is remembered for you. It floats above the screen as "still to record" — the part of the receipt that belongs somewhere else and is easy to forget once the paper is in the bin.' },
      { kind: 'new', text: 'Tap that note to carry the amount into a transaction: it fills the Amount box if a form is open, or opens a new one with the figure already in. Close it with the ×, and it comes back the moment you tap an Amount box again.' },
      { kind: 'improved', text: 'The note clears itself once you save your next transaction, and never survives a restart.' },
      { kind: 'fixed', text: 'An amount with a space in it used to be read wrong — "500 - 75" quietly saved 500. It now either adds up properly or asks you to fix it.' },
    ],
  },
  {
    version: '0.6.0',
    date: '03-08-2026',
    changes: [
      { kind: 'new', text: 'Debts: track what you owe in one place — credit cards, loans, anything with a balance and a rate.' },
      { kind: 'new', text: 'A debt can follow an account you already use, so its balance and every payment come straight from your transactions with nothing to keep up to date. A mortgage you would rather not track transaction by transaction can just hold a figure instead.' },
      { kind: 'new', text: 'See what share of your income goes out as debt payments, against the lines lenders actually use — 36% comfortable, 50% stretched, 70% the ceiling in Thailand.' },
      { kind: 'new', text: 'Each debt shows how much of it you have already paid off, how close a card is to its limit, and where it sits in the payoff order.' },
      { kind: 'new', text: 'Payoff plan: choose highest-rate-first or smallest-balance-first, add whatever you can spare each month, and see the date you become debt-free and what the interest costs. It also shows what the other order would cost, so the choice is yours to make.' },
      { kind: 'new', text: 'A blunt one worth seeing: what paying only the minimum would take, and what it would cost.' },
      { kind: 'new', text: 'What-if: enter a loan you are thinking about and watch what it does to your debt-free date, your interest, and the share of your income already spoken for.' },
      { kind: 'new', text: 'Home widgets for debts — the whole picture, the debt to pay next, or your debt ratio as a ring.' },
      { kind: 'improved', text: 'Net worth now subtracts debts you entered by hand. A card you track as an account was always counted; a loan that lives outside your transactions was not, and now it is — so the figure may drop the first time you open the app.' },
      { kind: 'improved', text: 'Backups include your debts.' },
    ],
  },
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
      { kind: 'fixed', text: 'Pop-ups no longer drift up and down when you drag the screen; they only move to clear the on-screen keyboard.' },
      { kind: 'fixed', text: 'A pop-up now stays put while the keyboard is open too — dragging it only scrolls the pop-up itself, and does nothing once you reach the end.' },
      { kind: 'improved', text: 'Each goal in Financial Goals fills in as you allocate savings to it, so you can see how far along every one is from the list.' },
      { kind: 'improved', text: 'The small Goal savings tile now shows the highest-priority goal you haven’t finished funding, instead of the one closest to done.' },
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
