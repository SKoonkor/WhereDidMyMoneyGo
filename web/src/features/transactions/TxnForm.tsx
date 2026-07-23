import { useEffect, useMemo, useState } from 'react'
import {
  addTxn, updateTxn, addTransfer, updateTransfer, deleteTxn,
  addAccount, addCategory, addSubcategory, type Txn, type TxnType,
} from '../../db'
import { useAccounts, useCategories, useBaseCurrency } from './useConfig'
import { ChipPicker } from './ChipPicker'
import { CategoryPicker } from './CategoryPicker'
import { t, getLang } from '../../i18n'

// User-facing type choices; a Transfer expands to two -In/-Out legs on save.
// Saving isn't a separate kind — it's a Transfer into a savings account, and
// Settings decides which accounts count toward the savings pool.
type Kind = 'Income' | 'Expense' | 'Transfer'
const KINDS: Kind[] = ['Expense', 'Income', 'Transfer']

function kindOf(txn: Txn): Kind {
  if (txn.type === 'Transfer-Out' || txn.type === 'Transfer-In') return 'Transfer'
  if (txn.type === 'Income') return 'Income'
  return 'Expense'
}

const today = () => new Date().toISOString().slice(0, 10)

// Values to pre-fill a fresh (non-editing) form — e.g. from an AI receipt scan.
// Everything is optional; a missing field just starts blank/default. `account`
// is intentionally absent (receipts don't say which account paid), so the user
// always picks it. Ignored when `editing` is set.
export interface TxnPrefill {
  kind?: Kind
  amount?: number | null
  date?: string | null
  note?: string
  category?: string
}

