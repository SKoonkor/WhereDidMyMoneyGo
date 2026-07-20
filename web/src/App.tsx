import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, NavLink, Routes, Route } from 'react-router-dom'
import { t } from './i18n'
import { useTheme, useCensor, useLang } from './prefs'
import { useAppName } from './features/transactions/useConfig'
import { DEFAULT_SETTINGS } from './data/defaults'
import { Home } from './features/Home'
import { TransactionsPage } from './features/transactions/TransactionsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { ManagePage } from './features/manage/ManagePage'
import { BackupPage } from './features/backup/BackupPage'
import { Placeholder } from './features/Placeholder'
import './App.css'

// Code-split the importer: it pulls in SheetJS (~500 kB), which shouldn't sit in
// the initial bundle since import is an occasional action.
const ImportPage = lazy(() =>
  import('./features/import/ImportPage').then((m) => ({ default: m.ImportPage })),
)

function Header() {
  const [theme, toggleTheme] = useTheme()
  const [censor, toggleCensor] = useCensor()
  const [lang, toggleLang] = useLang()
  const appName = useAppName()
  // Keep the default name translatable (Thai title), but show a custom name
  // verbatim. Mirror the chosen name into the browser/tab title too.
  const brand = appName === DEFAULT_SETTINGS.appName ? t('Where Did My Money Go') : appName
  useEffect(() => { document.title = brand }, [brand])
  return (
    <header className="app-header">
      <NavLink to="/" className="brand">
        {brand}
        <span className="dot">.</span>
      </NavLink>
      <div className="header-tools">
        <button className="tool-btn" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? '☀︎' : '☾'}
        </button>
        <button className="tool-btn" onClick={toggleCensor} aria-label="Toggle privacy">
          {censor ? '🙈' : '👁'}
        </button>
        <button className="tool-btn" onClick={toggleLang} aria-label="Toggle language">
          {lang === 'en' ? 'TH' : 'EN'}
        </button>
      </div>
    </header>
  )
}

const NAV: [string, string][] = [
  ['/', 'Home'],
  ['/transactions', 'Transactions'],
  ['/budget', 'Budget'],
  ['/goals', 'Goals'],
  ['/settings', 'Settings'],
]

function Nav() {
  return (
    <nav className="app-nav">
      {NAV.map(([to, label]) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => (isActive ? 'active' : '')}
        >
          {t(label)}
        </NavLink>
      ))}
    </nav>
  )
}

export default function App() {
  return (
    <HashRouter>
      <div className="app">
        <Header />
        <Nav />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/budget" element={<Placeholder title="Budget" />} />
            <Route path="/goals" element={<Placeholder title="Goals" />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/manage" element={<ManagePage />} />
            <Route path="/backup" element={<BackupPage />} />
            <Route
              path="/import"
              element={
                <Suspense fallback={<p className="muted">{t('Loading…')}</p>}>
                  <ImportPage />
                </Suspense>
              }
            />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}
