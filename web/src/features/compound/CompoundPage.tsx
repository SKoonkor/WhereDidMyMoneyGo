import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getGoals } from '../../db'
import { useSettings } from '../transactions/useConfig'
import { useTheme } from '../../prefs'
import { goalFactor } from '../../lib/analytics/goals'
import { computeSchedule, COMPOUNDING, type CompoundGoal } from '../../lib/analytics/compound'
import { buildCompoundFigure, type UiColors, type CompoundLabels } from './figure'
import { Plot } from '../../components/Plot'
import { t } from '../../i18n'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0)

// Defaults mirror the Dash compound page (principal 0, 500/mo, 120 months, 10%).
const DEFAULTS = { principal: '0', deposit: '500', period: '120', rate: '10', compounding: 'Annually' }

export function CompoundPage() {
  const settings = useSettings()
  const goalsCfg = useLiveQuery(() => getGoals(), [])
  const [theme] = useTheme()
  const currency = settings.baseCurrency

  const [principal, setPrincipal] = useState(DEFAULTS.principal)
  const [deposit, setDeposit] = useState(DEFAULTS.deposit)
  const [period, setPeriod] = useState(DEFAULTS.period)
  const [rate, setRate] = useState(DEFAULTS.rate)
  const [compounding, setCompounding] = useState(DEFAULTS.compounding)
  const [includeGoals, setIncludeGoals] = useState(false)

  // Goals in Financial-Goals rank order (object key order) with their factors.
  const goals: CompoundGoal[] = useMemo(() => {
    if (!includeGoals || !goalsCfg) return []
    return Object.keys(goalsCfg.goals).map((name) => [name, goalsCfg.goals[name], goalFactor(name, goalsCfg.factors)] as CompoundGoal)
  }, [includeGoals, goalsCfg])

  const sched = useMemo(
    () => computeSchedule(num(principal), num(deposit), Math.max(1, Math.round(num(period))), num(rate) / 100, compounding, goals),
    [principal, deposit, period, rate, compounding, goals],
  )

  const ui: UiColors = useMemo(
    () => ({
      ink: cssVar('--ink', '#e6e9ee'),
      muted: cssVar('--muted', '#8a94a6'),
      grid: cssVar('--border-soft', 'rgba(128,128,128,0.2)'),
      anno: cssVar('--surface-2', '#313d4e'),
    }),
    [theme],
  )

  const labels: CompoundLabels = {
    title: t('Growth over time'),
    months: t('Months'),
    month: t('Month'),
    value: (c) => t('Value ({currency})', { currency: c }),
    band: (lo, hi) => t('±20% rate ({lo}–{hi}%)', { lo: lo.toFixed(0), hi: hi.toFixed(0) }),
    maturity: (pct) => t('Maturity ({pct}%)', { pct: pct.toFixed(0) }),
    maturityShort: t('Maturity'),
    afterFactor: t('After buying (×factor)'),
    afterPlain: t('After buying (no factor)'),
    principal: t('Principal'),
    bought: (name, m) => t('{name} bought · month {month}', { name, month: m }),
  }

  const fig = useMemo(() => buildCompoundFigure(sched, { currency, goals, ui, labels }), [sched, currency, goals, ui])

  const money = (n: number) => <span className="money">{fmt(n)} {currency}</span>

  return (
    <div>
      <h1 className="h1">{t('Compound Interest')}</h1>
      <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
        {t('See how regular deposits grow over time. A learning tool — it does not use your tracked data.')}
      </p>

      <section className="card">
        <div className="calc-form">
          <label className="calc-field">
            <span>{t('Principal Amount')}</span>
            <input value={principal} onChange={(e) => setPrincipal(e.target.value)} type="number" inputMode="decimal" />
          </label>
          <label className="calc-field">
            <span>{t('Monthly Deposit')}</span>
            <input value={deposit} onChange={(e) => setDeposit(e.target.value)} type="number" inputMode="decimal" />
          </label>
          <label className="calc-field">
            <span>{t('Period (months)')}</span>
            <input value={period} onChange={(e) => setPeriod(e.target.value)} type="number" inputMode="numeric" min={1} />
          </label>
          <label className="calc-field">
            <span>{t('Annual Interest Rate (%)')}</span>
            <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" inputMode="decimal" />
          </label>
          <label className="calc-field">
            <span>{t('Compounding')}</span>
            <select value={compounding} onChange={(e) => setCompounding(e.target.value)}>
              {Object.keys(COMPOUNDING).map((c) => (
                <option key={c} value={c}>{t(c)}</option>
              ))}
            </select>
          </label>
        </div>

        {goalsCfg && Object.keys(goalsCfg.goals).length > 0 && (
          <label className="calc-toggle">
            <input type="checkbox" checked={includeGoals} onChange={(e) => setIncludeGoals(e.target.checked)} />
            <span>{t('Overlay my Financial Goals (buy each as it is reached)')}</span>
          </label>
        )}
        {includeGoals && goals.length === 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {t('No goals yet — add some in ')}
            <Link to="/goals" className="inline-link">{t('Financial Goals')}</Link>.
          </p>
        )}
      </section>

      <section className="card">
        <div className="calc-totals">
          <div className="calc-total">
            <span className="calc-total-label">{t('Total contributions')}</span>
            <span className="calc-total-value">{money(sched.totalPrincipal)}</span>
          </div>
          <div className="calc-total">
            <span className="calc-total-label">{t('Maturity value')}</span>
            <span className="calc-total-value accent">{money(sched.maturityValue)}</span>
          </div>
          <div className="calc-total">
            <span className="calc-total-label">{t('Interest earned')}</span>
            <span className="calc-total-value">{money(sched.interest)}</span>
          </div>
          <div className="calc-total">
            <span className="calc-total-label">{t('Effective APY')}</span>
            <span className="calc-total-value">{(sched.apy * 100).toFixed(2)}%</span>
          </div>
        </div>
      </section>

      <section className="card">
        <Plot data={fig.data} layout={fig.layout} ariaLabel={t('Growth over time')} style={{ width: '100%' }} />
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {t('Totals are taken at the set period; drag the chart to scroll past it.')}
        </p>
      </section>
    </div>
  )
}
