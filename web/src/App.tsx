import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, NavLink, Routes, Route } from 'react-router-dom'
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
import { OnboardingHost } from './features/onboarding/OnboardingHost'
import { TxnForm } from './features/transactions/TxnForm'
import './App.css'

// A transient bottom toast: a message plus an optional trailing action.
interface ToastState {
  message: string
  action?: { label: string; onClick: () => void }
}

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
        <button
          className="censor-toggle"
          onClick={toggleCensor}
          aria-label="Toggle privacy"
          title={censor ? 'Show amounts' : 'Hide amounts'}
        >
          <span className="ct-eye" />
        </button>
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
  const [toast, setToast] = useState<ToastState | null>(null)
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
      setToast({
        message: t('Recorded {amount} to {account} from receipt.', {
          amount: `${draft.amount} ${draft.currency ?? ''}`.trim(), account,
        }),
        action: { label: t('Undo'), onClick: () => { void deleteTxn(id) } },
      })
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
  useLimitAlert((message) => setToast({
    message,
    action: { label: t('View'), onClick: () => { window.location.hash = '#/limits' } },
  }))
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
            <Route
              path="/trading"
              element={
                <Suspense fallback={<p className="muted">{t('Loading…')}</p>}>
                  <TradingPage />
                </Suspense>
              }
            />
            <Route
              path="/trading/accounts"
              element={
                <Suspense fallback={<p className="muted">{t('Loading…')}</p>}>
                  <TradingAccountsPage />
                </Suspense>
              }
            />
            <Route
              path="/trading/options"
              element={
                <Suspense fallback={<p className="muted">{t('Loading…')}</p>}>
                  <TradingOptionsPage />
                </Suspense>
              }
            />
          </Routes>
        </main>
        <BottomNav
          onAdd={() => setAdding(true)}
          onLongPress={() => {
            if (aiReady) setCapturing(true)
            else setToast({ message: t('Turn on AI receipt scanning in Settings to snap receipts.'), action: { label: t('Settings'), onClick: () => { window.location.hash = '#/settings' } } })
          }}
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
            onClose={() => setToast(null)}
          />
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
