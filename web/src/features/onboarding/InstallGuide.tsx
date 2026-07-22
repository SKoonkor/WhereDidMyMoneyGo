import { Fragment, useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'
import { useLang } from '../../prefs'
import { APP_NAME } from '../../data/defaults'
import { t } from '../../i18n'
import {
  canPromptInstall, detectPlatform, onInstallAvailability, promptInstall, type Platform,
} from './onboarding'

// Render a translated string that contains an `{app}` slot, emphasising the app
// name (italic + bold) wherever it appears in the prose.
function renderWithApp(template: string) {
  return template.split('{app}').map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <em className="app-name-em">{APP_NAME}</em>}
      {part}
    </Fragment>
  ))
}

// EN/TH switch shown inside the guide — a first-time visitor may land here before
// finding Settings, and their phone's default language may differ from the app's.
function LangToggle() {
  const [lang, toggle] = useLang()
  const opts: Array<{ value: 'en' | 'th'; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'th', label: 'ไทย' },
  ]
  return (
    <div className="seg ig-lang" style={{ marginBottom: 0 }}>
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === lang ? 'seg-btn active' : 'seg-btn'}
          onClick={() => { if (o.value !== lang) toggle() }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// The iOS Share glyph (square with an up-arrow) and Android overflow menu (⋮),
// drawn inline so the steps show the exact control the user is looking for.
function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="ig-glyph" aria-hidden="true">
      <path d="M12 15V4M8.5 7.5L12 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 11H5a1 1 0 00-1 1v7a1 1 0 001 1h14a1 1 0 001-1v-7a1 1 0 00-1-1h-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function DotsGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="ig-glyph" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  )
}

interface StepDef { glyph?: 'share' | 'dots'; text: string }

function stepsFor(platform: Platform): StepDef[] {
  if (platform === 'ios') {
    return [
      { glyph: 'share', text: t('In Safari, tap the Share button at the bottom of the screen.') },
      { text: t('Scroll down and tap “Add to Home Screen”.') },
      { text: t('Tap “Add” — the icon appears on your home screen.') },
    ]
  }
  if (platform === 'android') {
    return [
      { glyph: 'dots', text: t('In Chrome, tap the ⋮ menu in the top-right.') },
      { text: t('Tap “Install app” (or “Add to Home screen”).') },
      { text: t('Confirm — the app lands in your app drawer.') },
    ]
  }
  return [
    { text: t('Click the install icon in the address bar (or the ⋮ menu → “Install…”).') },
    { text: t('Confirm to add it as a desktop app.') },
  ]
}

const HEADING: Record<Platform, string> = {
  ios: t('On iPhone or iPad (Safari)'),
  android: t('On Android (Chrome)'),
  desktop: t('On a computer (Chrome or Edge)'),
}

export function InstallGuide({ onClose }: { onClose: () => void }) {
  const platform = detectPlatform()
  const [canPrompt, setCanPrompt] = useState(canPromptInstall())
  useEffect(() => onInstallAvailability(() => setCanPrompt(canPromptInstall())), [])

  async function install() {
    const ok = await promptInstall()
    if (ok) onClose()
  }

  return (
    <Modal title={t('Add to your home screen')} onClose={onClose}>
      <div className="install-guide">
        <LangToggle />
        <p className="ig-intro">
          {renderWithApp(t('Add {app} to your home screen to open it like a normal app — full-screen, offline, and one tap away. It stays completely on your device.'))}
        </p>

        {/* Chromium can install with one tap; offer it up front when available. */}
        {canPrompt && (
          <button type="button" className="btn btn-accent ig-install-now" onClick={install}>
            {t('Install now')}
          </button>
        )}

        <div className="ig-steps-head">{HEADING[platform]}</div>
        <ol className="ig-steps">
          {stepsFor(platform).map((s, n) => (
            <li key={n} className="ig-step">
              <span className="ig-num">{n + 1}</span>
              <span className="ig-step-text">
                {s.glyph === 'share' && <ShareGlyph />}
                {s.glyph === 'dots' && <DotsGlyph />}
                {s.text}
              </span>
            </li>
          ))}
        </ol>

        <button type="button" className="btn ig-got-it" onClick={onClose}>{t('Got it')}</button>
      </div>
    </Modal>
  )
}
