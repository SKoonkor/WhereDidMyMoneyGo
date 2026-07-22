import { useEffect, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getGoals, getSettings, saveGoals, saveSettings } from '../../db'
import { useAccounts, useSettings } from '../transactions/useConfig'
import { EMERGENCY_FUND, type GoalsCfg, type Settings } from '../../data/defaults'
import { goalFactor } from '../../lib/analytics/goals'
import { useDragReorder } from '../../lib/useDragReorder'
import { SavingsPoolGauge } from './SavingsPoolGauge'
import { Modal } from '../../components/Modal'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
// Compact target: 1.23M / 4.56k / 780.
function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}k`
  return fmt(v)
}
const fmtFactor = (f: number) => (Number.isInteger(f) ? String(f) : String(f))

export function GoalsPage() {
  const settings = useSettings()
  const cfg = useLiveQuery(() => getGoals(), []) // undefined until loaded
  const [adding, setAdding] = useState(false)
  const currency = settings.baseCurrency

  const efTarget = settings.monthlyRequired * settings.targetMonths

  const save = (patch: Partial<GoalsCfg>) => {
    if (cfg) void saveGoals({ ...cfg, ...patch })
  }

  if (!cfg) return <p className="muted">{t('Loading…')}</p>

  return (
    <div>
      <h1 className="h1">{t('Financial Goals')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 12 }}>
        {t('The Emergency Fund is always in the pool. Tick other goals to add their target on top.')}
      </p>

      <PoolSettings />
      <SavingsPoolGauge />

      <section className="card">
        <div className="dash-title">{t('Goals')}</div>

        {/* Emergency Fund — the always-on pool base (pinned; not reorderable). */}
        <div className="goal-row base">
          <span className="goal-pin" aria-hidden="true">📌</span>
          <span className="goal-check on" aria-hidden="true">✓</span>
          <span className="goal-label">
            {t(EMERGENCY_FUND)} (<span className="money">{compact(efTarget)} {currency}</span>) · <span className="muted">{t('base')}</span>
          </span>
        </div>

        <GoalList cfg={cfg} save={save} currency={currency} />

        <button type="button" className="btn goal-add-btn" onClick={() => setAdding(true)}>＋ {t('Add a goal')}</button>
      </section>

      {adding && (
        <Modal title={t('Add a goal')} onClose={() => setAdding(false)}>
          <GoalForm cfg={cfg} save={save} currency={currency} onClose={() => setAdding(false)} />
        </Modal>
      )}
    </div>
  )
}

// Merge a patch onto the freshest stored settings (mirrors SettingsPage), so a
// write here can't clobber unrelated settings fields with a stale copy.
async function patchSettings(patch: Partial<Settings>) {
  await saveSettings({ ...(await getSettings()), ...patch })
}

// Savings-pool config, moved onto this page from Settings: which accounts count
// toward the pool + the Emergency Fund base (monthlyRequired × targetMonths).
// Collapsed by default (like Budget settings). No Save button — account toggles
// apply instantly and the numeric fields commit on blur (clamped only then, so
// they can still be cleared and retyped freely), and the gauge above updates live.
function PoolSettings() {
  const accounts = useAccounts()
  const stored = useLiveQuery(() => getSettings(), [])
  const [open, setOpen] = useState(false)
  const [monthly, setMonthly] = useState('')
  const [months, setMonths] = useState('')
  const [seeded, setSeeded] = useState(false)

  // Seed the numeric drafts once from stored settings.
  useEffect(() => {
    if (!seeded && stored) {
      setMonthly(String(stored.monthlyRequired))
      setMonths(String(stored.targetMonths))
      setSeeded(true)
    }
  }, [stored, seeded])
  if (!stored) return null

  const pool = stored.savingsAccounts
  const inPool = new Set(pool)
  const toggle = (name: string) => {
    const next = inPool.has(name) ? pool.filter((a) => a !== name) : [...pool, name]
    void patchSettings({ savingsAccounts: next })
  }

  const monthlyNum = Math.max(0, Number(monthly) || 0)
  const monthsNum = Math.min(24, Math.max(1, Math.round(Number(months) || 1)))
  const efTarget = monthlyNum * monthsNum
  const commitMonthly = () => { setMonthly(String(monthlyNum)); void patchSettings({ monthlyRequired: monthlyNum }) }
  const commitMonths = () => { setMonths(String(monthsNum)); void patchSettings({ targetMonths: monthsNum }) }

  return (
    <section className="card budget-card budget-settings" style={{ marginBottom: 12 }}>
      <button
        type="button"
        className="budget-settings-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dash-title" style={{ margin: 0 }}>{t('Savings pool settings')}</span>
        <span className="budget-settings-caret">{open ? '⌃' : '⌄'}</span>
      </button>

      <div className={open ? 'budget-settings-body open' : 'budget-settings-body'}>
        <div className="budget-settings-inner">
          <div className="budget-subsection">
            <div className="set-field">
              <label>{t('Pool accounts')}</label>
              <div className="chip-choices">
                {accounts.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={inPool.has(a) ? 'choice-chip on' : 'choice-chip'}
                    aria-pressed={inPool.has(a)}
                    onClick={() => toggle(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <span className="set-hint">{t('Balances of these accounts make up your savings pool.')}</span>
            </div>

            <div className="set-field">
              <label>{t('Monthly required expenses')}</label>
              <input
                type="number"
                inputMode="decimal"
                value={monthly}
                style={{ maxWidth: 160 }}
                onChange={(e) => setMonthly(e.target.value)}
                onBlur={commitMonthly}
              />
              <span className="set-hint">{t('Your baseline monthly spending — used to size the Emergency Fund.')}</span>
            </div>

            <div className="set-field">
              <label>{t('Target months')}</label>
              <input
                type="number"
                inputMode="numeric"
                value={months}
                style={{ maxWidth: 90 }}
                onChange={(e) => setMonths(e.target.value)}
                onBlur={commitMonths}
              />
              <span className="set-hint">
                {t('Months of expenses to keep. Emergency Fund target = {amount}.', {
                  amount: `${efTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${stored.baseCurrency}`,
                })}
              </span>
            </div>

            <button type="button" className="btn budget-settings-collapse" onClick={() => setOpen(false)}>
              {t('Collapse settings')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function removeGoal(cfg: GoalsCfg, name: string, save: (p: Partial<GoalsCfg>) => void) {
  const goals = { ...cfg.goals }
  const factors = { ...cfg.factors }
  delete goals[name]
  delete factors[name]
  save({ goals, factors, selected: cfg.selected.filter((g) => g !== name) })
}

// Draggable list of user goals (the Emergency Fund base is pinned above and not
// part of this list). Dragging a row reorders the goal priority; the new key
// order is persisted on drop via the shared hold-to-drag reorder mechanic.
function GoalList({ cfg, save, currency }: { cfg: GoalsCfg; save: (p: Partial<GoalsCfg>) => void; currency: string }) {
  const keys = Object.keys(cfg.goals)
  const [confirmDel, setConfirmDel] = useState<string | null>(null) // goal pending delete
  const selectedSet = new Set(cfg.selected)

  const drag = useDragReorder(
    keys,
    (order) => {
      const goals: Record<string, number> = {}
      for (const k of order) if (k in cfg.goals) goals[k] = cfg.goals[k]
      save({ goals }) // persist the reordered priority
    },
    { handle: '.goal-drag', ignore: '.goal-check, .goal-del' },
  )

  if (keys.length === 0) return <p className="muted" style={{ fontSize: 13 }}>{t('No goals yet.')}</p>

  return (
    <>
    <div className="goal-list" {...drag.listProps}>
      {drag.order.map((name) => {
        const on = selectedSet.has(name)
        const factor = goalFactor(name, cfg.factors)
        return (
          <div
            key={name}
            ref={drag.itemRef(name)}
            className={`goal-row${on ? ' selected' : ''}${drag.dragging === name ? ' dragging' : ''}`}
            style={drag.itemStyle(name)}
            onPointerDown={drag.onItemPointerDown(name)}
          >
            <span className="goal-drag" aria-hidden="true">⠿</span>
            <button
              type="button"
              className={`goal-check${on ? ' on' : ''}`}
              aria-label={on ? t('Remove from pool') : t('Add to pool')}
              onClick={() => save({ selected: on ? cfg.selected.filter((g) => g !== name) : [...cfg.selected, name] })}
            >
              {on ? '✓' : ''}
            </button>
            <span className="goal-label">
              {name} (<span className="money">{compact(cfg.goals[name])} {currency}</span>)
              {factor > 1 && <span className="goal-tag"> {t('[{fx}x rule]', { fx: fmtFactor(factor) })}</span>}
            </span>
            <button type="button" className="goal-del" aria-label={t('Delete goal')} onClick={() => setConfirmDel(name)}>×</button>
          </div>
        )
      })}
    </div>

    {confirmDel && (
      <Modal title={t('Delete this goal?')} onClose={() => setConfirmDel(null)}>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          {t('Remove “{name}” from your goals? This can’t be undone.', { name: confirmDel })}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => setConfirmDel(null)}>{t('Cancel')}</button>
          <button
            type="button"
            className="btn solid-danger"
            onClick={() => { removeGoal(cfg, confirmDel, save); setConfirmDel(null) }}
          >
            {t('Delete')}
          </button>
        </div>
      </Modal>
    )}
    </>
  )
}

// Add-goal form, shown inside the shared Modal (mirrors TxnForm). Enter submits.
function GoalForm({ cfg, save, currency, onClose }: {
  cfg: GoalsCfg; save: (p: Partial<GoalsCfg>) => void; currency: string; onClose: () => void
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [factor, setFactor] = useState('')

  const add = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    const amt = Number(amount)
    if (!n || !Number.isFinite(amt) || amt <= 0) return
    const f = Math.max(Number(factor) || 1, 1)
    const goals = { ...cfg.goals, [n]: amt }
    const factors = { ...cfg.factors }
    if (f > 1) factors[n] = f
    else delete factors[n]
    save({ goals, factors })
    onClose()
  }

  return (
    <form className="goal-add goal-form" onSubmit={add}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Goal name')} autoFocus />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" inputMode="decimal" placeholder={`${t('Target')} (${currency})`} />
      <input value={factor} onChange={(e) => setFactor(e.target.value)} type="number" inputMode="decimal" min={1} step="any" placeholder={t('xTimes rule (≥1, optional)')} />
      <span className="set-hint">{t('The pool needs the highest of your ticked goals; the factor scales a goal before it counts.')}</span>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button type="submit" className="btn btn-accent">{t('Add goal')}</button>
      </div>
    </form>
  )
}
