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
// Settings: a crossed wrench + screwdriver, with a small hard-coded "EN/TH" marker
// baked in (same regardless of app language) so users know the language switch lives
// here. The tools sit in the upper area; the marker rides along the bottom edge.
function ToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke}>
      {/* Wrench: open-end head + shaft running to lower-right. */}
      <path d="M14.6 3.6a3.4 3.4 0 00-4.3 4.1l-6 6 2 2 6-6a3.4 3.4 0 004.1-4.3l-2 2-1.8-1.8z" />
      {/* Screwdriver: handle upper-right, blade to lower-left. */}
      <path d="M20 4l-1.6 1.6M18.4 5.6l-5.9 5.9 1.5 1.5 5.9-5.9zM12.5 11.5l-1.4 1.4" />
      {/* Language marker. <text> needs its own fill since the shared stroke sets fill:none. */}
      <text x="12" y="23" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor" stroke="none">EN/TH</text>
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
        <ToolsIcon />
        <span>{t('Settings')}</span>
      </NavLink>
    </nav>
  )
}
