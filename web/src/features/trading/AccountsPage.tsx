import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../components/Modal'
import { NumberField } from '../../components/NumberField'
import { parseAmountExpr } from '../transactions/amountExpr'
import { t } from '../../i18n'
import { stats } from '../../lib/trading/broker/analytics'
import { tradeErrorMessage } from './errors'
import { money, pct, signedMoney } from './fmt'
import { useTrading } from './useTrading'
import { DisclaimerGate } from './DisclaimerGate'
import { SimBadge } from './SimBadge'
import { EquityCurve } from './EquityCurve'
import { Blotter } from './Blotter'
import { START_CASH } from './runtime'
import './trading.css'

// Accounts, performance, and the reset.
//
// The reset is the sandbox guarantee made reachable. `resetSandbox()` is tested to
// leave `transactions` and `goalMoves` byte-identical — that test IS the promise —
// and a promise the user cannot exercise is not one they can check. So it is here,
// plainly labelled, behind one confirm, and the confirm says exactly what survives.

export function AccountsPage() {
  const view = useTrading()
  const [adding, setAdding] = useState(false)
  const [cashOp, setCashOp] = useState<'deposit' | 'withdraw' | null>(null)
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  const [start, setStart] = useState(String(START_CASH))
  const [confirmReset, setConfirmReset] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!view) return <p className="muted">{t('Loading…')}</p>
  // Deep-linkable, so it carries the same gate as the chart. A user who arrives
  // here from a bookmark must meet the "none of this is real" screen too.
  if (!view.cfg.disclaimerAcceptedAt) return <DisclaimerGate runtime={view.runtime} />

  const { runtime, account, accounts, summary, currency, trades } = view
  const perf = stats([...trades])

  // A `calc` field yields an expression; the app's own parser is what turns
  // "50000 + 10000" into a deposit rather than into NaN.
  const num = (s: string) => {
    const e = parseAmountExpr(s)
    return e.valid ? e.net : NaN
  }

  const doCash = () => {
    const v = num(amount)
    const res = cashOp === 'deposit' ? runtime.deposit(v) : runtime.withdraw(v)
    if (!res.ok) { setError(tradeErrorMessage(res.error)); return }
    setError(null)
    setAmount('')
    setCashOp(null)
  }

  return (
    <div className="tr-page">
      <h1 className="h1 tr-h1">
        {t('Paper accounts')}
        <SimBadge />
      </h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 12 }}>
        {t('Simulated money only. Nothing here touches what you track.')}
      </p>

      <section className="card">
        <div className="tr-acct-head">
          <div>
            <div className="dash-title">{account.name}</div>
            <div className="tr-acct-equity money">{money(summary.equity)} {currency}</div>
          </div>
          <div className={`tr-acct-pnl ${summary.totalChange >= 0 ? 'is-up' : 'is-down'}`}>
            <span className="money">{signedMoney(summary.totalChange)}</span>
            <span className="tr-acct-pnl-pct">{pct(summary.totalPct)}</span>
          </div>
        </div>

        <EquityCurve
          curve={runtime.equity}
          trades={trades}
          startCash={account.startCash}
          currency={currency}
        />

        <div className="tr-stat-grid">
          <Stat label={t('Cash')} value={`${money(summary.cash)}`} />
          <Stat label={t('Invested')} value={`${money(summary.invested)}`} />
          <Stat label={t('Realised')} value={signedMoney(summary.realized)} tone={summary.realized >= 0 ? 'up' : 'down'} />
          <Stat label={t('Unrealised')} value={signedMoney(summary.unrealized)} tone={summary.unrealized >= 0 ? 'up' : 'down'} />
          <Stat label={t('Contributed')} value={money(account.contributed)} />
          <Stat
            label={t('Margin level')}
            value={Number.isFinite(summary.margin.marginLevel) ? `${summary.margin.marginLevel.toFixed(0)}%` : '—'}
          />
          <Stat label={t('Win rate')} value={perf.wins + perf.losses > 0 ? `${perf.winRate.toFixed(0)}%` : '—'} />
          <Stat label={t('Closed trades')} value={String(perf.wins + perf.losses)} />
        </div>

        <div className="tr-acct-actions">
          <button type="button" className="btn sm" onClick={() => { setCashOp('deposit'); setError(null) }}>
            {t('Deposit')}
          </button>
          <button type="button" className="btn sm ghost" onClick={() => { setCashOp('withdraw'); setError(null) }}>
            {t('Withdraw')}
          </button>
        </div>

        {/* §E's empty state: one sentence and one action, never "No data". */}
        {summary.equity <= 0 && (
          <p className="muted tr-empty">
            {t('Your simulator starts with {amount}. Fund it to place your first trade.', { amount: `0 ${currency}` })}
          </p>
        )}
      </section>

      <section className="card">
        <div className="dash-title">{t('All accounts')}</div>
        <div className="tr-rows">
          {accounts.map((a) => (
            <div className={`tr-row tr-acct-row${a.id === account.id ? ' is-on' : ''}`} key={a.id}>
              <button type="button" className="tr-acct-pick" onClick={() => void runtime.selectAccount(a.id)}>
                <span className="tr-row-sym">{a.name}</span>
                <span className="tr-row-meta">
                  {t('opened with {amount} {currency}', { amount: money(a.startCash), currency: a.currency })}
                </span>
              </button>
              {accounts.length > 1 && (
                <button
                  type="button"
                  className="btn sm ghost tr-close-btn"
                  onClick={() => void runtime.dropAccount(a.id)}
                >
                  {t('Delete')}
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="btn goal-add-btn" onClick={() => setAdding(true)}>
          ＋ {t('New paper account')}
        </button>
      </section>

      <Blotter view={view} limit={60} />

      <section className="card tr-danger">
        <div className="dash-title">{t('Reset the sandbox')}</div>
        <p className="muted tr-danger-note">
          {t('Erases every paper account, position and price this simulator has generated, and starts a fresh market. Your transactions, budgets, goals and debts are untouched.')}
        </p>
        <button type="button" className="btn solid-danger" onClick={() => setConfirmReset(true)}>
          {t('Reset the sandbox')}
        </button>
      </section>

      <p className="tr-back">
        <Link to="/trading" className="inline-link">{t('Back to the chart')}</Link>
      </p>

      {cashOp && (
        <Modal
          title={cashOp === 'deposit' ? t('Deposit paper money') : t('Withdraw paper money')}
          onClose={() => { setCashOp(null); setError(null) }}
        >
          <div className="tr-field">
            <label className="tr-label" htmlFor="tr-cash">{t('Amount ({currency})', { currency })}</label>
            <NumberField
              id="tr-cash" mode="calc" allowDecimal className="tr-input"
              label={t('Amount')} value={amount} onChange={setAmount} placeholder="0"
            />
          </div>
          {error && <p className="tr-flash is-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => { setCashOp(null); setError(null) }}>{t('Cancel')}</button>
            <button type="button" className="btn" onClick={doCash}>
              {cashOp === 'deposit' ? t('Deposit') : t('Withdraw')}
            </button>
          </div>
        </Modal>
      )}

      {adding && (
        <Modal title={t('New paper account')} onClose={() => setAdding(false)}>
          <div className="tr-field">
            <label className="tr-label" htmlFor="tr-name">{t('Name')}</label>
            <input
              id="tr-name"
              className="tr-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Paper account')}
            />
          </div>
          <div className="tr-field">
            <label className="tr-label" htmlFor="tr-start">{t('Starting cash ({currency})', { currency })}</label>
            <NumberField
              id="tr-start" mode="calc" allowDecimal className="tr-input"
              label={t('Starting cash')} value={start} onChange={setStart}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>{t('Cancel')}</button>
            <button
              type="button"
              className="btn"
              onClick={() => { void runtime.newAccount(name, num(start)); setAdding(false); setName('') }}
            >
              {t('Create')}
            </button>
          </div>
        </Modal>
      )}

      {confirmReset && (
        <Modal title={t('Reset the sandbox?')} onClose={() => setConfirmReset(false)}>
          <p className="muted" style={{ margin: '0 0 14px' }}>
            {t('Every paper account, trade and simulated price is deleted and a new market begins. This cannot be undone. Your real transactions, budgets, goals and debts are not part of the sandbox and are not affected.')}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirmReset(false)}>{t('Cancel')}</button>
            <button
              type="button"
              className="btn solid-danger"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void runtime.reset().finally(() => { setBusy(false); setConfirmReset(false) })
              }}
            >
              {busy ? t('Resetting…') : t('Erase and start over')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="tr-stat">
      <span className="tr-label">{label}</span>
      <span className={`tr-num money${tone ? ` is-${tone}` : ''}`}>{value}</span>
    </div>
  )
}
