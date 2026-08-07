// The amount left over from the last saved transaction — everything that was
// subtracted in the Amount box (see amountExpr.ts) — held just long enough to be
// recorded as its own transaction.
//
// It lives in module state rather than localStorage on purpose. This is a nudge
// about what you were doing thirty seconds ago, not a setting: surviving a reload
// would mean greeting someone with a stale reminder from yesterday's session.
// The 30-minute expiry is a backstop for a phone left on the counter, not the
// mechanism — normally it clears when the next transaction is saved.
//
// Written by whichever TxnForm is mounted, read by App (which renders the note),
// so it uses the module-level listener set + useSyncExternalStore pattern that
// prefs.ts already established for exactly this "non-React write, React reader"
// shape.

import { useSyncExternalStore } from 'react'

export interface Carry {
  amount: number
  at: number // when it was set, for the expiry
  hidden: boolean // dismissed with (×) — kept, just not shown
}

export const CARRY_MS = 30 * 60 * 1000

let carry: Carry | null = null
let expiryTimer: number | undefined

const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function emit() {
  listeners.forEach((cb) => cb())
}

// Called on every successful save: a leftover raises the note, and no leftover
// clears it — the point being that finishing a transaction is what retires the
// reminder, not merely opening a form and thinking better of it.
export function setCarry(amount: number | null, now = Date.now()): void {
  carry = amount != null && amount > 0 ? { amount, at: now, hidden: false } : null
  if (expiryTimer !== undefined) clearTimeout(expiryTimer)
  expiryTimer = undefined
  if (carry) {
    // Re-render at the deadline so the note leaves on its own; nothing polls.
    expiryTimer = setTimeout(emit, CARRY_MS) as unknown as number
  }
  emit()
}

// (×) hides the note without forgetting the amount, so that focusing the Amount
// field can bring it straight back — dismissing means "not now", not "never".
export function dismissCarry(): void {
  if (!carry || carry.hidden) return
  carry = { ...carry, hidden: true }
  emit()
}

export function revealCarry(): void {
  if (!carry || !carry.hidden) return
  carry = { ...carry, hidden: false }
  emit()
}

// The current carry, or null once it has expired. Pure enough to test: pass a clock.
export function readCarry(now = Date.now()): Carry | null {
  if (!carry) return null
  return now - carry.at < CARRY_MS ? carry : null
}

export function useCarry(): Carry | null {
  return useSyncExternalStore(subscribe, () => readCarry())
}

// ── Who handles a tap on the note ───────────────────────────────────────────
// An open TxnForm claims it (fill my Amount field); with no form open, App falls
// back to opening the Add sheet prefilled. A ref rather than a prop because the
// note is rendered by App while the form that should receive the tap is mounted
// somewhere else entirely — under a route, or in another modal.

let filler: ((amount: number) => void) | null = null

export function registerCarryFill(fn: (amount: number) => void): () => void {
  filler = fn
  return () => {
    // Only stand down if we're still the one holding it: a form unmounting after
    // its replacement mounted must not clear the newcomer's handler.
    if (filler === fn) filler = null
  }
}

export function carryFiller(): ((amount: number) => void) | null {
  return filler
}

// Test seam: drop all state between cases.
export function resetCarry(): void {
  if (expiryTimer !== undefined) clearTimeout(expiryTimer)
  expiryTimer = undefined
  carry = null
  filler = null
  emit()
}
