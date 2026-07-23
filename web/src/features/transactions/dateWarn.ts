import { addDays } from './month'

// Safeguard against accidental unusual transaction dates. On save we flag a date
// that is either in the FUTURE or more than `oldDays` days in the past, and ask the
// user to confirm. Past-date warnings can be snoozed for 30 minutes (for someone
// deliberately back-entering old transactions); future dates always warn.

export type DateStatus = 'future' | 'old' | 'ok'

// All args are "YYYY-MM-DD"; lexicographic compare == chronological for ISO dates.
// "old" means strictly older than `oldDays` days, so exactly `oldDays` ago is ok.
export function dateStatus(period: string, today: string, oldDays = 10): DateStatus {
  if (period > today) return 'future'
  if (period < addDays(today, -oldDays)) return 'old'
  return 'ok'
}

const SNOOZE_KEY = 'txn-old-date-snooze-until'
const SNOOZE_MS = 30 * 60 * 1000 // 30 minutes

// Silence past-date ("old") warnings for the next 30 minutes.
export function snoozeOldDateWarning(now = Date.now()): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(now + SNOOZE_MS))
  } catch {
    /* storage unavailable — just don't snooze */
  }
}

export function isOldDateWarningSnoozed(now = Date.now()): boolean {
  try {
    return now < Number(localStorage.getItem(SNOOZE_KEY) ?? 0)
  } catch {
    return false
  }
}
