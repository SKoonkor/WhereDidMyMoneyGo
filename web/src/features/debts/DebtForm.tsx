import { useState, type FormEvent } from 'react'
import { useAccounts } from '../transactions/useConfig'
import {
  DEFAULT_CARD_MIN_PERCENT,
  type Debt,
  type DebtKind,
  type MinPayment,
} from '../../data/defaults'
import { t } from '../../i18n'
import { NumberField } from '../../components/NumberField'

// Add or edit one debt. Everything the simulator needs and nothing it doesn't —
// the balance is the one field that is deliberately absent for a linked debt,
// because the ledger already knows it and a second copy could only ever disagree.
export function DebtForm({ debt, taken, currency, onSave, onClose }: {
  /** The debt being edited, or undefined when adding. */
  debt?: Debt
  /** Accounts already claimed by another debt — two debts can't share one. */
  taken: string[]
  currency: string
  onSave: (d: Debt) => void
  onClose: () => void
}) {
  const accounts = useAccounts()
  const [name, setName] = useState(debt?.name ?? '')
  const [kind, setKind] = useState<DebtKind>(debt?.kind ?? 'revolving')
  const [linked, setLinked] = useState(debt ? !!debt.account : true)
  const [account, setAccount] = useState(debt?.account ?? '')
  const [opening, setOpening] = useState(debt?.openingBalance ? String(debt.openingBalance) : '')
  const [openedOn, setOpenedOn] = useState(debt?.openingDate ?? new Date().toISOString().slice(0, 10))
  const [apr, setApr] = useState(debt ? String(debt.apr) : '')
  const [minMode, setMinMode] = useState<MinPayment['mode']>(debt?.minPayment.mode ?? 'percent')
  const [minValue, setMinValue] = useState(
    debt ? String(debt.minPayment.value) : String(DEFAULT_CARD_MIN_PERCENT),
  )
  const [limit, setLimit] = useState(debt?.creditLimit ? String(debt.creditLimit) : '')
  const [dueDay, setDueDay] = useState(debt?.dueDay ? String(debt.dueDay) : '')
  const [error, setError] = useState('')

  // Switching kind moves the minimum to the rule that kind normally uses, but only
  // while the user hasn't overridden it — the mode chips below stay available.
  const pickKind = (k: DebtKind) => {
    setKind(k)
    if (k === 'installment' && minMode === 'percent' && minValue === String(DEFAULT_CARD_MIN_PERCENT)) {
      setMinMode('fixed')
      setMinValue('')
    }
  }

  const free = accounts.filter((a) => a === debt?.account || !taken.includes(a))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError(t('Give the debt a name.'))
    const rate = Number(apr)
    if (!Number.isFinite(rate) || rate < 0) return setError(t('Enter an interest rate (0 if there is none).'))
    const min = Number(minValue)
    if (!Number.isFinite(min) || min <= 0) return setError(t('Enter the minimum payment.'))
    if (linked && !account) return setError(t('Choose the account that holds this debt.'))
    const open = Number(opening)
    if (!linked && (!Number.isFinite(open) || open <= 0)) return setError(t('Enter what you owe today.'))

    const day = Math.round(Number(dueDay))
    const cap = Number(limit)
    onSave({
      id: debt?.id ?? crypto.randomUUID(),
      name: n,
      kind,
      ...(linked
        ? { account }
        : { openingBalance: open, openingDate: openedOn }),
      apr: rate,
      minPayment: { mode: minMode, value: min },
      ...(kind === 'revolving' && Number.isFinite(cap) && cap > 0 ? { creditLimit: cap } : {}),
      ...(day >= 1 && day <= 31 ? { dueDay: day } : {}),
    })
    onClose()
  }

  return (
    <form className="debt-form" onSubmit={submit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Debt name')} autoFocus />

      <div className="seg">
        <button type="button" className={`seg-btn${kind === 'revolving' ? ' active' : ''}`} onClick={() => pickKind('revolving')}>
          {t('Credit card')}
        </button>
        <button type="button" className={`seg-btn${kind === 'installment' ? ' active' : ''}`} onClick={() => pickKind('installment')}>
          {t('Loan')}
        </button>
      </div>

      <div className="seg">
        <button type="button" className={`seg-btn${linked ? ' active' : ''}`} onClick={() => setLinked(true)}>
          {t('Track an account')}
        </button>
        <button type="button" className={`seg-btn${!linked ? ' active' : ''}`} onClick={() => setLinked(false)}>
          {t('Enter it myself')}
        </button>
      </div>

      {linked ? (
        <div className="set-field">
          <label>{t('Account')}</label>
          <div className="chip-choices">
            {free.map((a) => (
              <button
                key={a}
                type="button"
                className={account === a ? 'choice-chip on' : 'choice-chip'}
                aria-pressed={account === a}
                onClick={() => setAccount(a)}
              >
                {a}
              </button>
            ))}
          </div>
          <span className="set-hint">
            {t('The balance and every payment come from this account, so there is nothing to keep up to date.')}
          </span>
        </div>
      ) : (
        <>
          <div className="set-field">
            <label>{t('What you owe now')} ({currency})</label>
            <NumberField
              mode="calc"
              label={`${t('What you owe now')} (${currency})`}
              value={opening}
              onChange={setOpening}
            />
          </div>
          <div className="set-field">
            <label>{t('As of')}</label>
            <input value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} type="date" />
            <span className="set-hint">{t('Interest is added from this date onward, and payments you tag reduce it.')}</span>
          </div>
        </>
      )}

      <div className="set-field">
        <label>{t('Interest rate (% a year)')}</label>
        <NumberField
          mode="digits" allowDecimal
          label={t('Interest rate (% a year)')}
          value={apr}
          onChange={setApr}
        />
      </div>

      <div className="set-field">
        <label>{t('Minimum payment')}</label>
        <div className="seg">
          <button type="button" className={`seg-btn${minMode === 'percent' ? ' active' : ''}`} onClick={() => setMinMode('percent')}>
            {t('% of balance')}
          </button>
          <button type="button" className={`seg-btn${minMode === 'fixed' ? ' active' : ''}`} onClick={() => setMinMode('fixed')}>
            {t('Fixed amount')}
          </button>
        </div>
        {/* A percentage is one number; a fixed installment is money, and money is
            where the calculator earns its keep. */}
        <NumberField
          mode={minMode === 'percent' ? 'digits' : 'calc'}
          allowDecimal
          label={t('Minimum payment')}
          value={minValue}
          onChange={setMinValue}
          placeholder={minMode === 'percent' ? '8' : currency}
        />
        <span className="set-hint">
          {minMode === 'percent'
            ? t('Cards in Thailand ask for 8% of the balance, or ฿500 — whichever is more.')
            : t('The installment your lender collects each month.')}
        </span>
      </div>

      {kind === 'revolving' && (
        <div className="set-field">
          <label>{t('Credit limit (optional)')} ({currency})</label>
          <NumberField
            mode="calc"
            label={`${t('Credit limit (optional)')} (${currency})`}
            value={limit}
            onChange={setLimit}
          />
          <span className="set-hint">{t('Lets the page show how much of the card you are using.')}</span>
        </div>
      )}

      <div className="set-field">
        <label>{t('Day of the month it is due (optional)')}</label>
        <NumberField
          mode="digits"
          label={t('Day of the month it is due (optional)')}
          value={dueDay}
          onChange={setDueDay}
        />
      </div>

      {error && <span className="form-error">{error}</span>}

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button type="submit" className="btn btn-accent">{debt ? t('Save') : t('Add debt')}</button>
      </div>
    </form>
  )
}
