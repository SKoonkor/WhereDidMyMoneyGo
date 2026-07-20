import { Link } from 'react-router-dom'
import { t } from '../../i18n'

// Launcher grid for the analytics/feature pages. Phase 2 dashboards are added
// here as they land; for now Budget and Goals are placeholders.
interface Tile { to: string; label: string; desc: string; icon: string }

const TILES: Tile[] = [
  { to: '/budget', label: 'Budget', desc: 'Where your money goes vs. plan.', icon: '📊' },
  { to: '/goals', label: 'Goals', desc: 'Savings goals and progress.', icon: '🎯' },
]

export function AppsPage() {
  return (
    <div>
      <h1 className="h1">{t('Apps')}</h1>
      <div className="apps-grid">
        {TILES.map((tile) => (
          <Link key={tile.to} to={tile.to} className="app-tile">
            <span className="app-tile-icon" aria-hidden="true">{tile.icon}</span>
            <span className="app-tile-label">{t(tile.label)}</span>
            <span className="app-tile-desc">{t(tile.desc)}</span>
          </Link>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 20 }}>{t('More coming soon.')}</p>
    </div>
  )
}
