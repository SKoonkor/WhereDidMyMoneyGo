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
// Fixed income/expense hues that read on both themes (SVG can't use the amt-* rules).
const green = '#3fbb74'
const red = '#e0574b'

// A rounded "screen" backdrop shared by most scenes.
function Screen() {
  return <rect x="8" y="8" width="264" height="174" rx="14" fill={soft} stroke={line} />
}

export function IntroMock() {
  // Scattered "?"s of varying size around the ฿ mark — a nod to the app's name,
  // "Where Did My Money Go?".
  const marks = [
    { x: 96, y: 40, s: 22, o: 0.9, c: accent },
    { x: 186, y: 44, s: 13, o: 0.7, c: muted },
    { x: 196, y: 86, s: 18, o: 0.55, c: accent },
    { x: 88, y: 96, s: 11, o: 0.8, c: muted },
    { x: 140, y: 24, s: 12, o: 0.6, c: muted },
    { x: 74, y: 66, s: 15, o: 0.5, c: accent },
  ]
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('Welcome')}>
      <Screen />
      {marks.map((m, i) => (
        <text key={i} x={m.x} y={m.y} textAnchor="middle" fontSize={m.s} fontWeight="700" fill={m.c} opacity={m.o}>?</text>
      ))}
      <circle cx="140" cy="70" r="34" fill={accent} opacity="0.15" />
      <circle cx="140" cy="70" r="24" fill="none" stroke={accent} strokeWidth="3" />
      <text x="140" y="78" textAnchor="middle" fontSize="26" fontWeight="700" fill={accent}>฿</text>
      <rect x="70" y="120" width="140" height="12" rx="6" fill={ink} opacity="0.85" />
      <rect x="95" y="142" width="90" height="8" rx="4" fill={muted} />
    </svg>
  )
}

// A fake transactions screen: an Income / Expense / Net summary over a few sample
// rows, with the tab bar overlaid at the bottom so it teasingly clips the last
// row. All amounts and notes are invented — the layout without any real spending.
// Category (+ optional subcategory) on the left, note over account in the middle,
// amount on the right coloured by type (expense red, income green, transfer grey).
export function RecordMock() {
  const rows = [
    { cat: 'Food', sub: 'Groceries', note: 'Market', acct: 'Cash', amt: '240', c: red },
    { cat: 'Salary', sub: '', note: 'Payday', acct: 'Bank', amt: '11,500', c: green },
    { cat: 'Transport', sub: 'Taxi', note: 'Taxi', acct: 'Card', amt: '180', c: red },
    { cat: 'Transfer', sub: '', note: 'Credit Card Payment', acct: 'Bank → Card', amt: '2,000', c: muted },
  ]
  const tabs = [{ x: 32, g: '⌂' }, { x: 84, g: '☰' }, { x: 196, g: '▦' }, { x: 248, g: '⚙' }]
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('Record a transaction')}>
      <Screen />
      {/* summary card: Income / Expense / Net */}
      <rect x="16" y="14" width="248" height="40" rx="10" fill="var(--surface)" stroke={line} />
      {[
        { cx: 78, label: 'Income', val: '13,235', c: green },
        { cx: 140, label: 'Expense', val: '12,253', c: red },
        { cx: 202, label: 'Net', val: '982', c: ink },
      ].map((s) => (
        <g key={s.label}>
          <text x={s.cx} y="29" textAnchor="middle" fontSize="7" fill={muted}>{s.label}</text>
          <text x={s.cx} y="46" textAnchor="middle" fontSize="12" fontWeight="700" fill={s.c}>{s.val}</text>
        </g>
      ))}
      {/* transaction rows */}
      {rows.map((r, i) => {
        const y = 58 + i * 25
        return (
          <g key={i}>
            <text x="22" y={y + 10} fontSize="7.5" fill={ink} opacity="0.75">{r.cat}</text>
            {r.sub && <text x="22" y={y + 19} fontSize="6.5" fill={muted}>{r.sub}</text>}
            <text x="78" y={y + 9} fontSize="9" fontWeight="700" fill={ink}>{r.note}</text>
            <text x="78" y={y + 18} fontSize="6.5" fill={muted}>{r.acct}</text>
            <text x="256" y={y + 13} textAnchor="end" fontSize="10" fontWeight="700" fill={r.c}>{r.amt}</text>
            <line x1="16" y1={y + 23} x2="264" y2={y + 23} stroke={line} opacity="0.6" />
          </g>
        )
      })}
      {/* tab bar overlaid at the bottom — clips the transfer row a little */}
      <rect x="8" y="150" width="264" height="32" fill="var(--surface)" stroke={line} />
      {tabs.map((tb) => (
        <text key={tb.x} x={tb.x} y="172" textAnchor="middle" fontSize="13" fill={muted}>{tb.g}</text>
      ))}
      <circle cx="140" cy="163" r="14" fill={accent} />
      <path d="M140 156v14M133 163h14" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
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

