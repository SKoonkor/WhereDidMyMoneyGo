import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getGoals } from '../../db'
import { useTheme } from '../../prefs'
import { goalFactor } from '../../lib/analytics/goals'
import { computeRetirement } from '../../lib/analytics/retirement'
import { simulateRetirementMc } from '../../lib/analytics/retirement_mc'
import type { CompoundGoal } from '../../lib/analytics/compound'
import { buildRetirementFigure, buildRetirementMcFigure, type RetUi, type RetLabels } from './retirementFigure'
import { Plot } from '../../components/Plot'
import { t } from '../../i18n'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0)

// Defaults mirror the Dash retirement mode (RETIRE_DEFAULTS).
const D = {
  curAge: '30', retAge: '60', life: '85', principal: '0', deposit: '10000',
  increase: '3', rate: '6', infl: '3', bonus: '0', pension: '0', expense: '30000',
}

export function RetirementSection({ currency }: { currency: string }) {
  const goalsCfg = useLiveQuery(() => getGoals(), [])
  const [theme] = useTheme()

  const [curAge, setCurAge] = useState(D.curAge)
  const [retAge, setRetAge] = useState(D.retAge)
  const [life, setLife] = useState(D.life)
  const [principal, setPrincipal] = useState(D.principal)
  const [deposit, setDeposit] = useState(D.deposit)
  const [increase, setIncrease] = useState(D.increase)
  const [rate, setRate] = useState(D.rate)
  const [infl, setInfl] = useState(D.infl)
  const [bonus, setBonus] = useState(D.bonus)
  const [pension, setPension] = useState(D.pension)
  const [expense, setExpense] = useState(D.expense)
  const [showReal, setShowReal] = useState(true)
  const [includeGoals, setIncludeGoals] = useState(false)
  const [useMc, setUseMc] = useState(false)
  const [volReturn, setVolReturn] = useState('15')
  const [volInfl, setVolInfl] = useState('1')
  const [volDeposit, setVolDeposit] = useState('2')

  const goals: CompoundGoal[] = useMemo(() => {
    if (!includeGoals || !goalsCfg) return []
    return Object.keys(goalsCfg.goals).map((n) => [n, goalsCfg.goals[n], goalFactor(n, goalsCfg.factors)] as CompoundGoal)
  }, [includeGoals, goalsCfg])

  const res = useMemo(
    () => computeRetirement({
      currentAge: num(curAge), retirementAge: num(retAge), lifeExpectancy: num(life),
      principal: num(principal), monthlyDeposit: num(deposit), increasement: num(increase) / 100,
      annualRate: num(rate) / 100, inflation: num(infl) / 100, retirementBonus: num(bonus),
      pension: num(pension), expense: num(expense), goals,
    }),
    [curAge, retAge, life, principal, deposit, increase, rate, infl, bonus, pension, expense, goals],
  )

  const ui: RetUi = useMemo(
    () => ({
      ink: cssVar('--ink', '#e6e9ee'),
      muted: cssVar('--muted', '#8a94a6'),
      grid: cssVar('--border-soft', 'rgba(128,128,128,0.2)'),
      anno: cssVar('--surface-2', '#313d4e'),
    }),
    [theme],
  )

  const mc = useMemo(() => {
    if (!useMc) return null
    return simulateRetirementMc({
      currentAge: num(curAge), retirementAge: num(retAge), lifeExpectancy: num(life),
      principal: num(principal), monthlyDeposit: num(deposit), increasement: num(increase) / 100,
      annualRate: num(rate) / 100, inflation: num(infl) / 100, retirementBonus: num(bonus),
      pension: num(pension), expense: num(expense), goals,
      volReturn: num(volReturn) / 100, volInflation: num(volInfl) / 100, volDeposit: num(volDeposit) / 100, nMc: 800,
    })
  }, [useMc, curAge, retAge, life, principal, deposit, increase, rate, infl, bonus, pension, expense, goals, volReturn, volInfl, volDeposit])

  const labels: RetLabels = {
    age: t('Age'), value: (c) => t('Value ({currency})', { currency: c }), yo: t('yo'),
    future: t('Future money'), today: t("Today's money"), withoutGoals: t('Without goals'),
    balanceFuture: t('Balance (future money)'), balanceToday: t("Balance (today's money)"),
    afterFactor: t('After buying (×factor)'), afterPlain: t('After buying (plain)'),
    factorToday: t("×factor (today's money)"), retire: t('Retire'), freedom: t('Financial freedom'),
    depleted: t('Funds depleted'), bought: (name, age) => t('{name} bought · age {age}', { name, age }),
    medianSuffix: t(' (median)'), success: (pct) => t('Success: {pct}%', { pct }),
  }

  const fig = useMemo(
    () => (mc ? buildRetirementMcFigure(mc, { currency, showReal, hasGoals: res.hasGoals, retirementAge: res.retirementAge, lifeExpectancy: res.lifeExpectancy, ui, labels }) : buildRetirementFigure(res, { currency, showReal, ui, labels })),
    [mc, res, currency, showReal, ui],
  )

  const money = (n: number) => <span className="money">{fmt(n)} {currency}</span>
  const potAtRetire = res.hasGoals ? res.summaryFactor!.potAtRetirement : res.balanceAtRetirement
  const covered = res.hasGoals ? res.summaryFactor!.covered : res.covered
  const depAge = res.hasGoals ? res.summaryFactor!.depletionAge : res.depletionAge
  const endReal = res.hasGoals ? res.summaryFactor!.endingReal : res.endingReal

  return (
    <>
      <section className="card">
        <div className="calc-form">
          <Field label={t('Current age')} value={curAge} set={setCurAge} numeric />
          <Field label={t('Retirement age')} value={retAge} set={setRetAge} numeric />
          <Field label={t('Life expectancy')} value={life} set={setLife} numeric />
          <Field label={t('Principal Amount')} value={principal} set={setPrincipal} />
          <Field label={t('Monthly Deposit')} value={deposit} set={setDeposit} />
          <Field label={t('Yearly raise (%)')} value={increase} set={setIncrease} />
          <Field label={t('Annual Interest Rate (%)')} value={rate} set={setRate} />
          <Field label={t('Inflation (%)')} value={infl} set={setInfl} />
          <Field label={t('Retirement bonus')} value={bonus} set={setBonus} />
          <Field label={t('Monthly pension')} value={pension} set={setPension} />
          <Field label={t('Monthly expense (today)')} value={expense} set={setExpense} wide />
        </div>
        <label className="calc-toggle">
          <input type="checkbox" checked={showReal} onChange={(e) => setShowReal(e.target.checked)} />
          <span>{t("Show today's money (inflation-adjusted)")}</span>
        </label>
        {goalsCfg && Object.keys(goalsCfg.goals).length > 0 && (
          <label className="calc-toggle">
            <input type="checkbox" checked={includeGoals} onChange={(e) => setIncludeGoals(e.target.checked)} />
            <span>{t('Overlay my Financial Goals (buy each as it is reached)')}</span>
          </label>
        )}
        <label className="calc-toggle">
          <input type="checkbox" checked={useMc} onChange={(e) => setUseMc(e.target.checked)} />
          <span>{t('Show market uncertainty (Monte Carlo)')}</span>
        </label>
        {useMc && (
          <div className="calc-form" style={{ marginTop: 10 }}>
            <Field label={t('Return volatility (%)')} value={volReturn} set={setVolReturn} />
            <Field label={t('Inflation volatility (%)')} value={volInfl} set={setVolInfl} />
            <Field label={t('Raise volatility (%)')} value={volDeposit} set={setVolDeposit} wide />
          </div>
        )}
      </section>

      <section className="card">
        <div className="calc-totals">
          <Total label={t('Pot at retirement')} value={money(potAtRetire)} accent />
          <Total label={t('Financial freedom')} value={res.financialFreedomAge != null ? `${res.financialFreedomAge.toFixed(0)} ${t('yo')}` : t('Not reached')} />
          <Total label={t('Funds last')} value={covered ? t('Beyond life expectancy') : `${t('until')} ${depAge!.toFixed(0)} ${t('yo')}`} />
          <Total label={t('Ending (today’s money)')} value={money(endReal)} />
        </div>
      </section>

      <section className="card">
        <Plot data={fig.data} layout={fig.layout} ariaLabel={t('Retirement projection')} style={{ width: '100%' }} />
        {includeGoals && goals.length === 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {t('No goals yet — add some in ')}
            <Link to="/goals" className="inline-link">{t('Financial Goals')}</Link>.
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {t('Deposits stop at retirement; expenses (today’s money) then inflate and draw down the pot.')}
        </p>
      </section>
    </>
  )
}

function Field({ label, value, set, numeric, wide }: { label: string; value: string; set: (v: string) => void; numeric?: boolean; wide?: boolean }) {
  return (
    <label className={`calc-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      <input value={value} onChange={(e) => set(e.target.value)} type="number" inputMode={numeric ? 'numeric' : 'decimal'} />
    </label>
  )
}

function Total({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="calc-total">
      <span className="calc-total-label">{label}</span>
      <span className={`calc-total-value${accent ? ' accent' : ''}`}>{value}</span>
    </div>
  )
}
