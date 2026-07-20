import { useEffect, useMemo, useState } from 'react'
import {
  addTxn, updateTxn, addTransfer, updateTransfer, deleteTxn,
  addAccount, addCategory, addSubcategory, type Txn, type TxnType,
} from '../../db'
import { useAccounts, useCategories } from './useConfig'
import { ComboSelect } from './ComboSelect'
import { t } from '../../i18n'

// User-facing type choices; a Transfer expands to two -In/-Out legs on save.
type Kind = 'Income' | 'Expense' | 'Transfer' | 'Saving'
const KINDS: Kind[] = ['Expense', 'Income', 'Transfer', 'Saving']

function kindOf(txn: Txn): Kind {
  if (txn.type === 'Transfer-Out' || txn.type === 'Transfer-In') return 'Transfer'
  if (txn.type === 'Saving') return 'Saving'
  if (txn.type === 'Income') return 'Income'
  return 'Expense'
}

const today = () => new Date().toISOString().slice(0, 10)

// Add or edit a transaction. `editing` is the row tapped (for a transfer, the
// collapsed Transfer-Out leg). Closes via onClose after a successful save/delete.
export function TxnForm({ editing, onClose }: { editing?: Txn | null; onClose: () => void }) {
  const accounts = useAccounts()
  const categories = useCategories()

  const [kind, setKind] = useState<Kind>(editing ? kindOf(editing) : 'Expense')
  const [period, setPeriod] = useState(editing?.period.slice(0, 10) ?? today())
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const [note, setNote] = useState(editing?.note ?? '')
  // Single-row fields (Income/Expense/Saving).
  const [account, setAccount] = useState(editing?.account ?? accounts[0] ?? '')
  const [category, setCategory] = useState(editing?.category ?? '')
  const [subcategory, setSubcategory] = useState(editing?.subcategory ?? '')
  // Transfer fields — for the Out leg, account=from and category=to.
  const [from, setFrom] = useState(editing?.account ?? accounts[0] ?? '')
  const [to, setTo] = useState(
    editing && kindOf(editing) === 'Transfer' ? editing.category : accounts[1] ?? '',
  )

  const catNames = useMemo(
    () => Object.keys(kind === 'Income' ? categories.income : categories.expense),
    [kind, categories],
  )
  const subNames = useMemo(
    () => (kind === 'Expense' ? categories.expense[category] ?? [] : []),
    [kind, category, categories],
  )

  // Default the category to the first available option so a row never falls back
  // to the literal word "Category". Runs when the kind (hence the option list)
  // changes and the current pick isn't valid for it.
  useEffect(() => {
    if (kind !== 'Transfer' && catNames.length && !catNames.includes(category)) {
      setCategory(catNames[0])
      setSubcategory('')
    }
  }, [kind, catNames, category])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const value = parseFloat(amount)
    if (!value || value <= 0) return

    if (kind === 'Transfer') {
      if (from === to) return
      const tr = { period, amount: value, from, to, note: note || undefined }
      if (editing?.transferId) await updateTransfer(editing.transferId, tr)
      else await addTransfer(tr)
    } else {
      const type: TxnType = kind // Income | Expense | Saving map 1:1
      const row = {
        period, account, amount: value, type,
        category: category || t('Category'),
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
      <div className="seg">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={k === kind ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setKind(k)}
          >
            {t(k)}
          </button>
        ))}
      </div>

      <div className="row">
        <div className="field" style={{ flex: '0 0 150px' }}>
          <label>{t('Date')}</label>
          <input type="date" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 0 130px' }}>
          <label>{t('Amount')}</label>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </div>
      </div>

      {kind === 'Transfer' ? (
        <div className="row">
          <div className="field">
            <label>{t('From')}</label>
            <ComboSelect value={from} options={accounts} onChange={setFrom} onAddNew={addAccount} />
          </div>
          <div className="field">
            <label>{t('To')}</label>
            <ComboSelect value={to} options={accounts} onChange={setTo} onAddNew={addAccount} />
          </div>
        </div>
      ) : (
        <>
          <div className="row">
            <div className="field">
              <label>{t('Account')}</label>
              <ComboSelect value={account} options={accounts} onChange={setAccount} onAddNew={addAccount} />
            </div>
            <div className="field">
              <label>{t('Category')}</label>
              <ComboSelect
                value={category}
                options={catNames}
                onChange={(v) => { setCategory(v); setSubcategory('') }}
                onAddNew={(n) => addCategory(kind === 'Income' ? 'income' : 'expense', n)}
              />
            </div>
          </div>
          {kind === 'Expense' && category && (
            <div className="row">
              <div className="field">
                <label>{t('Subcategory')}</label>
                <ComboSelect
                  value={subcategory}
                  options={subNames}
                  onChange={setSubcategory}
                  onAddNew={(n) => addSubcategory(category, n)}
                />
              </div>
            </div>
          )}
        </>
      )}

      <div className="row">
        <div className="field">
          <label>{t('Note')}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="" />
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
