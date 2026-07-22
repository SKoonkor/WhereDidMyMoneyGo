import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { applyReconciliation, getReconcileState } from '../../db'
import { Modal } from '../../components/Modal'
import { useLiveTxns } from '../useLiveTxns'
import { useAccounts, useBaseCurrency } from '../transactions/useConfig'
import { useCensor } from '../../prefs'
import { trackedBalances, hiddenCostTotal, isReminderDue } from '../../lib/analytics/reconcile'
import { t } from '../../i18n'

const EPS = 0.005 // ignore sub-cent discrepancies
const money2 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed2 = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + money2(Math.abs(n))
const toneClass = (n: number) => (n > 0 ? 'amt-income' : n < 0 ? 'amt-expense' : '')

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

  const order = Object.keys(tracked)
  // Per row: whether a balance was entered, and its rounded delta (new − tracked).
  const rows = order.map((a) => {
    const raw = adjust[a]
    if (raw == null || raw.trim() === '') return { entered: false, delta: 0, next: tracked[a] }
    const num = Number(raw)
    if (!Number.isFinite(num)) return { entered: false, delta: 0, next: tracked[a] }
    return { entered: true, delta: Math.round((num - tracked[a]) * 100) / 100, next: num }
  })
  const totalDiff = rows.reduce((s, r) => s + (r.entered ? r.delta : 0), 0)

  // The accounts that will actually change (entered + a ≥ half-cent discrepancy).
  const pending = order
    .map((a, i) => ({ account: a, tracked: tracked[a], ...rows[i] }))
    .filter((p) => p.entered && Math.abs(p.delta) >= EPS)

  const hidden = useMemo(() => hiddenCostTotal(all), [all])
  const lastReconciled = reconState?.lastReconciled ?? null
  const due = isReminderDue(lastReconciled)

  function requestApply() {
    setMsg('')
    if (pending.length === 0) { setMsg(t('No discrepancies — nothing to record.')); return }
    setConfirmOpen(true)
  }

  async function confirmApply() {
    const n = await applyReconciliation(pending.map((p) => ({ account: p.account, delta: p.delta })))
    setConfirmOpen(false)
    setAdjust({}) // clear inputs so the same values can't be re-applied by accident
    setMsg(n === 0 ? t('No discrepancies — nothing to record.') : t('Recorded {n} balance adjustment(s).', { n }))
  }

  return (
    <div>
      <h1 className="h1">{t('Reconcile')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 12 }}>
        {t("Register each account's real balance. The gap is recorded as a hidden cost (untracked amount).")}
      </p>

      <section className="card">
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          {t('Enter balances as the app shows them — liabilities like Credit Card are negative. Only accounts you type a new balance into are reconciled.')}
        </p>

        <div className="recon-head">
          <span className="recon-acct">{t('Account')}</span>
          <span className="recon-num">{t('Tracked')}</span>
          <span className="recon-num">{t('Adjust')}</span>
        </div>

        {order.map((a) => (
          <div key={a} className="recon-row">
            <span className="recon-acct">{a}</span>
            <span className="recon-num muted"><span className="money">{money2(tracked[a])}</span></span>
            <span className="recon-num">
              <input
                className="recon-input"
                type="number"
                inputMode="decimal"
                placeholder={money2(tracked[a])}
                value={adjust[a] ?? ''}
                onChange={(e) => setAdjust((p) => ({ ...p, [a]: e.target.value }))}
              />
            </span>
          </div>
        ))}

        <div className="recon-actions">
          <button type="button" className="btn" onClick={requestApply}>{t('Apply reconciliation')}</button>
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
    </div>
  )
}
