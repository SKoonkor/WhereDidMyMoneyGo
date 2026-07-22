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

export function SupportMock() {
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('Support the developer')}>
      <Screen />
      <circle cx="140" cy="80" r="40" fill={accent} opacity="0.12" />
      {/* heart */}
      <path
        d="M140 100c-18-11-30-22-30-35a15 15 0 0130-6 15 15 0 0130 6c0 13-12 24-30 35z"
        fill={accent}
      />
      <rect x="70" y="140" width="140" height="10" rx="5" fill={ink} opacity="0.55" />
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
