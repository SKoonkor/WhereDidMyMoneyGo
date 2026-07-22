// Lightweight, theme-aware illustrations for each tour step. All are inline SVG
// drawn with currentColor + a couple of CSS-variable accents (see .tour-mock in
// App.css), so they cost nothing to ship and follow light/dark automatically.
import { t } from '../../i18n'

const VB = '0 0 280 190'
const soft = 'var(--surface-2)'
const line = 'var(--border)'
const ink = 'currentColor'
const accent = 'var(--accent)'
const muted = 'var(--muted)'

// A rounded "screen" backdrop shared by most scenes.
function Screen() {
  return <rect x="8" y="8" width="264" height="174" rx="14" fill={soft} stroke={line} />
}

export function IntroMock() {
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('Welcome')}>
      <Screen />
      <circle cx="140" cy="70" r="34" fill={accent} opacity="0.15" />
      <circle cx="140" cy="70" r="24" fill="none" stroke={accent} strokeWidth="3" />
      <text x="140" y="78" textAnchor="middle" fontSize="26" fontWeight="700" fill={accent}>฿</text>
      <rect x="70" y="120" width="140" height="12" rx="6" fill={ink} opacity="0.85" />
      <rect x="95" y="142" width="90" height="8" rx="4" fill={muted} />
    </svg>
  )
}

export function RecordMock() {
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('Record a transaction')}>
      <Screen />
      {/* a couple of existing rows */}
      <rect x="26" y="30" width="150" height="10" rx="5" fill={ink} opacity="0.8" />
      <rect x="210" y="30" width="44" height="10" rx="5" fill={muted} />
      <rect x="26" y="52" width="120" height="10" rx="5" fill={ink} opacity="0.55" />
      <rect x="210" y="52" width="44" height="10" rx="5" fill={muted} />
      {/* the highlighted + button */}
      <circle cx="140" cy="120" r="26" fill={accent} />
      <path d="M140 108v24M128 120h24" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="140" cy="120" r="34" fill="none" stroke={accent} strokeWidth="2" opacity="0.4" />
      <circle cx="140" cy="120" r="42" fill="none" stroke={accent} strokeWidth="1.5" opacity="0.2" />
    </svg>
  )
}

export function TabBarMock() {
  const tabs = [
    { x: 30, label: '⌂' },
    { x: 80, label: '☰' },
    { x: 140, label: '＋', add: true },
    { x: 200, label: '▦' },
    { x: 250, label: '🔧' },
  ]
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('The tab bar')}>
      <Screen />
      <rect x="8" y="132" width="264" height="50" rx="0" fill="var(--surface)" stroke={line} />
      {tabs.map((tb) =>
        tb.add ? (
          <g key={tb.x}>
            <circle cx={tb.x} cy="150" r="20" fill={accent} />
            <path d="M140 141v18M131 150h18" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          </g>
        ) : (
          <text key={tb.x} x={tb.x} y="160" textAnchor="middle" fontSize="18" fill={muted}>{tb.label}</text>
        ),
      )}
      {/* callout arrow */}
      <path d="M140 96v20" stroke={accent} strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  )
}

export function AppsMock() {
  const tiles = [0, 1, 2, 3, 4, 5]
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('The apps & tools')}>
      <Screen />
      {tiles.map((i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = 30 + col * 78
        const y = 30 + row * 62
        return (
          <g key={i}>
            <rect x={x} y={y} width="64" height="50" rx="10" fill="var(--surface)" stroke={line} />
            <circle cx={x + 16} cy={y + 18} r="7" fill={accent} opacity="0.8" />
            <rect x={x + 10} y={y + 32} width="44" height="6" rx="3" fill={muted} />
          </g>
        )
      })}
    </svg>
  )
}

export function SettingsMock() {
  const rows = [0, 1, 2, 3]
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('Settings')}>
      <Screen />
      {rows.map((i) => {
        const y = 30 + i * 36
        return (
          <g key={i}>
            <rect x="26" y={y} width="228" height="28" rx="8" fill="var(--surface)" stroke={line} />
            <circle cx="44" cy={y + 14} r="8" fill={accent} opacity="0.75" />
            <rect x="60" y={y + 10} width="90" height="8" rx="4" fill={ink} opacity="0.7" />
            <rect x="214" y={y + 9} width="28" height="10" rx="5" fill={muted} />
          </g>
        )
      })}
    </svg>
  )
}

export function ImportMock() {
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('Import')}>
      <Screen />
      {/* file */}
      <g>
        <path d="M50 40h34l14 14v54H50z" fill="var(--surface)" stroke={line} strokeWidth="2" />
        <path d="M84 40v14h14" fill="none" stroke={line} strokeWidth="2" />
        <rect x="58" y="66" width="32" height="5" rx="2.5" fill={muted} />
        <rect x="58" y="78" width="32" height="5" rx="2.5" fill={muted} />
        <rect x="58" y="90" width="22" height="5" rx="2.5" fill={muted} />
      </g>
      {/* arrow */}
      <path d="M116 82h40" stroke={accent} strokeWidth="3" strokeLinecap="round" />
      <path d="M150 74l10 8-10 8" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* app list */}
      <rect x="176" y="46" width="70" height="72" rx="10" fill="var(--surface)" stroke={line} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x="186" y={58 + i * 18} width="50" height="8" rx="4" fill={i === 0 ? accent : muted} opacity={i === 0 ? 0.8 : 1} />
      ))}
    </svg>
  )
}

// The developer's photo with a small heart badge — a friendlier close to the tour
// than a bare graphic. The photo lives in public/ so it's referenced base-relative.
export function SupportMock() {
  return (
    <div className="tour-support-visual" role="img" aria-label={t('Support the developer')}>
      <span className="tour-avatar-wrap">
        <img className="tour-avatar" src={`${import.meta.env.BASE_URL}profile.jpg`} alt="" />
        <span className="tour-avatar-heart" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 21c-6-4-9-7.5-9-12a5 5 0 019-3 5 5 0 019 3c0 4.5-3 8-9 12z" fill={accent} />
          </svg>
        </span>
      </span>
    </div>
  )
}

// --- Brand logos for the support links (currentColor so they theme + invert) ---
export function BmcIcon() {
  // Simplified "Buy Me a Coffee" cup + steam.
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h13v4a5 5 0 01-5 5H9a5 5 0 01-5-5V9z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M17 10h1.8a2.7 2.7 0 010 5.4H16.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.5 21h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 3.2c-.6.9-.6 1.7 0 2.6M11.5 3.2c-.6.9-.6 1.7 0 2.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
export function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  )
}
export function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58C20.56 22.29 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z" />
    </svg>
  )
}

export function BackupMock() {
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('Backup')}>
      <Screen />
      {/* database cylinder */}
      <g transform="translate(112,44)">
        <ellipse cx="28" cy="12" rx="28" ry="10" fill={accent} opacity="0.2" stroke={accent} strokeWidth="2" />
        <path d="M0 12v40c0 5.5 12.5 10 28 10s28-4.5 28-10V12" fill="var(--surface)" stroke={accent} strokeWidth="2" />
        <ellipse cx="28" cy="32" rx="28" ry="10" fill="none" stroke={accent} strokeWidth="1.5" opacity="0.5" />
      </g>
      {/* down (export) arrow */}
      <g transform="translate(96,120)">
        <path d="M8 0v18M0 12l8 8 8-8" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* up (restore) arrow */}
      <g transform="translate(168,120)">
        <path d="M8 20V2M0 10l8-8 8 8" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      </g>
    </svg>
  )
}
