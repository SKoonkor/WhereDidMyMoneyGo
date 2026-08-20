import { Link } from 'react-router-dom'
import { t } from '../../i18n'
import { requestLeave, TRADING_ENABLED } from '../../tradingMode'

// Launcher grid for the analytics/feature pages, split into two groups:
// day-to-day money tracking vs. forward-looking calculators.
interface Tile { to: string; label: string; desc: string; icon: string }

const PERSONAL_FINANCE: Tile[] = [
  { to: '/composition', label: 'Income & Expense', desc: 'Category breakdown by month.', icon: '🍩' },
  { to: '/flow', label: 'Money Flow', desc: 'Running balance and forecast.', icon: '💸' },
  { to: '/budget', label: 'Budget', desc: 'Where your money goes vs. plan.', icon: '📊' },
  { to: '/goals', label: 'Financial Goals', desc: 'Savings goals and progress.', icon: '🎯' },
  { to: '/goal-savings', label: 'Goal savings', desc: 'Split your pool between goals.', icon: '🏦' },
  { to: '/debts', label: 'Debts', desc: 'What you owe and when it ends.', icon: '💳' },
  { to: '/limits', label: 'Spending limits', desc: 'Cap what you spend per category.', icon: '🚦' },
  { to: '/reconcile', label: 'Reconcile', desc: 'Match tracked balances to reality.', icon: '⚖️' },
]

const CALCULATORS: Tile[] = [
  { to: '/retirement', label: 'Retirement Planning', desc: 'Project saving then drawing down.', icon: '🏖️' },
  { to: '/compound', label: 'Compound Interest', desc: 'See how deposits grow over time.', icon: '📈' },
  { to: '/income-tax', label: 'Income Tax', desc: 'Estimate your yearly income tax.', icon: '🧾' },
]

// Kept apart from the calculators on purpose: everything above answers a question
// about the user's real money, and this does not. The tile says so in its own
// description, and the page itself opens on a one-time disclaimer.
const SIMULATORS: Tile[] = [
  { to: '/trading', label: 'Paper trading', desc: 'Practise on a simulated market.', icon: '🕹️' },
]

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="apps-grid">
      {tiles.map((tile) => (
        // One guard, in the single place every tile renders: a false means some
        // other screen has a reason to ask the user first and has raised it, so
        // this navigation must not happen. It returns true whenever nothing is
        // asking, which is the overwhelmingly common case.
        <Link
          key={tile.to}
          to={tile.to}
          className="app-tile"
          onClick={(e) => { if (!requestLeave(tile.to)) e.preventDefault() }}
        >
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

      {/* Parked — see TRADING_ENABLED. The heading goes with the grid: hiding
          only the tile would leave an empty "Simulators" section behind. */}
      {TRADING_ENABLED && (
        <>
          <h2 className="apps-section-title">{t('Simulators')}</h2>
          <TileGrid tiles={SIMULATORS} />
        </>
      )}

      <p className="muted" style={{ marginTop: 20 }}>{t('More coming soon.')}</p>
    </div>
  )
}
