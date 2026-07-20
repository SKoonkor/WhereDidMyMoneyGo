import { NavLink } from 'react-router-dom'
import { t } from '../i18n'

// Bottom tab bar: Home · Transactions · ＋Add · Apps · Settings. The center ＋ is
// an action (opens the Add-transaction sheet), not a route. Icons are inline
// SVGs so they render identically across devices (unlike emoji).
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  )
}
function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5a1.7 1.7 0 000-3l1.1-1.9-2-2-1.9 1.1a1.7 1.7 0 00-3 0L11.8 5.7l-2 2 1.1 1.9a1.7 1.7 0 000 3l-1.1 1.9 2 2 1.9-1.1a1.7 1.7 0 003 0l1.9 1.1 2-2z" />
    </svg>
  )
}

const tab = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'bottom-nav-item active' : 'bottom-nav-item'

export function BottomNav({ onAdd }: { onAdd: () => void }) {
  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={tab}>
        <HomeIcon />
        <span>{t('Home')}</span>
      </NavLink>
      <NavLink to="/transactions" className={tab}>
        <ListIcon />
        <span>{t('Transactions')}</span>
      </NavLink>
      <button type="button" className="bottom-nav-add" onClick={onAdd} aria-label={t('Add transaction')}>
        <svg viewBox="0 0 24 24" {...stroke}><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <NavLink to="/apps" className={tab}>
        <GridIcon />
        <span>{t('Apps')}</span>
      </NavLink>
      <NavLink to="/settings" className={tab}>
        <GearIcon />
        <span>{t('Settings')}</span>
      </NavLink>
    </nav>
  )
}
