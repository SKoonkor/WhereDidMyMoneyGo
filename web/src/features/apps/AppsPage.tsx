import { Link } from 'react-router-dom'
import { t } from '../../i18n'

// Launcher grid for the analytics/feature pages, split into two groups:
// day-to-day money tracking vs. forward-looking calculators.
interface Tile { to: string; label: string; desc: string; icon: string }

const PERSONAL_FINANCE: Tile[] = [
  { to: '/composition', label: 'Income & Expense', desc: 'Category breakdown by month.', icon: '🍩' },
  { to: '/flow', label: 'Money Flow', desc: 'Running balance and forecast.', icon: '💸' },
  { to: '/budget', label: 'Budget', desc: 'Where your money goes vs. plan.', icon: '📊' },
  { to: '/goals', label: 'Goals', desc: 'Savings goals and progress.', icon: '🎯' },
  { to: '/reconcile', label: 'Reconcile', desc: 'Match tracked balances to reality.', icon: '⚖️' },
]

const CALCULATORS: Tile[] = [
  { to: '/retirement', label: 'Retirement Planning', desc: 'Project saving then drawing down.', icon: '🏖️' },
  { to: '/compound', label: 'Compound Interest', desc: 'See how deposits grow over time.', icon: '📈' },
  { to: '/income-tax', label: 'Income Tax', desc: 'Estimate your yearly income tax.', icon: '🧾' },
]

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="apps-grid">
      {tiles.map((tile) => (
        <Link key={tile.to} to={tile.to} className="app-tile">
          <span className="app-tile-icon" aria-hidden="true">{tile.icon}</span>
          <span className="app-tile-label">{t(tile.label)}</span>
          <span className="app-tile-desc">{t(tile.desc)}</span>
        </Link>
      ))}
    </div>
  )
}

export function AppsPage() {
  return (
    <div>
      <h1 className="h1">{t('Apps')}</h1>

      <h2 className="apps-section-title">{t('Personal Finance')}</h2>
      <TileGrid tiles={PERSONAL_FINANCE} />

      <h2 className="apps-section-title">{t('Calculators')}</h2>
      <TileGrid tiles={CALCULATORS} />

      <p className="muted" style={{ marginTop: 20 }}>{t('More coming soon.')}</p>
    </div>
  )
}
