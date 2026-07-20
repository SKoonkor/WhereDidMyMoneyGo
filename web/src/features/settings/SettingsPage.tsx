import { Link } from 'react-router-dom'
import { t } from '../../i18n'

// Settings hub. For now it links to the tools that exist; base currency, app
// name, reset-day, and import/backup land in later Phase 1 tasks.
export function SettingsPage() {
  return (
    <div>
      <h1 className="h1">{t('Settings')}</h1>
      <div className="settings-links">
        <Link to="/manage" className="settings-link">
          <span className="settings-link-title">{t('Manage accounts & categories')}</span>
          <span className="settings-link-desc">{t('Add, rename, reorder, or remove accounts and categories.')}</span>
        </Link>
        <Link to="/import" className="settings-link">
          <span className="settings-link-title">{t('Import')}</span>
          <span className="settings-link-desc">{t('Bring in a CSV or Excel export from another money app.')}</span>
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 20 }}>
        {t('Your data is stored on this device only.')}
      </p>
    </div>
  )
}
