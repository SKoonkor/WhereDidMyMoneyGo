// First-run onboarding plumbing: "seen" flags (localStorage — synchronous, so no
// flash before the config store loads), platform detection for the install guide,
// a capture of the browser's native install prompt, and a tiny emitter so Settings
// can re-open either overlay on demand.

const TOUR_DONE_KEY = 'onboard-tour-done'
const INSTALL_SEEN_KEY = 'onboard-install-seen'

export function tourDone(): boolean { return localStorage.getItem(TOUR_DONE_KEY) === '1' }
export function markTourDone(): void { localStorage.setItem(TOUR_DONE_KEY, '1') }
export function installSeen(): boolean { return localStorage.getItem(INSTALL_SEEN_KEY) === '1' }
export function markInstallSeen(): void { localStorage.setItem(INSTALL_SEEN_KEY, '1') }

// Already launched from the home screen? Then the install guide is moot.
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari exposes this instead of the display-mode media query.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export type Platform = 'ios' | 'android' | 'desktop'

// Pick the install instructions to show. iPadOS 13+ reports a desktop UA but has
// a touch screen, so treat a touch-capable "MacIntel" as iOS (Safari share sheet).
export function detectPlatform(): Platform {
  const ua = navigator.userAgent || ''
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|iPod/i.test(ua) || iPadOS) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

// --- Native install prompt (Chromium Android/desktop) ----------------------
// Chrome fires `beforeinstallprompt` once the PWA is installable; we stash it so
// the install guide can offer a real one-tap "Install" button. iOS never fires
// this — there we fall back to the manual Share-sheet steps.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
let deferredPrompt: InstallPromptEvent | null = null
const promptListeners = new Set<() => void>()

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e as InstallPromptEvent
  promptListeners.forEach((f) => f())
})
window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  markInstallSeen()
  promptListeners.forEach((f) => f())
})

export function canPromptInstall(): boolean { return deferredPrompt !== null }
export function onInstallAvailability(cb: () => void): () => void {
  promptListeners.add(cb)
  return () => { promptListeners.delete(cb) }
}
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  await deferredPrompt.prompt()
  const { outcome } = await deferredPrompt.userChoice
  deferredPrompt = null
  promptListeners.forEach((f) => f())
  return outcome === 'accepted'
}

// --- Re-open emitter (Settings → "Take the tour" / "How to install") --------
export type Overlay = 'tour' | 'install'
const openListeners = new Set<(o: Overlay) => void>()
export function openOnboarding(o: Overlay): void { openListeners.forEach((f) => f(o)) }
export function onOpenOnboarding(cb: (o: Overlay) => void): () => void {
  openListeners.add(cb)
  return () => { openListeners.delete(cb) }
}
