import { useState, type CSSProperties } from 'react'
import { deleteDebt, getDebts, saveDebts } from '../../db'
import { useCensor } from '../../prefs'
import { fundedPct } from '../../lib/analytics/goalSavings'
import { DSR_CAP, DSR_COMFORT, type DebtStanding } from '../../lib/analytics/debt'
import { TONE_COLOR } from '../budget/tone'
import { Modal } from '../../components/Modal'
import { useDebts, type DebtsView } from './useDebts'
import { DebtForm } from './DebtForm'
import { DebtPayments } from './DebtPayments'
import { DsrMeter } from './DsrMeter'
import { PayoffPlan } from './PayoffPlan'
import type { Debt } from '../../data/defaults'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

// A debt row doubles as its own progress bar, exactly like the Financial Goals
// rows: the label box fills from the first letter to just short of the delete
// button with how much of the debt is gone. Same CSS custom properties, so the
// two lists read the same way even though one fills up and the other empties.
function fillProps(s: DebtStanding) {
  const pct = fundedPct(s.paidOff)
  const style = {
    '--goal-fill': `${pct}%`,
    '--goal-fill-color': TONE_COLOR[s.tone],
  } as CSSProperties
  return { style, title: t('{name}: {pct}% paid off', { name: s.debt.name, pct: String(pct) }) }
}

export function DebtsPage() {
  const view = useDebts()
  const [editing, setEditing] = useState<Debt | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmDel, setConfirmDel] = useState<DebtStanding | null>(null)

  if (!view) return <p className="muted">{t('Loading…')}</p>

  // Merge onto the freshest stored config rather than the render's copy: the same
  // guard the Goals and Settings pages use, so a save can't clobber a strategy the
  // payoff card changed a moment ago.
  const upsert = async (d: Debt) => {
    const cfg = await getDebts()
    const at = cfg.debts.findIndex((x) => x.id === d.id)
    const debts = at >= 0 ? cfg.debts.map((x) => (x.id === d.id ? d : x)) : [...cfg.debts, d]
    await saveDebts({ ...cfg, debts })
  }

  const { standings, currency } = view
  // Where each debt sits in the payoff order, for the rank badge on its row.
  const rank = new Map(view.ranked.map((s, i) => [s.debt.id, i + 1]))

  return (
    <div>
      <h1 className="h1">{t('Debts')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 12 }}>
        {t('What you owe, what it costs, and when it ends.')}
      </p>

      <HealthCard view={view} />

      <section className="card">
        <div className="dash-title">{t('Your debts')}</div>

        {standings.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>{t('No debts tracked.')}</p>
        ) : (
          <div className="debt-list">
            {standings.map((s) => (
              <DebtRow
                key={s.debt.id}
                standing={s}
                rank={rank.get(s.debt.id) ?? 0}
                currency={currency}
                onEdit={() => setEditing(s.debt)}
                onDelete={() => setConfirmDel(s)}
              />
            ))}
          </div>
        )}

        <button type="button" className="btn goal-add-btn" onClick={() => setAdding(true)}>
          ＋ {t('Add a debt')}
        </button>
      </section>

      <PayoffPlan view={view} />
      <DebtPayments view={view} />

      {(adding || editing) && (
        <Modal title={editing ? t('Edit debt') : t('Add a debt')} onClose={() => { setAdding(false); setEditing(null) }}>
          <DebtForm
            debt={editing ?? undefined}
            taken={standings.map((s) => s.debt.account).filter((a): a is string => !!a)}
            currency={currency}
            onSave={(d) => void upsert(d)}
            onClose={() => { setAdding(false); setEditing(null) }}
          />
        </Modal>
      )}

      {confirmDel && (
        <Modal title={t('Stop tracking this debt?')} onClose={() => setConfirmDel(null)}>
          <p className="muted" style={{ margin: '0 0 14px' }}>
            {confirmDel.debt.account
              ? t('“{name}” stops being tracked as a debt. Nothing in your transactions changes — the account and its history stay exactly as they are.', { name: confirmDel.debt.name })
              : t('“{name}” and its terms are removed, and the payments you tagged to it go back to being ordinary transactions.', { name: confirmDel.debt.name })}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirmDel(null)}>{t('Cancel')}</button>
            <button
              type="button"
              className="btn solid-danger"
              onClick={() => { void deleteDebt(confirmDel.debt.id); setConfirmDel(null) }}
            >
              {t('Delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Total owed, the ratio, and one sentence saying what the ratio means. The
// sentence is the point: a percentage on its own tells a user nothing about
// whether they are in trouble.
function HealthCard({ view }: { view: DebtsView }) {
  const [censor] = useCensor()
  const { owed, obligation, income, dsr, tone, apr, currency, standings } = view
  const money = (n: number) => (censor ? '•••' : `${fmt(n)} ${currency}`)

  const verdict =
    income <= 0
      ? t('Set your monthly income on the Budget page to see how much of it your debts take.')
      : tone === 'good'
        ? t('Under the {n}% line most lenders treat as comfortable.', { n: String(DSR_COMFORT) })
        : tone === 'warn'
          ? t('Past the {n}% comfort line — manageable, but there is little room for another payment.', { n: String(DSR_COMFORT) })
          : t('More than half your income. {n}% is the ceiling lenders in Thailand work to.', { n: String(DSR_CAP) })

  return (
    <section className="card debt-health">
      <div className="dash-title">{t('Total owed')}</div>
      <div className="debt-owed">
        <span className="debt-owed-amount">{money(owed)}</span>
        {standings.length > 0 && (
          <span className="muted debt-owed-note">
            {t('{n} debts · {apr}% average rate', { n: String(standings.length), apr: apr.toFixed(1) })}
          </span>
        )}
      </div>

      {standings.length > 0 && (
        <>
          <div className="debt-dsr-line">
            <span>{t('Monthly payments')}</span>
            <span className="money">
              {income > 0
                ? t('{paid} of {income} — {pct}%', { paid: money(obligation), income: money(income), pct: dsr.toFixed(0) })
                : money(obligation)}
            </span>
          </div>
          {income > 0 && <DsrMeter pct={dsr} tone={tone} />}
          <p className={`debt-verdict ${tone}`}>{verdict}</p>
        </>
      )}
    </section>
  )
}

function DebtRow({ standing, rank, currency, onEdit, onDelete }: {
  standing: DebtStanding
  rank: number
  currency: string
  onEdit: () => void
  onDelete: () => void
}) {
  const [censor] = useCensor()
  const { debt, balance, minimum, utilization } = standing
  const money = (n: number) => (censor ? '•••' : `${fmt(n)} ${currency}`)

  return (
    <div className="goal-row debt-row">
      <span className="debt-rank" title={t('Payoff order')}>{rank}</span>
      <button type="button" className="goal-label debt-label" onClick={onEdit} {...fillProps(standing)}>
        <span className="debt-name">
          {debt.name}
          {debt.account && <span className="debt-chip"> {t('linked')}</span>}
        </span>
        <span className="debt-meta muted">
          <span className="money">{money(balance)}</span>
          {' · '}{t('{apr}%', { apr: String(debt.apr) })}
          {' · '}{t('min {amount}', { amount: money(minimum) })}
          {utilization !== null && ` · ${t('{pct}% of limit', { pct: utilization.toFixed(0) })}`}
          {debt.dueDay && ` · ${t('due the {day}', { day: String(debt.dueDay) })}`}
        </span>
      </button>
      <button type="button" className="goal-del" aria-label={t('Delete debt')} onClick={onDelete}>×</button>
    </div>
  )
}
