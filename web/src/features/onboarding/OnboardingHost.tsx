import { useEffect, useState } from 'react'
import { InstallGuide } from './InstallGuide'
import { TourOverlay } from './TourOverlay'
import {
  installSeen, isStandalone, markInstallSeen, markTourDone, onOpenOnboarding, tourDone,
  type Overlay,
} from './onboarding'

// Drives the first-run experience and the re-open buttons in Settings.
//
// First launch (in a browser, not yet installed): show the install guide first,
// then chain into the tour when it closes. If already installed, or the guide was
// seen before, go straight to the tour. Opening either from Settings shows just
// that one — no chaining.
interface Active { kind: Overlay; auto: boolean }

export function OnboardingHost() {
  const [active, setActive] = useState<Active | null>(null)

  useEffect(() => {
    const unsub = onOpenOnboarding((o) => setActive({ kind: o, auto: false }))
    // Decide the first-run sequence once, after mount.
    if (!installSeen() && !isStandalone()) setActive({ kind: 'install', auto: true })
    else if (!tourDone()) setActive({ kind: 'tour', auto: true })
    return unsub
  }, [])

  if (!active) return null

  if (active.kind === 'install') {
    return (
      <InstallGuide
        onClose={() => {
          markInstallSeen()
          // On first run, flow on to the tour; when opened from Settings, just close.
          setActive(active.auto && !tourDone() ? { kind: 'tour', auto: true } : null)
        }}
      />
    )
  }

  return (
    <TourOverlay
      onClose={() => {
        markTourDone()
        setActive(null)
      }}
    />
  )
}
