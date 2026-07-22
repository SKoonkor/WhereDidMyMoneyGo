import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getAi, getNotifications, getSettings, saveAi, saveNotifications, saveSettings } from '../../db'
import { useLang, useTheme, useCensor } from '../../prefs'
import { AI_MODELS, AI_MODELS_URL, DEFAULT_SETTINGS, type AiCfg, type AiProvider, type Settings } from '../../data/defaults'
import { cancelReminders, notifyCapability, requestNotifyPermission, scheduleReminders } from '../../lib/notify'
import { makeProvider } from '../../lib/ai'
import { openOnboarding } from '../onboarding/onboarding'
import { t, tBilingual } from '../../i18n'

// Merge a patch onto the freshest stored settings, so independent settings
// cards can't clobber each other's fields with a stale full copy.
async function patchSettings(patch: Partial<Settings>) {
  await saveSettings({ ...(await getSettings()), ...patch })
}

// Same freshest-merge pattern for the AI config.
async function patchAi(patch: Partial<AiCfg>) {
  await saveAi({ ...(await getAi()), ...patch })
}

// Where each provider issues API keys — used by the "Get an API key" shortcut.
const PROVIDER_KEY_URL: Record<AiProvider, string> = {
  claude: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/app/apikey',
}

// A hint at each provider's key shape, shown as the masked field's placeholder.
const PROVIDER_KEY_HINT: Record<AiProvider, string> = {
  claude: 'sk-ant-…',
  openai: 'sk-…',
  gemini: 'AIza…',
}

// Preferences hub: language, theme, and privacy — all backed by localStorage
// (prefs.ts), so these mirror the header's quick toggles live.
function PreferencesSettings() {
  return (
    <>
      <h2 className="set-group-title">{t('Preferences')}</h2>
      <section className="set-card">
        <div className="set-field">
          <label>{tBilingual('Language')}</label>
          <LanguageChoice />
          <span className="set-hint">{t('Applies across the app right away.')}</span>
        </div>
        <div className="set-field">
          <label>{t('Theme')}</label>
          <ThemeChoice />
          <span className="set-hint">{t('Light or dark appearance.')}</span>
        </div>
        <div className="set-field">
          <label>{t('Privacy')}</label>
          <PrivacyChoice />
          <span className="set-hint">{t('Hide all amounts across the app.')}</span>
        </div>
        <DailyReminderField />
      </section>
    </>
  )
}

