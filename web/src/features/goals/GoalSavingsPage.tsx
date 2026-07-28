import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { addGoalMove, deleteGoalMove, updateGoalMove } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useSettings } from '../transactions/useConfig'
import { useCensor } from '../../prefs'
import { useGoalSavings } from '../home/useGoalSavings'
import { TONE_COLOR } from '../budget/tone'
import { Ring } from '../home/small/Ring'
import { Modal } from '../../components/Modal'
import { ChipPicker } from '../transactions/ChipPicker'
import {
  UNALLOCATED, savingsActivity, type ActivityRow, type GoalMove,
} from '../../lib/analytics/goalSavings'
import { t, tBilingual } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

// The card is a summary, not an archive — the rest lives behind "See all".
const ACTIVITY_SHOWN = 10

// The unallocated pool is an endpoint of a move like any goal, but it has no name
// of its own — this is the label it wears in the pickers and the activity list.
const poolLabel = () => t('Unallocated')
const endpointLabel = (name: string) => (name === UNALLOCATED ? poolLabel() : name)

export function GoalSavingsPage() {
  const data = useGoalSavings()
  const all = useLiveTxns()
  const settings = useSettings()
  const [censor] = useCensor()
  const [moving, setMoving] = useState(false)
  const [editing, setEditing] = useState<GoalMove | null>(null)
  const [allActivity, setAllActivity] = useState(false)

  const activity = useMemo(
    () => (data ? savingsActivity(all, data.moves, settings.savingsAccounts) : []),
    [all, data, settings.savingsAccounts],
  )

  if (!data) return <p className="muted">{t('Loading…')}</p>

  const short = data.unallocated < 0
  const money = (n: number) => (censor ? '•••' : fmt(n))
  // Every place money can sit, in the order the Goals page lists them.
  const endpoints = [UNALLOCATED, ...data.standings.map((s) => s.name)]

  return (
    <div>
      <h1 className="h1">{tBilingual('Goal savings')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 14 }}>
        {t('Split your savings pool between individual goals.')}
      </p>

      {/* Back to where goals and the pool itself are set up — mirrors the row
          the Financial Goals page uses to get here. */}
      <Link to="/goals" className="pick-summary budget-card">
        <span>{t('Financial Goals')}</span>
        <span className="pick-summary-arrow">›</span>
      </Link>

      {/* ── What's left to assign ─────────────────────────────────────── */}
      <section className={`card budget-card gs-head${short ? ' is-short' : ''}`}>
        <div className="dash-title">{t('Unallocated')}</div>
        <div className={`gs-head-amt money${short ? ' amt-expense' : ''}`}>
          {money(data.unallocated)} <span className="gs-head-cur">{data.currency}</span>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
          {short
            ? t('Your goals hold more than your savings accounts contain. Move {amount} back from a goal.', {
              amount: `${money(Math.abs(data.unallocated))} ${data.currency}`,
            })
            : t('In your savings accounts but not yet assigned to a goal.')}
        </p>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          {t('Savings pool: {amount}', { amount: `${money(data.poolBalance)} ${data.currency}` })}
        </p>
      </section>

      {/* ── A ring per goal ───────────────────────────────────────────── */}
      <section className="card budget-card">
        <div className="dash-title">{t('Goals')}</div>
        <div className="gs-rings">
          {data.standings.map((s) => (
            <div key={s.name} className="gs-ring">
              <Ring
                pct={s.ratio * 100}
                color={TONE_COLOR[s.tone]}
                // Blurred in privacy mode like the savings-pool gauge's own
                // percentage — a goal's funding level is as telling as its amount.
                label={censor ? '•••' : `${Math.round(s.ratio * 100)}%`}
                ariaLabel={t('{name}: {pct}% funded', { name: s.name, pct: String(Math.round(s.ratio * 100)) })}
              />
              <span className="gs-ring-name">{s.isEmergencyFund ? t(s.name) : s.name}</span>
              <span className="gs-ring-amt money">{money(s.allocated)}</span>
              <span className="gs-ring-target muted">{t('of {amount}', { amount: money(s.target) })}</span>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-accent gs-move-btn" onClick={() => setMoving(true)}>
          {t('Move money')}
        </button>
      </section>

      {/* ── How the pool got here ─────────────────────────────────────── */}
      <section className="card budget-card">
        <div className="card-head">
          <div className="dash-title">{t('Savings activity')}</div>
          {activity.length > ACTIVITY_SHOWN && (
            <button type="button" className="card-head-link" onClick={() => setAllActivity(true)}>
              {t('See all')} ›
            </button>
          )}
        </div>
        {activity.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t('Nothing yet.')}</p>
        ) : (
          <ActivityList rows={activity.slice(0, ACTIVITY_SHOWN)} censor={censor} onEdit={setEditing} />
        )}
      </section>

      {/* The complete history, on demand. Same rows, same component — the summary
          above is only ever a prefix of this, so the two can't drift. */}
      {allActivity && (
        <Modal title={t('Savings activity')} onClose={() => setAllActivity(false)}>
          <ActivityList rows={activity} censor={censor} onEdit={setEditing} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => setAllActivity(false)}>{t('Close')}</button>
          </div>
        </Modal>
      )}

      {(moving || editing) && (
        <MoveForm
          endpoints={endpoints}
          currency={data.currency}
          editing={editing}
          onClose={() => { setMoving(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

// ── The activity list ────────────────────────────────────────────────────────

function ActivityList({ rows, censor, onEdit }: {
  rows: ActivityRow[]; censor: boolean; onEdit: (m: GoalMove) => void
}) {
  return (
    <ul className="gs-activity">
      {rows.map((row) => (
        <ActivityLine
          key={row.kind === 'txn' ? `t${row.txn.id}` : `m${row.move.id}`}
          row={row}
          censor={censor}
          onEdit={onEdit}
        />
      ))}
    </ul>
  )
}

function ActivityLine({ row, censor, onEdit }: {
  row: ActivityRow; censor: boolean; onEdit: (m: GoalMove) => void
}) {
  const amount = (n: number) => (censor ? '•••' : fmt(Math.abs(n)))

  if (row.kind === 'txn') {
    const inbound = row.delta >= 0
    return (
      <li className="gs-act">
        <span className="gs-act-day">{row.day.slice(5)}</span>
        <span className="gs-act-what">
          {row.txn.type === 'Transfer-In' || row.txn.type === 'Transfer-Out'
            ? `${row.txn.type === 'Transfer-In' ? row.txn.category : row.txn.account} → ${row.txn.type === 'Transfer-In' ? row.txn.account : row.txn.category}`
            : `${row.txn.category} · ${row.txn.account}`}
        </span>
        <span className={`gs-act-amt money ${inbound ? 'income' : 'expense'}`}>
          {inbound ? '+' : '−'}{amount(row.delta)}
        </span>
      </li>
    )
  }

  const m = row.move
  // A move created by tagging a transfer is owned by that transfer — its amount
  // and date come from there, so editing it here would only desync the two.
  const linked = !!m.transferId
  return (
    <li className={`gs-act is-move${linked ? ' is-linked' : ''}`}>
      <span className="gs-act-day">{row.day.slice(5)}</span>
      <button
        type="button"
        className="gs-act-what gs-act-move"
        disabled={linked}
        onClick={() => onEdit(m)}
      >
        {endpointLabel(m.from)} → {endpointLabel(m.to)}
        {linked && <span className="gs-act-tag"> {t('(from a transfer)')}</span>}
      </button>
      <span className="gs-act-amt money">{amount(m.amount)}</span>
    </li>
  )
}

// ── Move money between the pool and a goal ───────────────────────────────────

function MoveForm({ endpoints, currency, editing, onClose }: {
  endpoints: string[]
  currency: string
  editing: GoalMove | null
  onClose: () => void
}) {
  const [from, setFrom] = useState(editing?.from ?? UNALLOCATED)
  const [to, setTo] = useState(editing?.to ?? '')
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const [period, setPeriod] = useState(editing?.period ?? today())
  const [note, setNote] = useState(editing?.note ?? '')
  const [attempted, setAttempted] = useState(false)

  // `to` starts blank so the picker prompts rather than pre-choosing a goal — but
  // UNALLOCATED is itself the empty string, so "unset" and "the pool" would be
  // indistinguishable. Track the choice separately.
  const [toPicked, setToPicked] = useState(!!editing)
  const amountNum = parseFloat(amount)
  const errors = {
    amount: !(amountNum > 0),
    to: !toPicked || to === from,
  }
  const invalid = (k: keyof typeof errors) => attempted && errors[k]

  // The pickers show labels, not raw values — UNALLOCATED is ''.
  const options = endpoints.map(endpointLabel)
  const valueOf = (label: string) => (label === poolLabel() ? UNALLOCATED : label)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    if (Object.values(errors).some(Boolean)) return
    const move = { period, from, to, amount: amountNum, note: note || undefined }
    if (editing) void updateGoalMove(editing.id, move)
    else void addGoalMove(move)
    onClose()
  }

  return (
    <Modal title={t(editing ? 'Edit move' : 'Move money')} onClose={onClose}>
      <form className="txn-form" onSubmit={submit}>
        <div className="row">
          <div className="field" style={{ flex: '1 1 0', minWidth: 0 }}>
            <label>{t('Date')}</label>
            <input type="date" value={period} onChange={(e) => { setPeriod(e.target.value); e.target.blur() }} />
          </div>
          <div className={`field${invalid('amount') ? ' is-invalid' : ''}`} style={{ flex: '1 1 0', minWidth: 0 }}>
            <label>{t('Amount')} ({currency})</label>
            <input inputMode="decimal" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>

        <div className="field pick-field">
          <label>{t('From')}</label>
          <ChipPicker
            value={endpointLabel(from)} options={options}
            onChange={(v) => setFrom(valueOf(v))}
            title={t('From')} placeholder={poolLabel()}
          />
        </div>
        <div className={`field pick-field${invalid('to') ? ' is-invalid' : ''}`}>
          <label>{t('To')}</label>
          <ChipPicker
            value={toPicked ? endpointLabel(to) : ''} options={options}
            onChange={(v) => { setTo(valueOf(v)); setToPicked(true) }}
            title={t('To')} placeholder={t('Select a goal')}
          />
        </div>

        <div className="row">
          <div className="field">
            <label>{t('Note')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Optional')} />
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
          {editing ? (
            <button
              type="button" className="btn" style={{ color: 'var(--expense)' }}
              onClick={() => { void deleteGoalMove(editing.id); onClose() }}
            >
              {t('Delete')}
            </button>
          ) : <span />}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-accent">{t('Save')}</button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
