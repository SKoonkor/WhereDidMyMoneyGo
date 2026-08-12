import { NavLink } from 'react-router-dom'
import { useHold } from '../lib/useHold'
import { t } from '../i18n'
import { useTradingMode } from '../tradingMode'

// Bottom tab bar: Home · Transactions · ＋Add · Apps · Settings. The center ＋ is
// an action (opens the Add-transaction sheet), not a route. Icons are inline
// SVGs so they render identically across devices (unlike emoji).
//
// While paper trading is on, the same five slots are repurposed in place —
// Chart · Accounts · ＋Buy/Sell · Apps · Chart settings — one bar, same geometry,
// no second row. The JSX stays a literal rather than becoming a slot array: the
// centre slot is a <button> with a hook and slot 5 changes from a link to an
// action, so a uniform array would force every slot through the union of their
// needs, in the one component that ships on every screen.
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
// Candlesticks: two bodies with their wicks. Same viewBox and stroke as the rest
// so it sits on the baseline the other four glyphs share.
function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M8 3v3M8 16v5" />
      <rect x="5" y="6" width="6" height="10" rx="1" />
      <path d="M16 3v6M16 17v4" />
      <rect x="13" y="9" width="6" height="8" rx="1" />
    </svg>
  )
}
// Settings: a single wrench with a small hard-coded "EN/TH" marker baked in (same
// regardless of app language) so users know the language switch lives here. The
// wrench sits in the upper area; the marker rides along the bottom edge.
//
// `lang` turns that marker off: in trading mode this slot opens Chart settings,
// which has no language switch, so the marker would be advertising something the
// tap does not do.
function ToolsIcon({ lang = true }: { lang?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" {...stroke}>
      {/* Wrench: open-end head + shaft running to lower-right. */}
      <path d="M15.5 3.4a3.6 3.6 0 00-4.6 4.4l-6.3 6.3 2.1 2.1 6.3-6.3a3.6 3.6 0 004.4-4.6l-2.1 2.1-1.9-1.9z" />
      {/* Language marker. <text> needs its own fill since the shared stroke sets fill:none. */}
      {lang && (
        <text x="12" y="23" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor" stroke="none">EN/TH</text>
      )}
    </svg>
  )
}

const tab = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'bottom-nav-item active' : 'bottom-nav-item'

// `onLongPress` (when provided — i.e. AI scanning is on and a key is set) fires on
// a hold of the ＋; a tap always opens the manual Add sheet. When it's absent, a
// hold falls back to a tap, so nothing changes for users without AI configured.
//
// `onCentre` / `onChartSettings` are the trading-mode meanings of slots 3 and 5.
export function BottomNav({ onAdd, onLongPress, onCentre, onChartSettings }: {
  onAdd: () => void
  onLongPress?: () => void
  onCentre: () => void
  onChartSettings: () => void
}) {
  const trading = useTradingMode()
  // ONE useHold call with ternary arguments, never two call sites: this hook
  // ships on every screen, and a second call site would make the hook order
  // depend on the mode.
  //
  // In trading the hold is wired to the tap — i.e. the AI receipt capture is
  // deliberately unreachable. Not tidiness: with "Review before saving" off,
  // that capture can write a real Expense to the real ledger with no further
  // confirmation, and a stray hold on a button whose current meaning is "place
  // an order" is the worst kind of mode error. useHold(fn, fn) is already the
  // shipped path for everyone without an AI key.
  const centre = trading ? onCentre : onAdd
  const longPress = trading ? centre : (onLongPress ?? onAdd)
  const { pressing, ...hold } = useHold(longPress, centre)
  return (
    <nav className="bottom-nav">
      {trading ? (
        <NavLink to="/trading" end className={tab}>
          <ChartIcon />
          <span>{t('Chart')}</span>
        </NavLink>
      ) : (
        <NavLink to="/" end className={tab}>
          <HomeIcon />
          <span>{t('Home')}</span>
        </NavLink>
      )}
      {trading ? (
        <NavLink to="/trading/accounts" className={tab}>
          <ListIcon />
          <span>{t('Accounts')}</span>
        </NavLink>
      ) : (
        <NavLink to="/transactions" className={tab}>
          <ListIcon />
          <span>{t('Transactions')}</span>
        </NavLink>
      )}
      <button
        type="button"
        className={pressing ? 'bottom-nav-add pressing' : 'bottom-nav-add'}
        aria-label={trading ? t('Buy or sell') : t('Add transaction')}
        {...hold}
      >
        <svg viewBox="0 0 24 24" {...stroke}><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <NavLink to="/apps" className={tab}>
        <GridIcon />
        <span>{t('Apps')}</span>
      </NavLink>
      {/* Slot 5 needs no CSS of its own: .bottom-nav-item already zeroes button
          chrome, so the link and the action look the same. */}
      {trading ? (
        <button type="button" className="bottom-nav-item" onClick={onChartSettings}>
          <ToolsIcon lang={false} />
          <span>{t('Chart settings')}</span>
        </button>
      ) : (
        <NavLink to="/settings" className={tab}>
          <ToolsIcon />
          <span>{t('Settings')}</span>
        </NavLink>
      )}
    </nav>
  )
}
