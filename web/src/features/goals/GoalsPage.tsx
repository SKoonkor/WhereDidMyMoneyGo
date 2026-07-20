import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getGoals, saveGoals } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useSettings } from '../transactions/useConfig'
import { useTheme, useCensor } from '../../prefs'
import { EMERGENCY_FUND, type GoalsCfg } from '../../data/defaults'
import { emergencyFundStatus, goalFactor, poolTarget } from '../../lib/analytics/goals'
import { buildGoalGauge, gaugeBands } from './figure'
import { Plot } from '../../components/Plot'
import { t } from '../../i18n'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const MONTHS_CAP = 6
// Compact target: 1.23M / 4.56k / 780.
function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}k`
  return fmt(v)
}
const fmtFactor = (f: number) => (Number.isInteger(f) ? String(f) : String(f))

export function GoalsPage() {
  const all = useLiveTxns()
  const settings = useSettings()
  const cfg = useLiveQuery(() => getGoals(), []) // undefined until loaded
  const [theme] = useTheme()
  const [censor] = useCensor()
  const currency = settings.baseCurrency

  const efTarget = settings.monthlyRequired * settings.targetMonths

  const save = (patch: Partial<GoalsCfg>) => {
    if (cfg) void saveGoals({ ...cfg, ...patch })
  }

  const fig = useMemo(() => {
    if (!cfg) return null
    const selected = cfg.selected.filter((g) => g in cfg.goals)
    const pooled = poolTarget(efTarget, cfg.goals, selected, cfg.factors)
    const ef = emergencyFundStatus(all, settings.savingsAccounts, settings.monthlyRequired, settings.targetMonths)
    const balance = ef.currentBalance
    const pct = Math.min((balance / Math.max(pooled, 1)) * 100, 100)
    const months = settings.monthlyRequired > 0 ? balance / settings.monthlyRequired : 0
    const monthsTxt = months >= MONTHS_CAP ? `${MONTHS_CAP}+` : months.toFixed(1)

    const names = [t(EMERGENCY_FUND), ...selected]
    const subtitle = censor
      ? names.length > 1 ? `${names[0]} + ${t('Goals')}` : names[0]
      : names.join(' + ')
    const targetLine = censor ? '' : `<br>${t('Target')}: ${fmt(pooled)} ${currency}`
    const footer = censor
      ? t('{pct}% funded', { pct: pct.toFixed(1) })
      : t('{pct}% funded · Emergency Fund covers {months} months', { pct: pct.toFixed(1), months: monthsTxt })

    return buildGoalGauge({
      balance,
      pooledTarget: pooled,
      currency,
      censor,
      ink: cssVar('--ink', '#e6e9ee'),
      bands: gaugeBands(theme === 'dark'),
      title: t('Savings Pool'),
      subtitle: subtitle + targetLine,
      footer,
    })
    // theme included so the gauge bands rebuild on toggle
  }, [cfg, all, settings, efTarget, currency, censor, theme])

  if (!cfg || !fig) return <p className="muted">{t('Loading…')}</p>

  const selectedSet = new Set(cfg.selected)
  const goalNames = Object.keys(cfg.goals)

  return (
    <div>
      <h1 className="h1">{t('Financial Goals')}</h1>
      <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
        {t('The Emergency Fund is always in the pool. Tick other goals to add their target on top.')}
      </p>

      <section className="card goals-gauge-card">
        <Plot data={fig.data} layout={fig.layout} ariaLabel={t('Savings Pool')} style={{ width: '100%' }} />
      </section>

      <section className="card">
        <div className="dash-title">{t('Goals')}</div>

        {/* Emergency Fund — the always-on pool base. */}
        <div className="goal-row base">
          <span className="goal-check on" aria-hidden="true">✓</span>
          <span className="goal-label">
            {t(EMERGENCY_FUND)} (<span className="money">{compact(efTarget)} {currency}</span>) · <span className="muted">{t('base')}</span>
          </span>
        </div>

        {goalNames.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('No goals yet. Add one below.')}</p>}

        {goalNames.map((name) => {
          const on = selectedSet.has(name)
          const factor = goalFactor(name, cfg.factors)
          return (
            <div key={name} className={`goal-row${on ? ' selected' : ''}`}>
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
              <button type="button" className="goal-del" aria-label={t('Delete')} onClick={() => removeGoal(cfg, name, save)}>×</button>
            </div>
          )
        })}

        <AddGoal cfg={cfg} save={save} currency={currency} />
      </section>

      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {t('Pool accounts and the Emergency Fund target are set in ')}
        <Link to="/settings" className="inline-link">{t('Settings')}</Link>.
      </p>
    </div>
  )
}

function removeGoal(cfg: GoalsCfg, name: string, save: (p: Partial<GoalsCfg>) => void) {
  const goals = { ...cfg.goals }
  const factors = { ...cfg.factors }
  delete goals[name]
  delete factors[name]
  save({ goals, factors, selected: cfg.selected.filter((g) => g !== name) })
}

function AddGoal({ cfg, save, currency }: { cfg: GoalsCfg; save: (p: Partial<GoalsCfg>) => void; currency: string }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [factor, setFactor] = useState('')

  const add = () => {
    const n = name.trim()
    const amt = Number(amount)
    if (!n || !Number.isFinite(amt) || amt <= 0) return
    const f = Math.max(Number(factor) || 1, 1)
    const goals = { ...cfg.goals, [n]: amt }
    const factors = { ...cfg.factors }
    if (f > 1) factors[n] = f
    else delete factors[n]
    save({ goals, factors })
    setName(''); setAmount(''); setFactor('')
  }

  return (
    <div className="goal-add">
      <div className="dash-title" style={{ marginTop: 12 }}>{t('Add a goal')}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Goal name')} />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" inputMode="decimal" placeholder={`${t('Target')} (${currency})`} />
      <input value={factor} onChange={(e) => setFactor(e.target.value)} type="number" inputMode="decimal" min={1} step="any" placeholder={t('xTimes rule (≥1, optional)')} />
      <span className="set-hint">{t('The pool needs the highest of your ticked goals; the factor scales a goal before it counts.')}</span>
      <button type="button" className="btn" onClick={add}>{t('+ Add goal')}</button>
    </div>
  )
}
