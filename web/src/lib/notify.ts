// Daily-reminder notification support. This app has no backend, so delivery is
// best-effort and platform-dependent:
//   - 'triggers'   → the Notification Triggers API is available (Chromium/Android
//                    /desktop). Reminders can fire even when the app is closed.
//   - 'inapp-only' → Notifications are permitted but Triggers are absent
//                    (Firefox/Safari/iOS PWA). A reminder can only show while the
//                    app is open.
//   - 'blocked'    → the user denied notification permission.
//   - 'unsupported'→ the Notification API itself is missing.
//
// Scheduling (P3): on Triggers-capable browsers we pre-arm several days of
// notifications via the Notification Triggers API (they fire even when closed);
// re-armed on each app open. Elsewhere we fall back to a single in-app timer that
// only fires while the app is open.

import { t } from '../i18n'
import type { NotificationCfg } from '../data/defaults'

export type NotifyCapability = 'triggers' | 'inapp-only' | 'blocked' | 'unsupported'

// Notifications sharing a tag collapse to one, so each scheduled day needs its
// own tag. We pre-arm this many days ahead (re-armed every app open).
const REMINDER_TAG = 'daily-reminder'
const PREARM_DAYS = 7

// A future-timestamp trigger constructor (Notification Triggers API), not yet in
// the DOM typings.
type TimestampTriggerCtor = new (timestamp: number) => object
type TriggerNotificationOptions = NotificationOptions & { showTrigger?: object }

let inAppTimer: ReturnType<typeof setTimeout> | null = null

// Does this browser support scheduling a notification for a future timestamp
// without a running page (Notification Triggers API)?
export function supportsTriggers(): boolean {
  return typeof Notification !== 'undefined' && 'showTrigger' in Notification.prototype
}

// Current best-effort capability, given the API surface and permission state.
export function notifyCapability(): NotifyCapability {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return supportsTriggers() ? 'triggers' : 'inapp-only'
}

// Prompt for permission (no-op if the API is missing). Returns the resulting
// permission string, or 'denied' when unsupported.
export async function requestNotifyPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

// The next `n` daily reminder timestamps (ms) at local `time` ("HH:MM"), starting
// from the first occurrence strictly after `from`. Uses local wall-clock math so
// the time holds across DST and month/year boundaries. Pure — unit-tested.
export function nextOccurrences(time: string, n: number, from: Date = new Date()): number[] {
  const [h, m] = time.split(':').map((x) => parseInt(x, 10))
  const todayAt = new Date(from)
  todayAt.setHours(h, m, 0, 0)
  const startOffset = todayAt.getTime() <= from.getTime() ? 1 : 0 // today already passed?
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(from)
    d.setDate(from.getDate() + startOffset + i) // setDate handles month/year overflow
    d.setHours(h, m, 0, 0)
    out.push(d.getTime())
  }
  return out
}

function clearInApp(): void {
  if (inAppTimer !== null) {
    clearTimeout(inAppTimer)
    inAppTimer = null
  }
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

// Close every reminder notification — both already-shown and still-scheduled
// (Triggers). `includeTriggered` isn't in the typings yet.
async function clearScheduled(reg: ServiceWorkerRegistration): Promise<void> {
  const getNotifications = reg.getNotifications as (
    opts?: { tag?: string; includeTriggered?: boolean },
  ) => Promise<Notification[]>
  const notes = await getNotifications({ includeTriggered: true })
  for (const note of notes) if (note.tag?.startsWith(REMINDER_TAG)) note.close()
}

function reminderContent(): { title: string; body: string } {
  return { title: t("Log today's expenses"), body: t('A quick tap keeps your budget on track.') }
}

// Arm a single in-app timer for the next occurrence; on fire, show the reminder
// (only works while the app is open) and re-arm for the following day.
function armInApp(cfg: NotificationCfg): void {
  clearInApp()
  const [ts] = nextOccurrences(cfg.time, 1)
  const delay = Math.max(0, ts - Date.now())
  inAppTimer = setTimeout(() => {
    void (async () => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const { title, body } = reminderContent()
        const reg = await getRegistration()
        if (reg) await reg.showNotification(title, { tag: REMINDER_TAG, body })
        else new Notification(title, { tag: REMINDER_TAG, body })
      }
      armInApp(cfg) // re-arm the next day
    })()
  }, delay)
}

// (Re)schedule reminders to match `cfg`. Safe to call repeatedly (idempotent):
// it always clears prior reminders first. Called from Settings and on app start.
export async function scheduleReminders(cfg: NotificationCfg): Promise<void> {
  await cancelReminders()
  if (!cfg.enabled) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  if (supportsTriggers()) {
    const reg = await getRegistration()
    const TimestampTrigger = (globalThis as { TimestampTrigger?: TimestampTriggerCtor }).TimestampTrigger
    if (!reg || !TimestampTrigger) return
    const { title, body } = reminderContent()
    for (const ts of nextOccurrences(cfg.time, PREARM_DAYS)) {
      const opts: TriggerNotificationOptions = {
        tag: `${REMINDER_TAG}-${ts}`, // distinct tag per day so they don't collapse
        body,
        showTrigger: new TimestampTrigger(ts),
      }
      await reg.showNotification(title, opts)
    }
  } else {
    armInApp(cfg)
  }
}

// Cancel all reminders: clear the in-app timer and close scheduled/shown ones.
export async function cancelReminders(): Promise<void> {
  clearInApp()
  const reg = await getRegistration()
  if (reg) await clearScheduled(reg)
}
