// The transient bottom toast, as a module store.
//
// It used to be useState inside App. That was fine while every caller was App
// itself, and stopped being fine when the order ticket — several routes and a
// lazy chunk away — needed to say "Filled." after closing its own sheet. The
// alternative was prop-drilling a setter through the router into a feature.
//
// Same shape as prefs.ts and carryNote.ts: a module value, a listener set, and a
// useSyncExternalStore reader. There is exactly one renderer, so a plain store is
// right here — carryNote's registered-handler indirection exists only because its
// handler has to live in whichever form is mounted.
import { useSyncExternalStore } from 'react'

export interface ToastState {
  message: string
  action?: { label: string; onClick: () => void }
}

let current: ToastState | null = null

const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function emit() {
  listeners.forEach((cb) => cb())
}

/**
 * Raise a toast, replacing any toast already showing.
 *
 * Replacing rather than queueing is deliberate: these are confirmations of
 * something the user just did, and the newest one is the only one still true.
 *
 * Note the z-index: `.toast` is 35 and `.modal-backdrop` is 40, so a toast
 * raised while a sheet is still open renders BEHIND it and is invisible. Close
 * the sheet in the same commit. Raising `.toast` is not the fix — `.carry-note`
 * (45) and the keypad (46) are both bottom-pinned above it for their own
 * reasons, and a toast over the keypad would cover its keys.
 */
export function showToast(message: string, action?: ToastState['action']): void {
  current = { message, action }
  emit()
}

export function dismissToast(): void {
  if (current === null) return
  current = null
  emit()
}

export function useToast(): ToastState | null {
  return useSyncExternalStore(subscribe, () => current)
}

/** The plain reader behind useToast, for tests and non-React callers. */
export function currentToast(): ToastState | null {
  return current
}

/** Subscribe outside React. Same listener set the hook uses, so a test that
 *  drives this is testing the thing that actually re-renders the component. */
export function subscribeToast(cb: () => void): () => void {
  return subscribe(cb)
}

/** Test seam, mirroring resetCarry() in carryNote.ts. */
export function resetToast(): void {
  current = null
  emit()
}