// Six tiny "snapshots", one per Apps feature, drawn in local tile coordinates
// (0..64 × 0..50) so each can be dropped into a tile via a translate.
const APP_MINIS: React.ReactNode[] = [
  // 0 · Income & Expense — a two-tone donut
  <g key="donut">
    <circle cx="32" cy="24" r="11" fill="none" stroke={green} strokeWidth="6" pathLength={100} strokeDasharray="70 30" transform="rotate(-90 32 24)" />
    <circle cx="32" cy="24" r="11" fill="none" stroke={red} strokeWidth="6" pathLength={100} strokeDasharray="30 70" strokeDashoffset={-70} transform="rotate(-90 32 24)" />
  </g>,
  // 1 · Money Flow — a jagged line over a dashed zero baseline
  <g key="flow">
    <line x1="8" y1="30" x2="56" y2="30" stroke={muted} strokeWidth="1" strokeDasharray="3 3" />
    <polyline points="8,32 16,22 24,27 32,17 40,25 48,15 56,20" fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    <path d="M20 16l3-5 3 5z" fill={green} />
    <path d="M38 12l3-5 3 5z" fill={green} />
  </g>,
  // 2 · Budget — three progress bars
  <g key="budget">
    {[{ w: 44, c: red }, { w: 22, c: green }, { w: 42, c: green }].map((b, i) => (
      <g key={i} transform={`translate(10 ${12 + i * 11})`}>
        <rect x="0" y="0" width="44" height="5" rx="2.5" fill={line} />
        <rect x="0" y="0" width={b.w} height="5" rx="2.5" fill={b.c} />
      </g>
    ))}
  </g>,
  // 3 · Retirement — rising projection curves
  <g key="retire">
    <path d="M8 40 Q30 33 56 11" fill="none" stroke={green} strokeWidth="2" strokeLinecap="round" />
    <path d="M8 40 Q32 29 56 16" fill="none" stroke="#e86ea0" strokeWidth="2" strokeLinecap="round" />
    <path d="M8 41 Q30 38 56 31" fill="none" stroke="#5aa9e6" strokeWidth="1.6" strokeDasharray="3 3" strokeLinecap="round" />
  </g>,
  // 4 · Savings — a half-circle gauge
  <g key="gauge">
    <path d="M10 34 A22 22 0 0 1 54 34" fill="none" stroke={line} strokeWidth="5" strokeLinecap="round" />
    <path d="M10 34 A22 22 0 0 1 25.2 13.1" fill="none" stroke="#5aa9e6" strokeWidth="5" strokeLinecap="round" />
  </g>,
  // 5 · Income Tax — ascending bracket bars with a %
  <g key="tax">
    <rect x="16" y="30" width="8" height="10" rx="1.5" fill={muted} />
    <rect x="28" y="22" width="8" height="18" rx="1.5" fill={accent} opacity="0.65" />
    <rect x="40" y="14" width="8" height="26" rx="1.5" fill={accent} />
    <text x="52" y="16" textAnchor="middle" fontSize="9" fontWeight="700" fill={accent}>%</text>
  </g>,
]

// Short label under each tile. Feature names (kept as identifiers, not translated)
// sit at the bottom-right and overflow the panel by a character or two.
const APP_LABELS = ['Income/Expense', 'Money Flow', 'Budget', 'Retirement', 'Savings', 'Income Tax']
// Panel outline with the bottom-right corner left open, so the overflowing label
// appears to break out through the border rather than crossing over it.
const PANEL_BORDER = 'M10,0 H54 A10,10 0 0,1 64,10 V34 M40,50 H10 A10,10 0 0,1 0,40 V10 A10,10 0 0,1 10,0'

export function AppsMock() {
  return (
    <svg viewBox={VB} className="tour-svg" role="img" aria-label={t('The apps & tools')}>
      <Screen />
      {APP_MINIS.map((mini, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = 30 + col * 78
        const y = 30 + row * 62
        return (
          <g key={i} transform={`translate(${x} ${y})`}>
            <rect x="0" y="0" width="64" height="50" rx="10" fill="var(--surface)" />
            {mini}
            <path d={PANEL_BORDER} fill="none" stroke={line} />
            <text x="70" y="48" textAnchor="end" fontSize="6" fontWeight="600" fill={muted}>{APP_LABELS[i]}</text>
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
// than a bare graphic. When `showQr` is set the photo is swapped for the Thai QR /
// PromptPay payment code (toggled from the tour). Both assets live in public/ so
// they're referenced base-relative.
export function SupportMock({ showQr = false }: { showQr?: boolean }) {
  if (showQr) {
    return (
      <div className="tour-support-visual" role="img" aria-label={t('Thai QR / PromptPay payment code')}>
        <img className="tour-qr" src={`${import.meta.env.BASE_URL}qr-payment.jpg`} alt={t('Thai QR / PromptPay payment code')} />
      </div>
    )
  }
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

// A small QR-code glyph for the "Show QR Code" toggle.
export function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M3 3h7v7H3V3zm2 2v3h3V5H5zM3 14h7v7H3v-7zm2 2v3h3v-3H5zM14 3h7v7h-7V3zm2 2v3h3V5h-3z" />
      <path d="M14 14h3v3h-3v-3zm5 0h2v2h-2v-2zm-5 5h2v2h-2v-2zm3 0h4v2h-4v-2zm2-3h2v2h-2v-2z" />
    </svg>
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
