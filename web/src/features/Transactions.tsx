import { useState } from 'react'
import { addTxn, deleteTxn, type TxnType } from '../db'
import { useLiveTxns } from './useLiveTxns'
import { t } from '../i18n'

// Phase-0 "prove the loop" feature: add a transaction, see it listed, and it
// persists in IndexedDB on THIS device across reloads / offline. Full editing,
// accounts, and import/export come in Phase 1.
export function Transactions() {
  const txns = useLiveTxns()
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState<TxnType>('Expense')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = parseFloat(amount)
    if (!value || value <= 0) return
    await addTxn({
      period: new Date().toISOString().slice(0, 10),
      account: 'Default',
      amount: value,
      type,
      category: category.trim() || t('Category'),
    })
    setAmount('')
    setCategory('')
  }

  return (
    <div>
      <h1 className="h1">{t('Transactions')}</h1>

      <form className="card" onSubmit={submit}>
        <div className="row">
          <div className="field" style={{ flex: '0 0 120px' }}>
            <label>{t('Amount')}</label>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label>{t('Category')}</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Food, Salary…"
            />
          </div>
          <div className="field" style={{ flex: '0 0 130px' }}>
            <label>&nbsp;</label>
            <select value={type} onChange={(e) => setType(e.target.value as TxnType)}>
              <option value="Expense">{t('Expense')}</option>
              <option value="Income">{t('Income')}</option>
            </select>
          </div>
          <button className="btn btn-accent" type="submit" style={{ alignSelf: 'end' }}>
            {t('Add')}
          </button>
        </div>
      </form>

      {txns.length === 0 ? (
        <p className="muted" style={{ marginTop: 20 }}>{t('No transactions yet')}</p>
      ) : (
        <ul className="txn-list">
          {txns.map((x) => (
            <li className="txn-item" key={x.id}>
              <span className="muted" style={{ fontSize: 12, width: 78 }}>{x.period}</span>
              <span className="cat">{x.category}</span>
              <span className={`amt money ${x.type === 'Income' ? 'income' : 'expense'}`}>
                {x.type === 'Income' ? '+' : '−'}
                {x.amount.toLocaleString()}
              </span>
              <button className="del" aria-label="Delete" onClick={() => deleteTxn(x.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
