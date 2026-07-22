import { useMemo, useState } from 'react'
import { useLiveTxns } from '../useLiveTxns'
import { useBaseCurrency } from './useConfig'
import {
  addMonths, currentMonthKey, monthLabel, filterByMonth, collapseTransfers,
  groupByDay, monthSummary, daySummary, dayHeaderParts,
} from './month'
import { TxnForm } from './TxnForm'
import { MonthYearPicker } from './MonthYearPicker'
import { Modal } from '../../components/Modal'
import type { Txn } from '../../db'
import { UNKNOWN_NAME } from '../../data/defaults'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function isTransfer(x: Txn) {
  return x.type === 'Transfer-Out' || x.type === 'Transfer-In'
}

// A category/account left dangling by a deletion of "Other" — flagged so the user
// reassigns it. Rendered as "⚠ Unknown" in warning-orange.
function isUnknown(s: string) {
  return s === UNKNOWN_NAME
}

function RowLine({ x, onTap }: { x: Txn; onTap: () => void }) {
  const transfer = isTransfer(x)
  const cls = x.type === 'Income' ? 'income' : transfer ? 'transfer' : 'expense'
  // No leading +/− sign — the green/red colour already carries the direction.

  // Left column: category over subcategory (transfers show the "Transfer" tag).
  // Middle column: the note leads (falling back to the category), with the
  // account beneath — or the "from → to" flow for a transfer (on the collapsed
  // Transfer-Out leg, account=from and category=to).
  const note = x.note?.trim()
  const flow = transfer
    ? x.type === 'Transfer-Out'
      ? `${x.account} → ${x.category}`
      : `${x.category} → ${x.account}`
    : ''
  const main = note || (transfer ? flow : x.category)
  const detail = transfer ? (note ? flow : '') : x.account

  return (
    <li className="txn-item" onClick={onTap}>
      <span className="txn-cat">
        <span className={`txn-cat-main${!transfer && isUnknown(x.category) ? ' txn-unknown' : ''}`}>
          {transfer ? t('Transfer') : isUnknown(x.category) ? `⚠ ${t('Unknown')}` : x.category}
        </span>
        {!transfer && x.subcategory && <span className="txn-cat-sub">{x.subcategory}</span>}
      </span>
      <span className="txn-main">
        <span className={`txn-primary${main === x.category && isUnknown(main) ? ' txn-unknown' : ''}`}>{main}</span>
        {detail && (
          <span className={`txn-sub${isUnknown(detail) ? ' txn-unknown' : ''}`}>
            {isUnknown(detail) ? `⚠ ${t('Unknown')}` : detail}
          </span>
        )}
      </span>
      <span className={`amt money ${cls}`}>{fmt(x.amount)}</span>
    </li>
  )
}

export function TransactionsPage() {
  const all = useLiveTxns()
  const currency = useBaseCurrency()
  const [month, setMonth] = useState(currentMonthKey())
  const [editing, setEditing] = useState<Txn | null>(null)
  const [adding, setAdding] = useState<string | null>(null) // date to pre-fill
  const [picking, setPicking] = useState(false) // month/year selector open
  const thisMonth = currentMonthKey()

  const monthTxns = useMemo(() => filterByMonth(all, month), [all, month])
  const summary = useMemo(() => monthSummary(monthTxns), [monthTxns])
  const days = useMemo(() => groupByDay(collapseTransfers(monthTxns)), [monthTxns])

  return (
    <div>
      <div className="month-nav">
        <button className="tool-btn month-arrow" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">‹</button>
        <button type="button" className="month-label" onClick={() => setPicking(true)}>{monthLabel(month)}</button>
        <button className="tool-btn month-arrow" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">›</button>
        <button
          type="button"
          className="tool-btn today-btn"
          onClick={() => setMonth(thisMonth)}
          disabled={month === thisMonth}
        >
          {t('Today')}
        </button>
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
        days.map(([day, rows], i) => {
          const { dayNum, weekday, dow } = dayHeaderParts(day)
          const { income, expense } = daySummary(rows)
          // Alternating bands: the latest day (index 0) is shaded, then normal…
          return (
            <div key={day} className={`day-group${i % 2 === 0 ? ' is-shaded' : ''}`}>
              {/* Tapping the day header adds a transaction pre-dated to that day. */}
              <div className="day-head" role="button" tabIndex={0} onClick={() => setAdding(day)}>
                <span className="day-date">
                  <span className="day-num">{dayNum}</span>
                  <span className={dow === 0 ? 'day-badge sun' : 'day-badge'}>{weekday}</span>
                </span>
                <span className="day-totals">
                  {income > 0 && <span className="money income">+{fmt(income)}</span>}
                  {expense > 0 && <span className="money expense">−{fmt(expense)}</span>}
                </span>
              </div>
              <ul className="txn-list">
                {rows.map((x) => (
                  <RowLine key={x.id} x={x} onTap={() => setEditing(x)} />
                ))}
              </ul>
            </div>
          )
        })
      )}

      {editing && (
        <Modal title={t('Edit transaction')} onClose={() => setEditing(null)}>
          <TxnForm editing={editing} onClose={() => setEditing(null)} />
        </Modal>
      )}

      {adding && (
        <Modal title={t('Add transaction')} onClose={() => setAdding(null)}>
          <TxnForm initialDate={adding} onClose={() => setAdding(null)} />
        </Modal>
      )}

      {picking && (
        <MonthYearPicker
          value={month}
          onSelect={(key) => setMonth(key)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}