// Daily reminder: an Off/On toggle plus a time picker. Enabling first asks for
// notification permission — if it isn't granted, we keep it off. Delivery is
// best-effort (see lib/notify.ts); the hint states what this device can do.
function DailyReminderField() {
  const cfg = useLiveQuery(() => getNotifications(), [])
  const [denied, setDenied] = useState(false)
  if (!cfg) return null

  const capability = notifyCapability()
  const noteKey =
    capability === 'unsupported'
      ? 'This browser cannot show notifications.'
      : capability === 'blocked' || denied
        ? 'Notifications are blocked — allow them in your browser settings.'
        : capability === 'inapp-only'
          ? 'On this device, reminders only show while the app is open.'
          : 'Reminders show at this time each day, even when the app is closed.'

  async function setEnabled(on: boolean) {
    if (on) {
      const perm = await requestNotifyPermission()
      if (perm !== 'granted') { setDenied(true); return }
      setDenied(false)
    }
    const next = { ...cfg!, enabled: on }
    await saveNotifications(next)
    if (on) await scheduleReminders(next)
    else await cancelReminders()
  }

  async function setTime(time: string) {
    const next = { ...cfg!, time }
    await saveNotifications(next)
    if (next.enabled) await scheduleReminders(next) // re-arm at the new time
  }

  const opts: Array<{ value: boolean; label: string }> = [
    { value: false, label: t('Off') },
    { value: true, label: t('On') },
  ]

  return (
    <div className="set-field">
      <label>{t('Daily reminder')}</label>
      <div className="seg" style={{ maxWidth: 240, marginBottom: 0 }}>
        {opts.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            disabled={capability === 'unsupported'}
            className={o.value === cfg.enabled ? 'seg-btn active' : 'seg-btn'}
            onClick={() => { if (o.value !== cfg.enabled) void setEnabled(o.value) }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {cfg.enabled && (
        <input
          type="time"
          value={cfg.time}
          aria-label={t('Reminder time')}
          style={{ maxWidth: 140, marginTop: 8 }}
          onChange={(e) => { void setTime(e.target.value || cfg.time) }}
        />
      )}
      <span className="set-hint">{t(noteKey)}</span>
    </div>
  )
}

// EN / TH segmented choice. Language lives in localStorage (prefs.useLang), not
// in the settings record, and applies app-wide instantly via the root subscription.
function LanguageChoice() {
  const [lang, toggle] = useLang()
  const opts: Array<{ value: 'en' | 'th'; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'th', label: 'ไทย' },
  ]
  return (
    <div className="seg" style={{ maxWidth: 240, marginBottom: 0 }}>
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

// Light / Dark segmented choice, driven by prefs.useTheme (mirrors the header pill).
function ThemeChoice() {
  const [theme, toggle] = useTheme()
  const opts: Array<{ value: 'light' | 'dark'; label: string }> = [
    { value: 'light', label: t('Light') },
    { value: 'dark', label: t('Dark') },
  ]
  return (
    <div className="seg" style={{ maxWidth: 240, marginBottom: 0 }}>
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === theme ? 'seg-btn active' : 'seg-btn'}
          onClick={() => { if (o.value !== theme) toggle() }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Shown / Hidden segmented choice, driven by prefs.useCensor (true = amounts hidden).
function PrivacyChoice() {
  const [censor, toggle] = useCensor()
  const opts: Array<{ value: boolean; label: string }> = [
    { value: false, label: t('Shown') },
    { value: true, label: t('Hidden') },
  ]
  return (
    <div className="seg" style={{ maxWidth: 240, marginBottom: 0 }}>
      {opts.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={o.value === censor ? 'seg-btn active' : 'seg-btn'}
          onClick={() => { if (o.value !== censor) toggle() }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// General settings (app name, base currency, reset day). Autosaves each change.
// Seeded once from the stored settings so typing never fights the live query.
function GeneralSettings() {
  // No default here: the query is `undefined` until the real stored settings
  // load, so we seed the form from persisted values (not the fallback defaults).
  const stored = useLiveQuery(() => getSettings(), [])
  const [form, setForm] = useState<Settings | null>(null)
  useEffect(() => { if (!form && stored) setForm(stored) }, [stored, form])
  if (!form) return null

  function update(patch: Partial<Settings>) {
    setForm({ ...form!, ...patch })
    void patchSettings(patch)
  }

  return (
    <>
      <h2 className="set-group-title">{t('General')}</h2>
      <section className="set-card">
        <div className="set-field">
          <label>{t('App name')}</label>
          <input
            value={form.appName}
            onChange={(e) => update({ appName: e.target.value })}
            onBlur={(e) => { if (!e.target.value.trim()) update({ appName: DEFAULT_SETTINGS.appName }) }}
          />
          <span className="set-hint">{t('Shown in the header and on the home screen icon label.')}</span>
        </div>

        <div className="set-field">
          <label>{t('Base currency')}</label>
          <input
            value={form.baseCurrency}
            maxLength={5}
            style={{ maxWidth: 120, textTransform: 'uppercase' }}
            onChange={(e) => update({ baseCurrency: e.target.value.toUpperCase().replace(/\s/g, '') })}
            onBlur={(e) => { if (!e.target.value.trim()) update({ baseCurrency: DEFAULT_SETTINGS.baseCurrency }) }}
          />
          <span className="set-hint">{t('Stamped on new transactions and shown across the app.')}</span>
        </div>

        <p className="muted set-autosave">{t('Changes are saved automatically.')}</p>
      </section>
    </>
  )
}

// A small Off/On segmented control bound to a boolean.
function OnOff({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const opts: Array<{ value: boolean; label: string }> = [
    { value: false, label: t('Off') },
    { value: true, label: t('On') },
  ]
  return (
    <div className="seg" style={{ maxWidth: 240, marginBottom: 0 }}>
      {opts.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          className={o.value === value ? 'seg-btn active' : 'seg-btn'}
          onClick={() => { if (o.value !== value) onChange(o.value) }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// AI receipt scanning (bring-your-own-key). Draft-based like GeneralSettings:
// seeded once from the stored config, each change autosaves via patchAi. Only
// Claude works from the browser today; the key is masked and stored on-device.
function AiSettings() {
  const stored = useLiveQuery(() => getAi(), [])
  const [form, setForm] = useState<AiCfg | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<'idle' | 'testing' | 'ok' | 'err'>('idle')
  const [testMsg, setTestMsg] = useState('')
  useEffect(() => { if (!form && stored) setForm(stored) }, [stored, form])
  if (!form) return null

  function update(patch: Partial<AiCfg>) {
    setForm({ ...form!, ...patch })
    void patchAi(patch)
    setTest('idle') // any edit invalidates a prior test result
  }

  // Collapse/expand the detail fields. Kept separate from update() so it doesn't
  // clear the last test result — a user who just connected can collapse and later
  // re-expand with the Test still showing as passed.
  function setCollapsed(detailsCollapsed: boolean) {
    setForm({ ...form!, detailsCollapsed })
    void patchAi({ detailsCollapsed })
  }

  async function runTest() {
    setTest('testing'); setTestMsg('')
    const r = await makeProvider(form!).testConnection()
    if (r.ok) setTest('ok')
    else { setTest('err'); setTestMsg(r.error) }
  }

  // Switching provider also swaps in that provider's default model (a Claude model
  // id means nothing to Gemini), unless the user has typed a custom one for it.
  function pickProvider(provider: AiProvider) {
    const model = form!.model === AI_MODELS[form!.provider] ? AI_MODELS[provider] : form!.model
    update({ provider, model })
  }

  const providers: Array<{ value: AiProvider; label: string; ready: boolean }> = [
    { value: 'claude', label: 'Anthropic Claude', ready: true },
    { value: 'gemini', label: 'Google Gemini', ready: true },
    { value: 'openai', label: 'OpenAI ChatGPT', ready: false },
  ]

  return (
    <>
      <h2 className="set-group-title">{t('AI receipt scanning')}</h2>
      <section className="set-card">
        <div className="set-field">
          <label>{t('Scan receipts with AI')}</label>
          <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <OnOff value={form.enabled} onChange={(v) => update({ enabled: v })} />
            {/* Once set up and collapsed, re-open the key/model fields from here. */}
            {form.enabled && form.detailsCollapsed && (
              <button type="button" className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setCollapsed(false)}>
                {t('Show Model')}
              </button>
            )}
          </div>
          <span className="set-hint">{t('Long-press the + button to snap a receipt; a tap still adds manually.')}</span>
        </div>

        {/* The provider/key/model settings only matter once scanning is on, so we
            keep them hidden until then — and let the user collapse them again after
            a successful connection to keep the card tidy. */}
        {form.enabled && !form.detailsCollapsed && (
        <>
        <div className="set-field">
          <label>{t('Provider')}</label>
          <select
            value={form.provider}
            style={{ maxWidth: 260 }}
            onChange={(e) => pickProvider(e.target.value as AiProvider)}
          >
            {providers.map((p) => (
              <option key={p.value} value={p.value} disabled={!p.ready}>
                {p.label}{p.ready ? '' : ` — ${t('needs a proxy, coming later')}`}
              </option>
            ))}
          </select>
          <span className="set-hint">{t('Claude and Gemini run directly in the browser; Gemini has a free tier.')}</span>
        </div>

        <div className="set-field">
          <label>{t('API key')}</label>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={PROVIDER_KEY_HINT[form.provider]}
              style={{ maxWidth: 260, fontFamily: 'monospace' }}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
            <button type="button" className="btn ghost" onClick={() => setShowKey((s) => !s)}>
              {showKey ? t('Hide') : t('Show')}
            </button>
          </div>
          <a
            className="key-help-link"
            href={PROVIDER_KEY_URL[form.provider]}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('Get an API key')} ↗
          </a>
          <span className="set-hint">{t('Your key is stored only on this device and sent only to the provider.')}</span>
        </div>

        <div className="set-field">
          <label>{t('Model')}</label>
          <input
            value={form.model}
            style={{ maxWidth: 260, fontFamily: 'monospace' }}
            onChange={(e) => update({ model: e.target.value })}
          />
          <a
            className="key-help-link"
            href={AI_MODELS_URL[form.provider]}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('See available models')} ↗
          </a>
          <span className="set-hint">{t('Model names change often. If Test connection fails, open the list and use a current one.')}</span>
        </div>

        <div className="set-field">
          <label>{t('Review before saving')}</label>
          <OnOff value={form.confirmBeforeSave} onChange={(v) => update({ confirmBeforeSave: v })} />
          <span className="set-hint">{t('Check the extracted details before the transaction is recorded.')}</span>
        </div>

        <div className="row" style={{ gap: 12, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-accent" onClick={runTest} disabled={test === 'testing' || !form.apiKey.trim()}>
            {test === 'testing' ? t('Testing…') : t('Test connection')}
          </button>
          {/* Always available so the user can tuck the key/model away whenever. */}
          <button type="button" className="btn ghost" onClick={() => setCollapsed(true)}>
            {t('Collapse settings')}
          </button>
          {test === 'ok' && <span className="amt-income" style={{ fontSize: 14 }}>{t('Connected ✓')}</span>}
          {test === 'err' && <span className="amt-expense" style={{ fontSize: 14 }}>{t('Failed')}: {testMsg}</span>}
        </div>
        {test === 'err' && (
          <span className="set-hint">{t('The model may be unavailable for your key — try a current one from “See available models” above.')}</span>
        )}
        <span className="set-hint" style={{ marginTop: 8 }}>
          {t('Scans use your own API key, so they count against your provider’s free tier or billing.')}
        </span>
        </>
        )}
      </section>
    </>
  )
}

// A tappable navigation card: leading icon, title + description, trailing chevron.
function ToolLink({ to, icon, title, desc }: { to: string; icon: string; title: string; desc: string }) {
  return (
    <Link to={to} className="set-card set-card-link">
      <span className="set-link-icon" aria-hidden="true">{icon}</span>
      <span className="set-link-body">
        <span className="set-card-title">{title}</span>
        <span className="set-card-desc">{desc}</span>
      </span>
      <span className="set-link-chevron" aria-hidden="true">›</span>
    </Link>
  )
}

// Same card, but it runs an action (re-open the tour / install guide) instead of
// navigating — used by the "Getting started" group. `icon` is optional.
function ToolButton({ icon, title, desc, onClick }: { icon?: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" className="set-card set-card-link" onClick={onClick}>
      {icon && <span className="set-link-icon" aria-hidden="true">{icon}</span>}
      <span className="set-link-body">
        <span className="set-card-title">{title}</span>
        <span className="set-card-desc">{desc}</span>
      </span>
      <span className="set-link-chevron" aria-hidden="true">›</span>
    </button>
  )
}

export function SettingsPage() {
  return (
    <div>
      <h1 className="h1">{tBilingual('Settings')}</h1>

      <PreferencesSettings />
      <GeneralSettings />
      <AiSettings />

      <h2 className="set-group-title">{t('Getting started')}</h2>
      <ToolButton title={t('Take the tour')} desc={t('A quick walkthrough of what the app does.')} onClick={() => openOnboarding('tour')} />
      <ToolButton title={t('Add to home screen')} desc={t('How to install the app on your phone.')} onClick={() => openOnboarding('install')} />

      <h2 className="set-group-title">{t('Data & tools')}</h2>
      <ToolLink to="/manage" icon="🛠️" title={t('Manage accounts & categories')} desc={t('Add, rename, reorder, or remove accounts and categories.')} />
      <ToolLink to="/import" icon="📥" title={t('Import')} desc={t('Bring in a CSV or Excel export from another money app.')} />
      <ToolLink to="/backup" icon="💾" title={t('Export & backup')} desc={t('Export a spreadsheet, or back up and restore all your data.')} />

      <p className="muted" style={{ marginTop: 4 }}>
        {t('Your data is stored on this device only.')}
      </p>
    </div>
  )
}
