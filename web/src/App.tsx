import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, NavLink, Routes, Route } from 'react-router-dom'
import { t } from './i18n'
import { useTheme, useCensor, useLang } from './prefs'
import { useAppName } from './features/transactions/useConfig'
import { DEFAULT_SETTINGS } from './data/defaults'
import { HomePage } from './features/home/HomePage'
import { TransactionsPage } from './features/transactions/TransactionsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { ManagePage } from './features/manage/ManagePage'
import { BackupPage } from './features/backup/BackupPage'
import { AppsPage } from './features/apps/AppsPage'
import { CompositionPage } from './features/composition/CompositionPage'
import { FlowPage } from './features/flow/FlowPage'
// (Placeholder retired — every Apps tile now routes to a real page.)
import { BudgetPage } from './features/budget/BudgetPage'
import { GoalsPage } from './features/goals/GoalsPage'
import { ReconcilePage } from './features/reconcile/ReconcilePage'
import { BottomNav } from './components/BottomNav'
import { Modal } from './components/Modal'
import { TxnForm } from './features/transactions/TxnForm'
import './App.css'

// Code-split the importer: it pulls in SheetJS (~500 kB), which shouldn't sit in
// the initial bundle since import is an occasional action.
const ImportPage = lazy(() =>
  import('./features/import/ImportPage').then((m) => ({ default: m.ImportPage })),
)

function Header() {
  const [theme, toggleTheme] = useTheme()
  const [censor, toggleCensor] = useCensor()
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
      </div>
    </header>
  )
}

export default function App() {
  // The ＋ in the bottom bar opens the Add-transaction sheet over any screen.
  const [adding, setAdding] = useState(false)
  // Subscribe to the language at the root so a change in Settings re-renders the
  // whole tree immediately (t() is read during render; pages aren't memoized).
  useLang()
  return (
    <HashRouter>
      <div className="app">
        <Header />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/composition" element={<CompositionPage />} />
            <Route path="/flow" element={<FlowPage />} />
            <Route path="/budget" element={<BudgetPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/reconcile" element={<ReconcilePage />} />
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
        <BottomNav onAdd={() => setAdding(true)} />
        {adding && (
          <Modal title={t('Add transaction')} onClose={() => setAdding(false)}>
            <TxnForm onClose={() => setAdding(false)} />
          </Modal>
        )}
      </div>
    </HashRouter>
  )
}
