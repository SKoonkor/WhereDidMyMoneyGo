import { lazy, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { HashRouter, NavLink, Routes, Route, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { t } from './i18n'
import { useTheme, useCensor, useLang } from './prefs'
import { useAppName } from './features/transactions/useConfig'
import { addTxn, deleteTxn, getAccounts, getAi, getCategories, getNotifications } from './db'
import { scheduleReminders } from './lib/notify'
import { AiCapture } from './features/ai/AiCapture'
import type { ReceiptDraft } from './lib/ai'
import type { TxnPrefill } from './features/transactions/TxnForm'
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
import { LimitsPage } from './features/budget/LimitsPage'
import { useLimitAlert } from './features/budget/useLimitAlert'
import { GoalsPage } from './features/goals/GoalsPage'
import { GoalSavingsPage } from './features/goals/GoalSavingsPage'
import { DebtsPage } from './features/debts/DebtsPage'
import { CompoundPage } from './features/compound/CompoundPage'
import { RetirementPage } from './features/retirement/RetirementPage'
import { IncomeTaxPage } from './features/tax/IncomeTaxPage'
import { ReconcilePage } from './features/reconcile/ReconcilePage'
import { BottomNav } from './components/BottomNav'
import { Modal } from './components/Modal'
import { Toast } from './components/Toast'
import { CarryNote } from './components/CarryNote'
import { useCarry, dismissCarry, carryFiller } from './features/transactions/carryNote'
import { showToast, dismissToast, useToast } from './toast'
import {
  cancelExit, confirmExit, enterTrading, openSheet, requestLeave,
  usePendingExit, useTradingMode, TRADING_ENABLED,
} from './tradingMode'
import { OnboardingHost } from './features/onboarding/OnboardingHost'
import { TxnForm } from './features/transactions/TxnForm'
import './App.css'

// A gentle heads-up for the review form when a scan looks unreliable — a missing
// total, or a low self-reported confidence. Returns undefined when it read cleanly.
function scanNotice(draft: ReceiptDraft): string | undefined {
  if (draft.amount == null) return t("Couldn't read the total — please enter it below.")
  if (draft.confidence != null && draft.confidence < 0.5) {
    return t('This was a low-confidence read — please double-check the details.')
  }
  return undefined
}

// Code-split the importer: it pulls in SheetJS (~500 kB), which shouldn't sit in
// the initial bundle since import is an occasional action.
const ImportPage = lazy(() =>
  import('./features/import/ImportPage').then((m) => ({ default: m.ImportPage })),
)

// Same treatment for the paper-trading simulator: a chart engine, a market model,
// a broker and an options pricer are a lot of code for a screen most sessions
// never open, and none of it belongs in the initial bundle.
const TradingPage = lazy(() =>
  import('./features/trading/TradingPage').then((m) => ({ default: m.TradingPage })),
)
const TradingAccountsPage = lazy(() =>
  import('./features/trading/AccountsPage').then((m) => ({ default: m.AccountsPage })),
)
const TradingOptionsPage = lazy(() =>
  import('./features/trading/OptionsPage').then((m) => ({ default: m.OptionsPage })),
)

// Every trading route, wrapped: it turns the sticky paper-trading mode on and
// carries the shared Suspense fallback. Entering belongs here because the router
// is already the only place that knows which routes are trading routes — and one
// wrapper replaces three identical fallbacks. The mode is deliberately NOT turned
// off on unmount: it survives browsing away, and ends only through the header ✕
// or the prompt an Apps tile raises.
function TradingRoute({ children }: { children: ReactNode }) {
  useEffect(() => { enterTrading() }, [])
  return <Suspense fallback={<p className="muted">{t('Loading…')}</p>}>{children}</Suspense>
}

// Where the ＋ and the Chart-settings slot send you. Both open a sheet that
// TradingPage renders (App must not render them itself — that would pull
// useTrading()/acquireRuntime() into the eager chunk and defeat the lazy import
// above), so anywhere else, including the accounts and options routes, has to
// land on the chart first.
function goToChart() {
  const h = window.location.hash
  if (h !== '#/trading' && h !== '#/trading/') window.location.hash = '#/trading'
}

function Header() {
  const [theme, toggleTheme] = useTheme()
  const [censor, toggleCensor] = useCensor()
  const trading = useTradingMode()
  const appName = useAppName()
  // Keep the default name translatable (Thai title), but show a custom name
  // verbatim. Mirror the chosen name into the browser/tab title too.
  const brand = appName === DEFAULT_SETTINGS.appName ? t('Where Did My Money Go') : appName
  useEffect(() => { document.title = brand }, [brand])
  return (
    <header className="app-header">
      <NavLink to="/" className="brand">
        {brand}
        <span className="dot">?</span>
      </NavLink>
      <div className="header-tools">
        {/* Sliding pill + masked eye — ported from the Dash app; the visuals swap
            purely in CSS off html[data-theme] / html[data-censor]. */}
        <button
          className="theme-switch"
          onClick={toggleTheme}
          aria-label="Toggle light/dark mode"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span className="tt-knob" />
        </button>
        {/* While paper trading is on, the header's one spare control is the way
            out of the mode — the same slot, reusing .censor-toggle's zeroed
            chrome, so nothing about the header moves. Privacy is a ledger
            control and there is no ledger on screen to hide. */}
        {trading ? (
          <button
            className="censor-toggle"
            onClick={() => { requestLeave('/') }}
            aria-label={t('Quit paper trading')}
            title={t('Quit paper trading')}
          >
            <svg
              viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : (
          <button
            className="censor-toggle"
            onClick={toggleCensor}
            aria-label="Toggle privacy"
            title={censor ? 'Show amounts' : 'Hide amounts'}
          >
            <span className="ct-eye" />
          </button>
        )}
      </div>
    </header>
  )
}

export default function App() {
  // The ＋ in the bottom bar opens the Add-transaction sheet over any screen.
  const [adding, setAdding] = useState(false)
  // Seeds that sheet when it's opened by something other than the ＋ — currently
  // the carry note, which hands over the amount still to be recorded.
  const [addPrefill, setAddPrefill] = useState<TxnPrefill | undefined>()
  // Holding ＋ opens the AI receipt scanner when scanning is enabled and a key is
  // set; otherwise the hold nudges the user to turn it on (a plain tap always
  // opens the manual Add sheet either way).
  const [capturing, setCapturing] = useState(false)
  // A scanned receipt awaiting review opens a prefilled Add form (with an optional
  // note when the read was shaky).
  const [review, setReview] = useState<{ prefill: TxnPrefill; notice?: string } | null>(null)
  // The toast lives in src/toast.ts rather than here: the order ticket, a lazy
  // chunk and several routes away, raises one after closing its own sheet.
  const toast = useToast()
  const pendingExit = usePendingExit()
  const ai = useLiveQuery(() => getAi(), [])
  const aiReady = !!(ai?.enabled && ai.apiKey.trim())

  // Turn an extracted receipt draft into either a review form (default) or, when
  // the user has switched "Review before saving" off, a direct save with an Undo
  // toast. If key fields can't be resolved we always fall back to the form.
  async function handleExtracted(draft: ReceiptDraft) {
    setCapturing(false)
    const prefill: TxnPrefill = {
      kind: 'Expense',
      amount: draft.amount,
      date: draft.date,
      note: draft.merchant,
      category: draft.category,
    }
    const cfg = await getAi()
    if (cfg.confirmBeforeSave) { setReview({ prefill, notice: scanNotice(draft) }); return }

    // Review off → try to record it straight away.
    const [accounts, cats] = await Promise.all([getAccounts(), getCategories()])
    const account = accounts[0]
    const category = draft.category && cats.expense[draft.category] ? draft.category : undefined
    if (draft.amount && draft.amount > 0 && account && category) {
      const id = await addTxn({
        period: draft.date ?? new Date().toISOString().slice(0, 10),
        account, amount: draft.amount, type: 'Expense', category,
        note: draft.merchant, currency: draft.currency,
      })
      showToast(
        t('Recorded {amount} to {account} from receipt.', {
          amount: `${draft.amount} ${draft.currency ?? ''}`.trim(), account,
        }),
        { label: t('Undo'), onClick: () => { void deleteTxn(id) } },
      )
      return
    }
    // Couldn't fully resolve it — fall back to the form so the user finishes it.
    setReview({ prefill, notice: t("Couldn't read everything — please fill in the missing details.") })
  }
  // Subscribe to the language at the root so a change in Settings re-renders the
  // whole tree immediately (t() is read during render; pages aren't memoized).
  useLang()
  // Re-arm daily reminders on each app open: Notification Triggers fire once, so
  // we pre-arm the next few days here (and start the in-app fallback timer where
  // Triggers aren't supported). No-op when reminders are off / permission absent.
  useEffect(() => {
    void getNotifications().then((cfg) => scheduleReminders(cfg))
  }, [])
  // Fires whenever a saved transaction newly pushes a spending limit into its
  // warning band — from any of the save paths, since it watches the ledger.
  useLimitAlert((message) => showToast(
    message,
    { label: t('View'), onClick: () => { window.location.hash = '#/limits' } },
  ))
  // What's left to record after the last save, floated over everything (see
  // CarryNote). Mirrored onto <html data-carry> — the same scheme as data-theme /
  // data-censor — so App.css can make room for it at the top of an open modal
  // without React having to reach into the sheet.
  const carry = useCarry()
  const carryShown = !!carry && !carry.hidden
  useEffect(() => {
    const html = document.documentElement
    if (carryShown) html.setAttribute('data-carry', 'on')
    else html.removeAttribute('data-carry')
  }, [carryShown])
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
            <Route path="/limits" element={<LimitsPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/goal-savings" element={<GoalSavingsPage />} />
            <Route path="/debts" element={<DebtsPage />} />
            <Route path="/retirement" element={<RetirementPage />} />
            <Route path="/compound" element={<CompoundPage />} />
            <Route path="/income-tax" element={<IncomeTaxPage />} />
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
            {/* Paper trading is parked (TRADING_ENABLED). The redirect matters:
                this router has no catch-all, so an old bookmark on #/trading
                would otherwise render an empty page rather than going home. */}
            {TRADING_ENABLED ? (
              <>
                <Route path="/trading" element={<TradingRoute><TradingPage /></TradingRoute>} />
                <Route
                  path="/trading/accounts"
                  element={<TradingRoute><TradingAccountsPage /></TradingRoute>}
                />
                <Route
                  path="/trading/options"
                  element={<TradingRoute><TradingOptionsPage /></TradingRoute>}
                />
              </>
            ) : (
              <Route path="/trading/*" element={<Navigate to="/" replace />} />
            )}
          </Routes>
        </main>
        <BottomNav
          onAdd={() => setAdding(true)}
          onLongPress={() => {
            if (aiReady) setCapturing(true)
            else showToast(t('Turn on AI receipt scanning in Settings to snap receipts.'), { label: t('Settings'), onClick: () => { window.location.hash = '#/settings' } })
          }}
          onCentre={() => { openSheet('ticket'); goToChart() }}
          onChartSettings={() => { openSheet('settings'); goToChart() }}
        />
        {adding && (
          <Modal title={t('Add transaction')} onClose={() => { setAdding(false); setAddPrefill(undefined) }}>
            <TxnForm prefill={addPrefill} onClose={() => { setAdding(false); setAddPrefill(undefined) }} />
          </Modal>
        )}
        {capturing && (
          <AiCapture
            onClose={() => setCapturing(false)}
            onExtracted={(draft) => { void handleExtracted(draft) }}
          />
        )}
        {review && (
          <Modal title={t('Review receipt')} onClose={() => setReview(null)}>
            <TxnForm prefill={review.prefill} notice={review.notice} onClose={() => setReview(null)} />
          </Modal>
        )}
        {toast && (
          <Toast
            message={toast.message}
            action={toast.action}
            onClose={dismissToast}
          />
        )}
        {/* Leaving paper trading for another app, asked once and rendered once —
            AppsPage only calls a predicate, and the header ✕ routes through the
            same pending exit. Navigating by hash, not useNavigate: this body is
            outside the HashRouter it renders. */}
        {pendingExit !== null && (
          <Modal title={t('Quit paper trading?')} onClose={cancelExit}>
            <p className="muted" style={{ margin: '0 0 14px' }}>
              {t('Your simulated accounts, positions and history are kept — you can come back to them any time.')}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={cancelExit}>{t('Cancel')}</button>
              <button
                type="button"
                className="btn"
                onClick={() => { window.location.hash = '#' + confirmExit() }}
              >
                {t('Quit')}
              </button>
            </div>
          </Modal>
        )}
        {carryShown && carry && (
          <CarryNote
            amount={carry.amount}
            // A form already open takes the tap itself (it fills its own Amount
            // field); otherwise this opens Add with the amount waiting.
            onUse={() => {
              const fill = carryFiller()
              if (fill) fill(carry.amount)
              else { setAddPrefill({ amount: carry.amount }); setAdding(true) }
            }}
            onClose={dismissCarry}
          />
        )}
        <OnboardingHost />
      </div>
    </HashRouter>
  )
}
