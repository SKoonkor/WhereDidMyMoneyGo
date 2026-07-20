import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, saveSettings } from '../../db'
import { DEFAULT_SETTINGS, type Settings } from '../../data/defaults'
import { t } from '../../i18n'

// General settings (app name, base currency, reset day). Autosaves each change
// to the on-device config. Seeded once from the stored settings so typing never
// fights the live query.
function GeneralSettings() {
  // No default here: the query is `undefined` until the real stored settings
  // load, so we seed the form from persisted values (not the fallback defaults).
  const stored = useLiveQuery(() => getSettings(), [])
  const [form, setForm] = useState<Settings | null>(null)
  useEffect(() => { if (!form && stored) setForm(stored) }, [stored, form])
  if (!form) return null

  function update(patch: Partial<Settings>) {
    const next = { ...form!, ...patch }
    setForm(next)
    void saveSettings(next)
  }

  return (
    <section className="manage-section">
      <h2 className="manage-h2">{t('General')}</h2>

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
  )
}

export function SettingsPage() {
  return (
    <div>
      <h1 className="h1">{t('Settings')}</h1>

      <GeneralSettings />

      <div className="settings-links">
        <Link to="/manage" className="settings-link">
          <span className="settings-link-title">{t('Manage accounts & categories')}</span>
          <span className="settings-link-desc">{t('Add, rename, reorder, or remove accounts and categories.')}</span>
        </Link>
        <Link to="/import" className="settings-link">
          <span className="settings-link-title">{t('Import')}</span>
          <span className="settings-link-desc">{t('Bring in a CSV or Excel export from another money app.')}</span>
        </Link>
        <Link to="/backup" className="settings-link">
          <span className="settings-link-title">{t('Export & backup')}</span>
          <span className="settings-link-desc">{t('Export a spreadsheet, or back up and restore all your data.')}</span>
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 20 }}>
        {t('Your data is stored on this device only.')}
      </p>
    </div>
  )
}