// Add or edit a transaction. `editing` is the row tapped (for a transfer, the
// collapsed Transfer-Out leg); `initialDate` pre-fills the date when adding (e.g.
// tapping a day header); `prefill` seeds a new form from an AI receipt draft.
// Closes via onClose after a successful save/delete.
export function TxnForm({
  editing,
  onClose,
  initialDate,
  prefill,
  notice,
}: {
  editing?: Txn | null
  onClose: () => void
  initialDate?: string
  prefill?: TxnPrefill
  notice?: string // small banner atop the form (e.g. a low-confidence scan warning)
}) {
  const accounts = useAccounts()
  const categories = useCategories()
  const currency = useBaseCurrency()

  const [kind, setKind] = useState<Kind>(editing ? kindOf(editing) : prefill?.kind ?? 'Expense')
  const [period, setPeriod] = useState(editing?.period.slice(0, 10) ?? prefill?.date ?? initialDate ?? today())
  const [amount, setAmount] = useState(
    editing ? String(editing.amount) : prefill?.amount != null ? String(prefill.amount) : '',
  )
  const [note, setNote] = useState(editing?.note ?? prefill?.note ?? '')
  // Single-row fields (Income/Expense) — start unselected so the picker prompts
  // "Select account / category" rather than pre-choosing one. A scanned category
  // seeds `category` but is cleared below if it isn't a real category.
  const [account, setAccount] = useState(editing?.account ?? '')
  const [category, setCategory] = useState(editing?.category ?? prefill?.category ?? '')
  const [subcategory, setSubcategory] = useState(editing?.subcategory ?? '')
  // Transfer fields — for the Out leg, account=from and category=to.
  const [from, setFrom] = useState(editing?.account ?? '')
  const [to, setTo] = useState(
    editing && kindOf(editing) === 'Transfer' ? editing.category : '',
  )

  const catNames = useMemo(
    () => Object.keys(kind === 'Income' ? categories.income : categories.expense),
    [kind, categories],
  )

  // Clear the category if it isn't valid for the current kind's option list
  // (e.g. after switching Expense↔Income) — but never auto-select one.
  useEffect(() => {
    if (kind !== 'Transfer' && category && !catNames.includes(category)) {
      setCategory('')
      setSubcategory('')
    }
  }, [kind, catNames, category])

  // Required-field validation. `attempted` flips on the first Save press, so the
  // red outlines appear only after the user tries to save; they then clear live as
  // each field is corrected. Note is optional (blank → "-" in the list).
  const [attempted, setAttempted] = useState(false)
  const amountNum = parseFloat(amount)
  const errors = {
    date: !period,
    amount: !(amountNum > 0),
    account: kind !== 'Transfer' && !account,
    category: kind !== 'Transfer' && !category,
    from: kind === 'Transfer' && !from,
    to: kind === 'Transfer' && (!to || to === from),
  }
  const invalid = (k: keyof typeof errors) => attempted && errors[k]

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setAttempted(true)
    if (Object.values(errors).some(Boolean)) return // highlight the offending fields

    if (kind === 'Transfer') {
      const tr = { period, amount: amountNum, from, to, note: note || undefined }
      if (editing?.transferId) await updateTransfer(editing.transferId, tr)
      else await addTransfer(tr)
    } else {
      const type: TxnType = kind // Income | Expense map 1:1
      const row = {
        period, account, amount: amountNum, type,
        category,
        subcategory: kind === 'Expense' ? subcategory || undefined : undefined,
        note: note || undefined,
      }
      if (editing) await updateTxn(editing.id, row)
      else await addTxn(row)
    }
    onClose()
  }

  async function remove() {
    if (editing && confirm(t('Delete this transaction?'))) {
      await deleteTxn(editing.id)
      onClose()
    }
  }

  return (
    <form className="txn-form" onSubmit={save}>
      {notice && <p className="txn-notice" role="status">{notice}</p>}
      <div className="seg">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            // Active button fills with its type colour (Income green, Expense
            // dark-red, Transfer grey) to match the transaction-list amounts.
            className={k === kind ? `seg-btn active is-${k.toLowerCase()}` : 'seg-btn'}
            onClick={() => setKind(k)}
          >
            {/* Concise Transfer label on this control; row labels keep the full โอนข้ามบัญชี. */}
            {k === 'Transfer' && getLang() === 'th' ? t('Transfer (short)') : t(k)}
          </button>
        ))}
      </div>

      <div className="row">
        <div className={`field${invalid('date') ? ' is-invalid' : ''}`} style={{ flex: '1 1 0', minWidth: 0 }}>
          <label>{t('Date')}</label>
          {/* Blur on pick so the native calendar closes and applies immediately. */}
          <input
            type="date"
            value={period}
            aria-invalid={invalid('date') || undefined}
            onChange={(e) => { setPeriod(e.target.value); e.target.blur() }}
          />
        </div>
        <div className={`field${invalid('amount') ? ' is-invalid' : ''}`} style={{ flex: '1 1 0', minWidth: 0 }}>
          <label>{t('Amount')} ({currency})</label>
          <input inputMode="decimal" value={amount} aria-invalid={invalid('amount') || undefined} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </div>
      </div>

      {kind === 'Transfer' ? (
        <>
          <div className={`field pick-field${invalid('from') ? ' is-invalid' : ''}`}>
            <label>{t('From')}</label>
            <ChipPicker value={from} options={accounts} onChange={setFrom} onAddNew={addAccount} title={t('From')} placeholder={t('Select account')} />
          </div>
          <div className={`field pick-field${invalid('to') ? ' is-invalid' : ''}`}>
            <label>{t('To')}</label>
            <ChipPicker value={to} options={accounts} onChange={setTo} onAddNew={addAccount} title={t('To')} placeholder={t('Select account')} />
          </div>
        </>
      ) : (
        <>
          <div className={`field pick-field${invalid('account') ? ' is-invalid' : ''}`}>
            <label>{t('Account')}</label>
            <ChipPicker value={account} options={accounts} onChange={setAccount} onAddNew={addAccount} title={t('Account')} placeholder={t('Select account')} />
          </div>
          <div className={`field pick-field${invalid('category') ? ' is-invalid' : ''}`}>
            <label>{t('Category')}</label>
            <CategoryPicker
              kind={kind}
              category={category}
              subcategory={subcategory}
              catNames={catNames}
              subsOf={(c) => categories.expense[c] ?? []}
              onCategory={(v) => { setCategory(v); setSubcategory('') }}
              onSubcategory={setSubcategory}
              onAddCategory={(n) => addCategory(kind === 'Income' ? 'income' : 'expense', n)}
              onAddSubcategory={(n) => addSubcategory(category, n)}
              placeholder={t('Select category')}
            />
          </div>
        </>
      )}

      <div className="row">
        <div className="field">
          <label>{t('Note')}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Shows in your transaction list')} />
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        {editing ? (
          <button type="button" className="btn" style={{ color: 'var(--expense)' }} onClick={remove}>
            {t('Delete')}
          </button>
        ) : (
          <span />
        )}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn btn-accent">{t('Save')}</button>
        </div>
      </div>
    </form>
  )
}
