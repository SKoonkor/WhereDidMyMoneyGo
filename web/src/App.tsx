import { lazy, Suspense } from 'react'
import { HashRouter, NavLink, Routes, Route } from 'react-router-dom'
import { t } from './i18n'
import { useTheme, useCensor, useLang } from './prefs'
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
  return (
    <header className="app-header">
      <NavLink to="/" className="brand">
        {t('Where Did My Money Go')}
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
