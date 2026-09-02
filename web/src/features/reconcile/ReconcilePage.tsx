import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { applyReconciliation, getReconcileState, saveReconcileState } from '../../db'
import { Modal } from '../../components/Modal'
import { useLiveTxns } from '../useLiveTxns'
import { useAccounts, useBaseCurrency } from '../transactions/useConfig'
import { useCensor } from '../../prefs'
import { trackedBalances, hiddenCostTotal, reconcileReminderDue, todayISO } from '../../lib/analytics/reconcile'
import { parseAmountExpr } from '../transactions/amountExpr'
import { NumberField } from '../../components/NumberField'
import { OnOff } from '../../components/OnOff'
import { t } from '../../i18n'

const EPS = 0.005 // ignore sub-cent discrepancies
const money2 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed2 = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + money2(Math.abs(n))
const toneClass = (n: number) => (n > 0 ? 'amt-income' : n < 0 ? 'amt-expense' : '')

// An entry still being typed: the pad writes operators spaced (' + ', ' - '), and
// parseAmountExpr deliberately reports a trailing one as VALID, keeping the terms
// so far so the running preview doesn't flicker. That is right for a preview and
// wrong for a balance — "500 - " would read as a firm 500.
const MID_TYPING = /[+\-×÷*/]$/

