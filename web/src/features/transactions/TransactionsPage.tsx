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
  const label = transfer
    ? x.type === 'Transfer-Out'
      ? `${x.account} → ${x.category}`
      : `${x.category} → ${x.account}`
    : x.category + (x.subcategory ? ` · ${x.subcategory}` : '')
  const cls = x.type === 'Income' ? 'income' : transfer ? 'transfer' : 'expense'
  const sign = x.type === 'Income' ? '+' : transfer ? '' : '−'
  return (
    <li className="txn-item" onClick={onTap}>
      <span className="cat">
        {transfer ? t('Transfer') : label}
        {transfer && <span className="muted" style={{ fontSize: 12, display: 'block' }}>{label}</span>}
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
  const [adding, setAdding] = useState(false)

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

      <button className="fab" onClick={() => setAdding(true)} aria-label={t('Add')}>＋</button>

      {(adding || editing) && (
        <Modal
          title={editing ? t('Edit transaction') : t('Add transaction')}
          onClose={() => { setAdding(false); setEditing(null) }}
        >
          <TxnForm editing={editing} onClose={() => { setAdding(false); setEditing(null) }} />
        </Modal>
      )}
    </div>
  )
}
