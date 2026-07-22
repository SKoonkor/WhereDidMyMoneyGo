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
// P1 provides only capability detection + permission; the scheduling engine
// (nextOccurrences / scheduleReminders / cancelReminders) arrives in P3.

export type NotifyCapability = 'triggers' | 'inapp-only' | 'blocked' | 'unsupported'

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
