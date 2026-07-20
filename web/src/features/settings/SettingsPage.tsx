import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, saveSettings } from '../../db'
import { useAccounts } from '../transactions/useConfig'
import { DEFAULT_SETTINGS, type Settings } from '../../data/defaults'
import { t } from '../../i18n'

// Merge a patch onto the freshest stored settings, so independent settings
// cards can't clobber each other's fields with a stale full copy.
async function patchSettings(patch: Partial<Settings>) {
  await saveSettings({ ...(await getSettings()), ...patch })
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
    <section className="set-card">
      <h2 className="set-card-title">{t('General')}</h2>

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

// Savings pool: which accounts count toward the pool, plus the Emergency Fund
// base (monthlyRequired × targetMonths). Drives the Financial Goals gauge.
function SavingsPoolSettings() {
  const accounts = useAccounts()
  const stored = useLiveQuery(() => getSettings(), [])
  const [form, setForm] = useState<Settings | null>(null)
  useEffect(() => { if (!form && stored) setForm(stored) }, [stored, form])
  if (!form) return null

  function update(patch: Partial<Settings>) {
    setForm({ ...form!, ...patch })
    void patchSettings(patch)
  }

  const pool = new Set(form.savingsAccounts)
  const toggle = (name: string) => {
    const next = pool.has(name) ? form.savingsAccounts.filter((a) => a !== name) : [...form.savingsAccounts, name]
    update({ savingsAccounts: next })
  }
  const efTarget = form.monthlyRequired * form.targetMonths

  return (
    <section className="set-card">
      <h2 className="set-card-title">{t('Savings pool')}</h2>

      <div className="set-field">
        <label>{t('Pool accounts')}</label>
        <div className="chip-choices">
          {accounts.map((a) => (
            <button
              key={a}
              type="button"
              className={pool.has(a) ? 'choice-chip on' : 'choice-chip'}
              aria-pressed={pool.has(a)}
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
          value={form.monthlyRequired}
          style={{ maxWidth: 160 }}
          onChange={(e) => update({ monthlyRequired: Math.max(0, Number(e.target.value) || 0) })}
        />
        <span className="set-hint">{t('Your baseline monthly spending — used to size the Emergency Fund.')}</span>
      </div>

      <div className="set-field">
        <label>{t('Target months')}</label>
        <input
          type="number"
          min={1}
          max={24}
          value={form.targetMonths}
          style={{ maxWidth: 90 }}
          onChange={(e) => update({ targetMonths: Math.min(24, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
        />
        <span className="set-hint">
          {t('Months of expenses to keep. Emergency Fund target = {amount}.', {
            amount: `${efTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${form.baseCurrency}`,
          })}
        </span>
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
      <SavingsPoolSettings />

      <Link to="/manage" className="set-card set-card-link">
        <span className="set-card-title">{t('Manage accounts & categories')}</span>
        <span className="set-card-desc">{t('Add, rename, reorder, or remove accounts and categories.')}</span>
      </Link>
      <Link to="/import" className="set-card set-card-link">
        <span className="set-card-title">{t('Import')}</span>
        <span className="set-card-desc">{t('Bring in a CSV or Excel export from another money app.')}</span>
      </Link>
      <Link to="/backup" className="set-card set-card-link">
        <span className="set-card-title">{t('Export & backup')}</span>
        <span className="set-card-desc">{t('Export a spreadsheet, or back up and restore all your data.')}</span>
      </Link>

      <p className="muted" style={{ marginTop: 4 }}>
        {t('Your data is stored on this device only.')}
      </p>
    </div>
  )
}
