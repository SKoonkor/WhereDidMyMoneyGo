import { useMemo, useState } from 'react'
import { useLiveTxns } from '../useLiveTxns'
import { useBaseCurrency } from './useConfig'
import {
  addMonths, currentMonthKey, monthLabel, filterByMonth, collapseTransfers,
  groupByDay, monthSummary,
} from './month'
import { TxnForm } from './TxnForm'
import { Modal } from '../../components/Modal'
import type { Txn } from '../../db'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

function isTransfer(x: Txn) {
  return x.type === 'Transfer-Out' || x.type === 'Transfer-In'
}

function RowLine({ x, onTap }: { x: Txn; onTap: () => void }) {
  const transfer = isTransfer(x)
  // "Category · Subcategory" (or the transfer's A → B) — the descriptor of the row.
  const catLabel = transfer
    ? x.type === 'Transfer-Out'
      ? `${x.account} → ${x.category}`
      : `${x.category} → ${x.account}`
    : x.category + (x.subcategory ? ` · ${x.subcategory}` : '')
  const cls = x.type === 'Income' ? 'income' : transfer ? 'transfer' : 'expense'
  const sign = x.type === 'Income' ? '+' : transfer ? '' : '−'

  // The user's note leads the row when present; the category/subcategory (and
  // "Transfer" tag) fall back to a smaller, fainter line beneath it.
  const note = x.note?.trim()
  const primary = note ? note : transfer ? t('Transfer') : catLabel
  const sub = note ? (transfer ? `${t('Transfer')} · ${catLabel}` : catLabel) : transfer ? catLabel : ''

  return (
    <li className="txn-item" onClick={onTap}>
      <span className="cat">
        <span className="txn-primary">{primary}</span>
        {sub && <span className="txn-sub">{sub}</span>}
      </span>
      <span className={`amt money ${cls}`}>{sign}{fmt(x.amount)}</span>
    </li>
  )
}

export function TransactionsPage() {
  const all = useLiveTxns()
  const currency = useBaseCurrency()
  const [month, setMonth] = useState(currentMonthKey())
  const [editing, setEditing] = useState<Txn | null>(null)

  const monthTxns = useMemo(() => filterByMonth(all, month), [all, month])
  const summary = useMemo(() => monthSummary(monthTxns), [monthTxns])
  const days = useMemo(() => groupByDay(collapseTransfers(monthTxns)), [monthTxns])

  return (
    <div>
      <div className="month-nav">
        <button className="tool-btn" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">‹</button>
        <span className="month-label">{monthLabel(month)}</span>
        <button className="tool-btn" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">›</button>
      </div>

      <div className="summary-strip card">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t('Income')}</div>
          <div className="money" style={{ color: 'var(--income)' }}>{fmt(summary.income)}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t('Expense')}</div>
          <div className="money" style={{ color: 'var(--expense)' }}>{fmt(summary.expense)}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t('Net')}</div>
          <div className="money">{fmt(summary.net)} <span className="muted" style={{ fontSize: 12 }}>{currency}</span></div>
        </div>
      </div>

      {days.length === 0 ? (
        <p className="muted" style={{ marginTop: 20 }}>{t('No transactions yet')}</p>
      ) : (
        days.map(([day, rows]) => (
          <div key={day} className="day-group">
            <div className="day-head muted">{day}</div>
            <ul className="txn-list">
              {rows.map((x) => (
                <RowLine key={x.id} x={x} onTap={() => setEditing(x)} />
              ))}
            </ul>
          </div>
        ))
      )}

      {editing && (
        <Modal title={t('Edit transaction')} onClose={() => setEditing(null)}>
          <TxnForm editing={editing} onClose={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  )
}