export function ReconcilePage() {
  const all = useLiveTxns()
  const accounts = useAccounts()
  const currency = useBaseCurrency()
  const [censor] = useCensor()
  const reconState = useLiveQuery(() => getReconcileState(), [])

  const tracked = useMemo(() => trackedBalances(all, accounts), [all, accounts])
  // Only accounts the user types a new balance into are reconciled; blank = leave
  // as-is. (No prefill — that's what made an accidental Apply so easy to trigger.)
  const [adjust, setAdjust] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [okConfirmOpen, setOkConfirmOpen] = useState(false)

  const order = Object.keys(tracked)
  // Per row: whether a balance was entered, and its rounded delta (new − tracked).
  // The entry is read as an expression, because the balance you are reconciling to
  // is often something you have to add up — the notes in a wallet, two envelopes,
  // a bank balance less a pending charge. (0.7.0 sanitised the text down to a
  // single signed decimal; the on-screen pad constrains the input now, and
  // stripping the operators here would turn "500 + 200" into 500200.)
  //
  // Three outcomes, not two. A blank row is "leave this account alone"; a row
  // that doesn't parse yet is "the user isn't finished" — and those must not be
  // conflated, because telling someone their balances match on the strength of a
  // half-typed sum, and clearing the form as we say it, is worse than any clip.
  const rows = order.map((a) => {
    const text = (adjust[a] ?? '').trim()
    if (text === '') return { entered: false, unfinished: false, delta: 0, next: tracked[a] }
    const expr = parseAmountExpr(text)
    const num = expr.net
    if (!expr.valid || !Number.isFinite(num) || MID_TYPING.test(text)) {
      return { entered: false, unfinished: true, delta: 0, next: tracked[a] }
    }
    return { entered: true, unfinished: false, delta: Math.round((num - tracked[a]) * 100) / 100, next: num }
  })
  const totalDiff = rows.reduce((s, r) => s + (r.entered ? r.delta : 0), 0)

  // The accounts that will actually change (entered + a ≥ half-cent discrepancy).
  const pending = order
    .map((a, i) => ({ account: a, tracked: tracked[a], ...rows[i] }))
    .filter((p) => p.entered && Math.abs(p.delta) >= EPS)

  const hidden = useMemo(() => hiddenCostTotal(all), [all])
  const lastReconciled = reconState?.lastReconciled ?? null
  const due = reconcileReminderDue(lastReconciled, all.length > 0)
  // Default to on while the record is still loading, and don't let a tap land
  // until it has — an early write would merge against a record we haven't read.
  const remindersOn = reconState?.remindersOn ?? true
  // A balance was typed for at least one account, whether or not it differs.
  const enteredAny = rows.some((r) => r.entered)
  const unfinished = rows.some((r) => r.unfinished)

  async function requestApply() {
    setMsg('')
    // Refuse the whole form rather than quietly dropping the rows that don't
    // parse: silently ignoring one box and acting on the others is how a typo
    // becomes an unnoticed adjustment.
    if (unfinished) { setMsg(t('Finish or clear the highlighted balances first.')); return }
    if (pending.length > 0) { setConfirmOpen(true); return }
    // Every balance the user typed already matches. That IS a reconciliation, with
    // nothing to record — so stamp the date and let the reminder clear. Refusing
    // outright (what this did before) left the nudge up after the user had just
    // checked every account, which is the one thing it must not do.
    if (enteredAny) {
      await saveReconcileState({ lastReconciled: todayISO() })
      setAdjust({})
      setMsg(t('Balances match — marked as reconciled today.'))
      return
    }
    setMsg(t('No discrepancies — nothing to record.'))
  }

  async function confirmApply() {
    const n = await applyReconciliation(pending.map((p) => ({ account: p.account, delta: p.delta })))
    setConfirmOpen(false)
    setAdjust({}) // clear inputs so the same values can't be re-applied by accident
    setMsg(n === 0 ? t('No discrepancies — nothing to record.') : t('Recorded {n} balance adjustment(s).', { n }))
  }

  // "Everything already matches": stamp today's date so the home reminder clears,
  // without recording any adjustment. Confirmed first (it's an assertion of truth).
  async function confirmAllCorrect() {
    await saveReconcileState({ lastReconciled: todayISO() })
    setOkConfirmOpen(false)
    setMsg(t('Marked as reconciled today.'))
  }

  return (
    <div>
      <h1 className="h1">{t('Reconcile')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 12 }}>
        {t("Register each account's real balance. The gap is recorded as a hidden cost (untracked amount).")}
      </p>

      <section className="card">
        <div className="recon-remind-row">
          <span className="recon-remind-label">{t('Reconcile reminder')}</span>
          <OnOff
            value={remindersOn}
            disabled={reconState === undefined}
            onChange={(v) => { void saveReconcileState({ remindersOn: v }) }}
          />
        </div>
        <span className="set-hint">
          {remindersOn
            ? t('Remind me on the 1st of each month, or after 30 days without reconciling.')
            : t('The home screen will not show a reconcile reminder.')}
        </span>
      </section>

      <section className="card">
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          {t('Enter balances as the app shows them — liabilities like Credit Card are negative. Only accounts you type a new balance into are reconciled.')}
        </p>

        <div className="recon-head">
          <span className="recon-acct">{t('Account')}</span>
          <span className="recon-num">{t('Tracked')}</span>
          <span className="recon-num">{t('Adjust')}</span>
        </div>

        {order.map((a, i) => (
          <div key={a} className="recon-row">
            <span className="recon-acct">{a}</span>
            <span className="recon-num muted"><span className="money">{money2(tracked[a])}</span></span>
            <span className="recon-num recon-adjust">
              <NumberField
                className="recon-input"
                mode="calc"
                label={`${a} — ${t('Adjust')}`}
                aria-label={`${a} — ${t('Adjust')}`}
                aria-invalid={rows[i].unfinished}
                placeholder=""
                value={adjust[a] ?? ''}
                onChange={(v) => setAdjust((p) => ({ ...p, [a]: v }))}
              />
            </span>
          </div>
        ))}

        <div className="recon-actions">
          <button type="button" className="btn" onClick={() => { void requestApply() }}>{t('Apply reconciliation')}</button>
          {msg && <span className="muted" style={{ alignSelf: 'center', fontSize: 14 }}>{msg}</span>}
        </div>
      </section>

      {confirmOpen && (
        <Modal title={t('Confirm reconciliation')} onClose={() => setConfirmOpen(false)}>
          <p className="muted" style={{ fontSize: 13, margin: '2px 0 12px' }}>
            {t('These balance adjustments will be recorded, dated today:')}
          </p>
          <div className="recon-confirm-list">
            {pending.map((p) => (
              <div key={p.account} className="recon-confirm-row">
                <span className="recon-confirm-acct">{p.account}</span>
                <span className="recon-confirm-change">
                  <span className="money muted">{money2(p.tracked)}</span>
                  <span className="recon-confirm-arrow">→</span>
                  <span className="money">{money2(p.next)}</span>
                  <span className={`recon-confirm-delta ${toneClass(p.delta)}`}>
                    <span className="money">{signed2(p.delta)}</span>
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="recon-confirm-total">
            <span>{t('Total discrepancy to record')}</span>
            <span className={toneClass(totalDiff)}><span className="money">{signed2(totalDiff)}</span> {censor ? '' : currency}</span>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirmOpen(false)}>{t('Cancel')}</button>
            <button type="button" className="btn" onClick={confirmApply}>{t('Confirm')}</button>
          </div>
        </Modal>
      )}

      <section className="card">
        <div className="recon-summary-row">
          <span className="muted">{t('Recorded hidden cost (untracked)')}</span>
          <span className={toneClass(hidden)} style={{ fontWeight: 600 }}>
            <span className="money">{signed2(hidden)}</span> {censor ? '' : currency}
          </span>
        </div>
        <div className="recon-summary-row" style={{ borderBottom: 'none' }}>
          <span className="muted">{t('Last reconciled')}</span>
          <span style={{ fontWeight: 600 }}>
            {lastReconciled ? lastReconciled : t('never')}
            {due && <span className="recon-due"> · {t('due')}</span>}
          </span>
        </div>
      </section>

      {/* Nothing to change? Confirm balances are already correct — this clears the
          home-screen reminder and stamps today as the last reconciled date. */}
      <button type="button" className="btn recon-allok-btn" onClick={() => setOkConfirmOpen(true)}>
        {t('Balances already correct')}
      </button>

      {okConfirmOpen && (
        <Modal title={t('Balances already correct?')} onClose={() => setOkConfirmOpen(false)}>
          <p className="muted" style={{ fontSize: 14, margin: '2px 0 16px', lineHeight: 1.45 }}>
            {t('This confirms all your account balances already match reality. Today will be saved as your last reconciled date, and the home reminder will clear. Nothing is recorded.')}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setOkConfirmOpen(false)}>{t('Cancel')}</button>
            <button type="button" className="btn btn-accent" onClick={confirmAllCorrect}>{t('Yes, all correct')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
