// Paper trading is a MODE, not a route.
//
// Entering /trading turns it on and it stays on while the user browses
// elsewhere, so the bottom bar keeps meaning trading things and leaving for
// another app is a deliberate act rather than a stray tap. It ends only through
// the header's ✕ or the confirmation raised when an Apps tile is chosen.
//
// This file lives beside prefs.ts rather than under features/trading/ for two
// reasons. BottomNav has to read it, and a components/ file importing a feature
// inverts the layering the rest of the app keeps. More importantly, anything
// BottomNav imports lands in the eager bundle — so the imports here are `react`
// and nothing else, which is what keeps the lazily-loaded trading chunk (a chart
// engine, a market model, a broker and an options pricer) out of the first load.
//
// It follows prefs.ts's store shape but deliberately NOT its <html data-*> half:
// every existing data-attribute is there because a CSS rule reads it, and
// nothing here is styled by mode — BottomNav simply renders different JSX.
import { useCallback, useSyncExternalStore } from 'react'

/** Which of the mode's two sheets the bar has asked for. One nullable field
 *  rather than two booleans, so they are mutually exclusive by construction —
 *  tapping Settings while the ticket is open swaps instead of stacking. */
export type TradingSheet = 'ticket' | 'settings'

/**
 * Paper trading is PARKED, not deleted. The feature is intact under
 * features/trading/ and lib/trading/, and flipping this to true is the whole of
 * re-enabling it — along with the Simulators section in AppsPage and the routes
 * in App.tsx, which read this same const.
 *
 * Note lib/chart/ is no longer trading-only: features/flow/useFlowInteraction.ts
 * imports its gestures and springs, so that tree stays live either way.
 *
 * Gated here rather than in enterTrading() on purpose. The store itself keeps
 * working, so tradingMode.test.ts and BottomNav.test.tsx still exercise the real
 * behaviour; what this switches off is the one path that can turn the mode on
 * WITHOUT a route — a cold start on a #/trading deep link, or a sessionStorage
 * key left by a session from before the feature was parked. Either would have
 * left the trading bottom bar pointing at routes that no longer resolve.
 */
export const TRADING_ENABLED = false

const KEY = 'trading-mode'

const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function emit() {
  listeners.forEach((cb) => cb())
}

// sessionStorage, not localStorage. Someone who opened the simulator once should
// not come back a week later to a chart icon in their nav with no memory of why;
// but a reload while holding an open position must not eject them from a mode
// they never quit. Per-tab is exactly the lifetime of a trading session.
//
// Both accesses are guarded: BottomNav renders on EVERY route, so a storage
// throw in a locked-down webview would blank the whole app rather than one
// screen. The module variable below is the source of truth; storage is a mirror.
function readStored(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}
function writeStored(v: boolean): void {
  try {
    if (v) sessionStorage.setItem(KEY, 'on')
    else sessionStorage.removeItem(KEY)
  } catch {
    // Storage is a convenience here, never a requirement.
  }
}

// The hash is read ONCE, at module init — not during render, which is the
// route-branching the design deliberately avoids. It only covers the cold start
// that lands directly on a trading URL with an empty session: without it,
// entering happens in an effect after paint and the user sees a frame of the
// wrong bar.
let on = TRADING_ENABLED && (readStored() || (typeof location !== 'undefined' && location.hash.startsWith('#/trading')))
let sheet: TradingSheet | null = null
let pendingExit: string | null = null

/** For callers outside React — the Apps navigation guard. */
export function isTrading(): boolean {
  return on
}

/** The plain reader behind useTradingSheet, for tests and non-React callers. */
export function currentSheet(): TradingSheet | null {
  return sheet
}

/** The plain reader behind usePendingExit. */
export function currentPendingExit(): string | null {
  return pendingExit
}

export function enterTrading(): void {
  if (on) return
  on = true
  writeStored(true)
  emit()
}

export function exitTrading(): void {
  if (!on && sheet === null && pendingExit === null) return
  on = false
  sheet = null
  pendingExit = null
  writeStored(false)
  emit()
}

export function openSheet(s: TradingSheet): void {
  if (sheet === s) return
  sheet = s
  emit()
}

export function closeSheet(): void {
  if (sheet === null) return
  sheet = null
  emit()
}

/**
 * May navigation to `to` proceed?
 *
 * `true` means go ahead. `false` means the caller must NOT navigate — a
 * confirmation has been raised in its place and will navigate itself if the user
 * accepts.
 *
 * The mode check is the FIRST line on purpose: this predicate sits on every tile
 * of the Apps page, so getting it wrong when the mode is off breaks every app in
 * the launcher. Named for what it does rather than for trading, so the Apps page
 * needs no vocabulary from this feature.
 */
export function requestLeave(to: string): boolean {
  if (!on) return true
  if (to.startsWith('/trading')) return true
  pendingExit = to
  emit()
  return false
}

/** Accept the pending exit. Returns where the caller should navigate to. */
export function confirmExit(): string {
  const to = pendingExit ?? '/'
  exitTrading()
  return to
}

export function cancelExit(): void {
  if (pendingExit === null) return
  pendingExit = null
  emit()
}

export function useTradingMode(): boolean {
  return useSyncExternalStore(subscribe, () => on)
}

export function useTradingSheet(): TradingSheet | null {
  return useSyncExternalStore(subscribe, () => sheet)
}

export function usePendingExit(): string | null {
  return useSyncExternalStore(subscribe, () => pendingExit)
}

/** Stable helpers for components that only need to act, not to read. */
export function useTradingActions() {
  return {
    close: useCallback(() => closeSheet(), []),
    cancel: useCallback(() => cancelExit(), []),
  }
}

/** Test seam, mirroring resetCarry() in carryNote.ts. */
export function resetTradingMode(): void {
  on = false
  sheet = null
  pendingExit = null
  writeStored(false)
  emit()
}
