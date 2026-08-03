import { useMemo, useState } from 'react'
import { useCensor } from '../../prefs'
import { useLiveTxns } from '../useLiveTxns'
import { debtEvents } from '../../lib/analytics/debt'
import type { DebtsView } from './useDebts'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const SHOWN = 8

// What has actually been paid, per debt, and how much of it was interest.
//
// For a LINKED debt the interest column stays empty on purpose: its interest
// arrives as its own Expense row in the ledger, already listed here alongside the
// payments, so splitting a payment as well would count the same charge twice. Only
// a standalone debt, whose interest this app models, has a split to show.
export function DebtPayments({ view }: { view: DebtsView }) {
  const txns = useLiveTxns()
  const [censor] = useCensor()
  const [debtId, setDebtId] = useState<string | null>(null)
  const today = useMemo(() => new Date(), [])

  const chosen = view.standings.find((s) => s.debt.id === debtId) ?? view.standings[0]
  const events = useMemo(
    () => (chosen ? debtEvents(chosen.debt, txns, today) : []),
    [chosen, txns, today],
  )

  if (view.standings.length === 0) return null
  const money = (n: number) => (censor ? '•••' : `${fmt(Math.abs(n))} ${view.currency}`)

  return (
    <section className="card">
      <div className="dash-title">{t('Payments')}</div>

      {view.standings.length > 1 && (
        <div className="chip-choices" style={{ marginBottom: 10 }}>
          {view.standings.map((s) => (
            <button
              key={s.debt.id}
              type="button"
              className={s.debt.id === chosen.debt.id ? 'choice-chip on' : 'choice-chip'}
              aria-pressed={s.debt.id === chosen.debt.id}
              onClick={() => setDebtId(s.debt.id)}
            >
              {s.debt.name}
            </button>
          ))}
        </div>
      )}

      {chosen.interestAccrued > 0 && (
        <p className="muted set-hint" style={{ marginBottom: 8 }}>
          {t('{amount} of interest has been added since you started tracking this.', {
            amount: money(chosen.interestAccrued),
          })}
        </p>
      )}

      {events.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          {chosen.debt.account
            ? t('Nothing on this account yet.')
            : t('No payments tagged to this debt yet. Tag one when you add the transaction.')}
        </p>
      ) : (
        <div className="debt-payments">
          {events.slice(0, SHOWN).map((e) => (
            <div className="debt-payment" key={e.txn.id}>
              <span className="debt-payment-day muted">{e.txn.period}</span>
              <span className="debt-payment-note">
                {e.delta < 0 ? t('Payment') : t('Added to the balance')}
                {e.txn.note ? ` · ${e.txn.note}` : e.txn.category ? ` · ${e.txn.category}` : ''}
                {e.interest > 0 && (
                  <span className="muted"> · {t('{amount} interest', { amount: money(e.interest) })}</span>
                )}
              </span>
              <span className={`debt-payment-amount ${e.delta < 0 ? 'income' : 'expense'}`}>
                {e.delta < 0 ? '−' : '+'}{money(e.delta)}
              </span>
            </div>
          ))}
          {events.length > SHOWN && (
            <p className="muted set-hint">
              {t('Showing the latest {n}.', { n: String(SHOWN) })}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
