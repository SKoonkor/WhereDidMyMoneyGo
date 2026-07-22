import { NavLink } from 'react-router-dom'
import { useHold } from '../lib/useHold'
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
// Settings: a single wrench with a small hard-coded "EN/TH" marker baked in (same
// regardless of app language) so users know the language switch lives here. The
// wrench sits in the upper area; the marker rides along the bottom edge.
function ToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke}>
      {/* Wrench: open-end head + shaft running to lower-right. */}
      <path d="M15.5 3.4a3.6 3.6 0 00-4.6 4.4l-6.3 6.3 2.1 2.1 6.3-6.3a3.6 3.6 0 004.4-4.6l-2.1 2.1-1.9-1.9z" />
      {/* Language marker. <text> needs its own fill since the shared stroke sets fill:none. */}
      <text x="12" y="23" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor" stroke="none">EN/TH</text>
    </svg>
  )
}

const tab = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'bottom-nav-item active' : 'bottom-nav-item'

// `onLongPress` (when provided — i.e. AI scanning is on and a key is set) fires on
// a hold of the ＋; a tap always opens the manual Add sheet. When it's absent, a
// hold falls back to a tap, so nothing changes for users without AI configured.
export function BottomNav({ onAdd, onLongPress }: { onAdd: () => void; onLongPress?: () => void }) {
  const { pressing, ...hold } = useHold(onLongPress ?? onAdd, onAdd)
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
      <button
        type="button"
        className={pressing ? 'bottom-nav-add pressing' : 'bottom-nav-add'}
        aria-label={t('Add transaction')}
        {...hold}
      >
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
