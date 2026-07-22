import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getNotifications, getSettings, saveNotifications, saveSettings } from '../../db'
import { useAccounts } from '../transactions/useConfig'
import { useLang, useTheme, useCensor } from '../../prefs'
import { DEFAULT_SETTINGS, type Settings } from '../../data/defaults'
import { notifyCapability, requestNotifyPermission } from '../../lib/notify'
import { t } from '../../i18n'

// Merge a patch onto the freshest stored settings, so independent settings
// cards can't clobber each other's fields with a stale full copy.
async function patchSettings(patch: Partial<Settings>) {
  await saveSettings({ ...(await getSettings()), ...patch })
}

// Preferences hub: language, theme, and privacy — all backed by localStorage
// (prefs.ts), so these mirror the header's quick toggles live.
function PreferencesSettings() {
  return (
    <>
      <h2 className="set-group-title">{t('Preferences')}</h2>
      <section className="set-card">
        <div className="set-field">
          <label>{t('Language')}</label>
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
    await saveNotifications({ ...cfg!, enabled: on })
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
          onChange={(e) => { void saveNotifications({ ...cfg, time: e.target.value || cfg.time }) }}
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

        <div className="set-field">
          <label>{t('Month start day')}</label>
          <input
            type="number"
            min={1}
            max={28}
            value={form.resetDay}
            style={{ maxWidth: 90 }}
            onChange={(e) => {
              const n = Math.min(28, Math.max(1, Math.round(Number(e.target.value) || 1)))
              update({ resetDay: n })
            }}
          />
          <span className="set-hint">{t('The day each budgeting month begins (1–28). Used by Budget.')}</span>
        </div>

        <p className="muted set-autosave">{t('Changes are saved automatically.')}</p>
      </section>
    </>
  )
}

// Savings pool: which accounts count toward the pool, plus the Emergency Fund
// base (monthlyRequired × targetMonths). Drives the Financial Goals gauge.
// Unlike General, this card is draft-based with an explicit Save button so the
// numeric fields can be cleared and retyped freely (they clamp only on Save).
function SavingsPoolSettings() {
  const accounts = useAccounts()
  const stored = useLiveQuery(() => getSettings(), [])
  const [pool, setPool] = useState<string[] | null>(null)
  const [monthly, setMonthly] = useState('')
  const [months, setMonths] = useState('')
  const [saved, setSaved] = useState(false)

  // Seed the draft once from the stored settings.
  useEffect(() => {
    if (pool === null && stored) {
      setPool(stored.savingsAccounts)
      setMonthly(String(stored.monthlyRequired))
      setMonths(String(stored.targetMonths))
    }
  }, [stored, pool])
  if (pool === null) return null

  const inPool = new Set(pool)
  const toggle = (name: string) => {
    setSaved(false)
    setPool((p) => (p!.includes(name) ? p!.filter((a) => a !== name) : [...p!, name]))
  }

  const monthlyNum = Math.max(0, Number(monthly) || 0)
  const monthsNum = Math.min(24, Math.max(1, Math.round(Number(months) || 1)))
  const currency = stored?.baseCurrency ?? DEFAULT_SETTINGS.baseCurrency
  const efTarget = monthlyNum * monthsNum

  async function save() {
    await patchSettings({ savingsAccounts: pool!, monthlyRequired: monthlyNum, targetMonths: monthsNum })
    // Reflect the clamped values back into the fields.
    setMonthly(String(monthlyNum))
    setMonths(String(monthsNum))
    setSaved(true)
  }

  return (
    <>
      <h2 className="set-group-title">{t('Savings pool')}</h2>
      <section className="set-card">
        <div className="set-field">
          <label>{t('Pool accounts')}</label>
        <div className="chip-choices">
          {accounts.map((a) => (
            <button
              key={a}
              type="button"
              className={inPool.has(a) ? 'choice-chip on' : 'choice-chip'}
              aria-pressed={inPool.has(a)}
              onClick={() => toggle(a)}
            >
              {a}
            </button>
          ))}
        </div>
        <span className="set-hint">{t('Balances of these accounts make up your savings pool.')}</span>
      </div>

      <div className="set-field">
        <label>{t('Monthly required expenses')}</label>
        <input
          type="number"
          inputMode="decimal"
          value={monthly}
          style={{ maxWidth: 160 }}
          onChange={(e) => { setMonthly(e.target.value); setSaved(false) }}
        />
        <span className="set-hint">{t('Your baseline monthly spending — used to size the Emergency Fund.')}</span>
      </div>

      <div className="set-field">
        <label>{t('Target months')}</label>
        <input
          type="number"
          inputMode="numeric"
          value={months}
          style={{ maxWidth: 90 }}
          onChange={(e) => { setMonths(e.target.value); setSaved(false) }}
        />
        <span className="set-hint">
          {t('Months of expenses to keep. Emergency Fund target = {amount}.', {
            amount: `${efTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`,
          })}
        </span>
      </div>

        <div className="row" style={{ gap: 12, marginTop: 4 }}>
          <button type="button" className="btn btn-accent" onClick={save}>{t('Save')}</button>
          {saved && <span className="amt-income" style={{ alignSelf: 'center', fontSize: 14 }}>{t('Saved ✓')}</span>}
        </div>
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

export function SettingsPage() {
  return (
    <div>
      <h1 className="h1">{t('Settings')}</h1>

      <PreferencesSettings />
      <GeneralSettings />
      <SavingsPoolSettings />

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
