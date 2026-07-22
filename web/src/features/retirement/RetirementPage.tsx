import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getGoals, getRetirementInputs, saveRetirementInputs } from '../../db'
import { DEFAULT_RETIREMENT } from '../../data/defaults'
import { Modal } from '../../components/Modal'
import { useSettings } from '../transactions/useConfig'
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
// Compact money: 12.22M / 72.82k / 350. Returns just the number+suffix (no currency).
function abbrevNum(n: number, unit?: 'M' | 'k' | ''): string {
  const u = unit ?? (Math.abs(n) >= 1e6 ? 'M' : Math.abs(n) >= 1e3 ? 'k' : '')
  if (u === 'M') return (n / 1e6).toFixed(2) + 'M'
  if (u === 'k') return (n / 1e3).toFixed(2) + 'k'
  return String(Math.round(n))
}
// A lo–hi money range sharing one unit (picked from the larger bound), suffixed once.
function moneyRange(lo: number, hi: number, currency: string): string {
  const m = Math.max(Math.abs(lo), Math.abs(hi))
  const unit: 'M' | 'k' | '' = m >= 1e6 ? 'M' : m >= 1e3 ? 'k' : ''
  return `(${abbrevNum(lo, unit)}–${abbrevNum(hi, unit)} ${currency})`
}
const yrRange = (lo: number, hi: number) => `(${Math.round(lo)}–${Math.round(hi)} ${t('yo')})`
// Compact money range for the narrow strategy columns: no currency, one unit.
function moneyRangeCompact(lo: number, hi: number): string {
  const m = Math.max(Math.abs(lo), Math.abs(hi))
  const unit: 'M' | 'k' | '' = m >= 1e6 ? 'M' : m >= 1e3 ? 'k' : ''
  const f = (n: number) => (unit === 'M' ? (n / 1e6).toFixed(1) : unit === 'k' ? String(Math.round(n / 1e3)) : String(Math.round(n)))
  return `(${f(lo)}–${f(hi)}${unit})`
}
// Age range that tolerates a null (censored-past-life) bound → "85+".
function ageRangeText(lo: number | null | undefined, hi: number | null | undefined, life: number, withUnit: boolean): string | undefined {
  if (lo == null && hi == null) return undefined
  const loS = lo == null ? `${Math.round(life)}+` : `${Math.round(lo)}`
  const hiS = hi == null ? `${Math.round(life)}+` : `${Math.round(hi)}`
  return `(${loS}–${hiS}${withUnit ? ` ${t('yo')}` : ''})`
}
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0)

// Only zoom in/out on the trajectory plot's modebar (no pan/select/reset/logo).
const PLOT_CONFIG = { displayModeBar: true, displaylogo: false, modeBarButtons: [['zoomIn2d', 'zoomOut2d']] }

// Defaults mirror the Dash retirement mode (RETIRE_DEFAULTS); shared with the
// config store so "Reset inputs" and first-run seeding agree.
const D = DEFAULT_RETIREMENT

export function RetirementPage() {
  const settings = useSettings()
  const currency = settings.baseCurrency
  const goalsCfg = useLiveQuery(() => getGoals(), [])
  const [theme] = useTheme()

  const [open, setOpen] = useState(false)
  const [goalBoxOpen, setGoalBoxOpen] = useState(true)
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
  const [showReal, setShowReal] = useState(D.showReal)
  const [includeGoals, setIncludeGoals] = useState(D.includeGoals)
  // Which goals to overlay; null = all of them (the default when goals first load).
  const [picked, setPicked] = useState<string[] | null>(D.picked)
  const [useMc, setUseMc] = useState(D.useMc)
  const [volReturn, setVolReturn] = useState(D.volReturn)
  const [volInfl, setVolInfl] = useState(D.volInfl)
  const [volDeposit, setVolDeposit] = useState(D.volDeposit)
  // Hydration gate: don't persist until the stored inputs have loaded, so the
  // initial default render can't clobber what the user saved last time.
  const [hydrated, setHydrated] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Assemble the current inputs into one persistable object.
  const inputs = useMemo(
    () => ({
      curAge, retAge, life, principal, deposit, increase, rate, infl, bonus, pension, expense,
      showReal, includeGoals, useMc, picked, volReturn, volInfl, volDeposit,
    }),
    [curAge, retAge, life, principal, deposit, increase, rate, infl, bonus, pension, expense, showReal, includeGoals, useMc, picked, volReturn, volInfl, volDeposit],
  )

  // Apply a stored/default snapshot to every field at once.
  const applyInputs = (v: typeof DEFAULT_RETIREMENT) => {
    setCurAge(v.curAge); setRetAge(v.retAge); setLife(v.life)
    setPrincipal(v.principal); setDeposit(v.deposit); setIncrease(v.increase)
    setRate(v.rate); setInfl(v.infl); setBonus(v.bonus); setPension(v.pension); setExpense(v.expense)
    setShowReal(v.showReal); setIncludeGoals(v.includeGoals); setUseMc(v.useMc); setPicked(v.picked)
    setVolReturn(v.volReturn); setVolInfl(v.volInfl); setVolDeposit(v.volDeposit)
  }

  // Load saved inputs once on mount.
  useEffect(() => {
    let cancelled = false
    getRetirementInputs().then((v) => {
      if (cancelled) return
      applyInputs(v)
      setHydrated(true)
    })
    return () => { cancelled = true }
  }, [])

  // Persist on every change once hydrated (Reset writes defaults through here too).
  useEffect(() => {
    if (hydrated) void saveRetirementInputs(inputs)
  }, [hydrated, inputs])

  const doReset = () => { applyInputs(DEFAULT_RETIREMENT); setConfirmReset(false) }

  const allGoalNames = useMemo(() => (goalsCfg ? Object.keys(goalsCfg.goals) : []), [goalsCfg])
  const pickedSet = useMemo(() => new Set(picked ?? allGoalNames), [picked, allGoalNames])

  const goals: CompoundGoal[] = useMemo(() => {
    if (!includeGoals || !goalsCfg) return []
    // Keep goal priority = rank order (object-key order), independent of pick order.
    return allGoalNames
      .filter((n) => pickedSet.has(n))
      .map((n) => [n, goalsCfg.goals[n], goalFactor(n, goalsCfg.factors)] as CompoundGoal)
  }, [includeGoals, goalsCfg, allGoalNames, pickedSet])

  const toggleGoal = (name: string) => {
    const cur = picked ?? allGoalNames
    setPicked(cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name])
  }

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
    afterFactor: t('use ×Time rule'), afterPlain: t('buy immediately'),
    factorToday: t("Today's money"), retire: t('Retirement age'), freedom: t('Financial freedom'),
    depleted: t('Funds depleted'), bought: (name, age) => t('{name} bought · age {age}', { name, age }),
    medianSuffix: t(' (median)'), success: (pct) => t('Success: {pct}%', { pct }),
  }

  const fig = useMemo(
    () => (mc ? buildRetirementMcFigure(mc, { currency, showReal, hasGoals: res.hasGoals, retirementAge: res.retirementAge, lifeExpectancy: res.lifeExpectancy, ui, labels }) : buildRetirementFigure(res, { currency, showReal, ui, labels })),
    [mc, res, currency, showReal, ui],
  )

  const money = (n: number) => `${abbrevNum(n)} ${currency}`
  const yo = (a: number) => `${a.toFixed(0)} ${t('yo')}`
  const goalsExist = goalsCfg && Object.keys(goalsCfg.goals).length > 0

  return (
    <div>
      <h1 className="h1">{t('Retirement Planning')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 12 }}>
        {t('Project a full retirement plan: save, retire, then draw down against inflating expenses.')}
      </p>

      {/* ── Plan settings (collapsible): Ages · Pre-retirement · Post-retirement ── */}
      <section className="card budget-card budget-settings">
        <button type="button" className="budget-settings-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="dash-title" style={{ margin: 0 }}>{t('Plan settings')}</span>
          <span className="budget-settings-caret">{open ? '⌃' : '⌄'}</span>
        </button>
        <div className={open ? 'budget-settings-body open' : 'budget-settings-body'}>
          <div className="budget-settings-inner">
            <h3 className="ret-group-title">{t('Ages')}</h3>
            <div className="calc-form">
              <Field label={t('Current age')} value={curAge} set={setCurAge} numeric unit={t('yr')} />
              <Field label={t('Retirement age')} value={retAge} set={setRetAge} numeric unit={t('yr')} />
              <Field label={t('Life expectancy')} value={life} set={setLife} numeric unit={t('yr')} />
            </div>

            <h3 className="ret-group-title">{t('Pre-retirement')}</h3>
            <div className="calc-form">
              <Field label={t('Principal Amount')} value={principal} set={setPrincipal} unit={currency} />
              <Field label={t('Monthly Deposit')} value={deposit} set={setDeposit} unit={currency} />
              <Field label={t('Yearly raise (%)')} value={increase} set={setIncrease} />
              <Field label={t('Annual Interest Rate (%)')} value={rate} set={setRate} />
              <Field label={t('Inflation (%)')} value={infl} set={setInfl} />
            </div>

            <h3 className="ret-group-title">{t('Post-retirement')}</h3>
            <div className="calc-form">
              <Field label={t('Retirement bonus')} value={bonus} set={setBonus} unit={currency} />
              <Field label={t('Monthly pension')} value={pension} set={setPension} unit={currency} />
              <Field label={t('Monthly expense (today)')} value={expense} set={setExpense} unit={currency} />
            </div>

            <button type="button" className="btn budget-settings-collapse" onClick={() => setOpen(false)}>
              {t('Collapse settings')}
            </button>
          </div>
        </div>
      </section>

      {/* ── Plot options (outside the settings box) ── */}
      <section className="card">
        <label className="calc-toggle">
          <input type="checkbox" checked={showReal} onChange={(e) => setShowReal(e.target.checked)} />
          <span>{t("Show today's money (inflation-adjusted)")}</span>
        </label>
        {goalsExist && (
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

      {/* ── Trajectory plot ── */}
      <section className="card">
        <Plot data={fig.data} layout={fig.layout} config={PLOT_CONFIG} ariaLabel={t('Retirement projection')} style={{ width: '100%' }} />
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

      {/* ── Goals to overlay (collapsible): pick which goals to draw ── */}
      {includeGoals && goalsExist && (
        <section className="card budget-card budget-settings">
          <button type="button" className="budget-settings-head" aria-expanded={goalBoxOpen} onClick={() => setGoalBoxOpen((o) => !o)}>
            <span className="dash-title" style={{ margin: 0 }}>{t('Goals to overlay')}</span>
            <span className="budget-settings-caret">{goalBoxOpen ? '⌃' : '⌄'}</span>
          </button>
          <div className={goalBoxOpen ? 'budget-settings-body open' : 'budget-settings-body'}>
            <div className="budget-settings-inner">
              {allGoalNames.map((name) => (
                <label key={name} className="calc-toggle">
                  <input type="checkbox" checked={pickedSet.has(name)} onChange={() => toggleGoal(name)} />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Summary (Python-style results block) ── */}
      <ResultsBlock res={res} mc={mc} money={money} yo={yo} currency={currency} />

      {/* ── Reset inputs (guarded by a confirmation modal) ── */}
      <button type="button" className="btn ret-reset" onClick={() => setConfirmReset(true)}>
        {t('Reset inputs')}
      </button>
      {confirmReset && (
        <Modal title={t('Reset inputs?')} onClose={() => setConfirmReset(false)}>
          <p className="muted" style={{ margin: '4px 0 16px' }}>
            {t('This clears everything you entered and restores the default values. This cannot be undone.')}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirmReset(false)}>{t('Cancel')}</button>
            <button type="button" className="btn solid-danger" onClick={doReset}>{t('Reset inputs')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Key/value results, plus a strategy comparison table when goals are overlaid.
// Uncertainty ranges (from the Monte-Carlo bands) show only when `mc` is present.
function ResultsBlock({ res, mc, money, yo, currency }: {
  res: ReturnType<typeof computeRetirement>
  mc: ReturnType<typeof simulateRetirementMc> | null
  money: (n: number) => string
  yo: (a: number) => string
  currency: string
}) {
  const goals = res.hasGoals
  const last = res.balanceReal.length - 1

  // Deterministic base (goal-factor strategy when goals are overlaid).
  const potBase = goals ? res.summaryFactor!.potAtRetirement : res.balanceAtRetirement
  const coveredBase = goals ? res.summaryFactor!.covered : res.covered
  const depAgeBase = goals ? res.summaryFactor!.depletionAge : res.depletionAge
  const endBase = goals ? res.summaryFactor!.endingReal : res.endingReal

  // Monte-Carlo overrides pick the median (p50) path + a 16–84% range.
  const potBand = mc ? (mc.factorNominal ?? mc.nominal) : null
  const endBand = mc ? (mc.factorReal ?? mc.real) : null
  const potShown = potBand ? potBand.p50[res.retireMonth] : potBase
  const potRange = potBand ? moneyRange(potBand.p16[res.retireMonth], potBand.p84[res.retireMonth], currency) : undefined
  const freedomShown = mc ? mc.freedom?.p50 ?? null : res.financialFreedomAge
  const freedomRange = mc && mc.freedom ? yrRange(mc.freedom.p16, mc.freedom.p84) : undefined
  const covered = mc ? mc.depletion === null || mc.depletion.p50 === null : coveredBase
  const depAge = mc ? mc.depletion?.p50 ?? null : depAgeBase
  const depRange = mc && !covered ? ageRangeText(mc.depletion?.p16, mc.depletion?.p84, res.lifeExpectancy, true) : undefined
  const endReal = endBand ? endBand.p50[last] : endBase
  const endRange = endBand ? moneyRange(endBand.p16[last], endBand.p84[last], currency) : undefined
  const expShown = mc?.expenseAtRetirement ? mc.expenseAtRetirement.p50 : res.expenseAtRetirement
  const expRange = mc?.expenseAtRetirement ? moneyRange(mc.expenseAtRetirement.p16, mc.expenseAtRetirement.p84, currency) : undefined

  return (
    <section className="card">
      <h2 className="dash-title" style={{ marginTop: 0 }}>{t('Summary')}</h2>
      {mc && (
        <Metric label={t('Plan succeeds')} value={t('{prob} of {n} runs', { prob: `${(mc.successProb * 100).toFixed(0)}%`, n: mc.nMc })} accent />
      )}
      {/* Pot / Outcome / Ending live in the strategy table once goals are overlaid. */}
      {!goals && <Metric label={t('Pot at retirement')} value={money(potShown)} range={potRange} accent />}
      <Metric label={t('Monthly expense at retirement')} value={money(expShown)} range={expRange} />
      <Metric label={t('Pension (monthly)')} value={money(res.pension)} />
      <Metric label={t('Years in retirement')} value={res.yearsInRetirement.toFixed(0)} />
      <Metric label={t('Financial freedom')} value={freedomShown != null ? yo(freedomShown) : t('Not reached')} range={freedomShown != null ? freedomRange : undefined} />
      <Metric label={t('Total contributions')} value={money(res.totalContributions)} />
      {!goals && (
        <OutcomeMetric
          covered={covered}
          age={covered ? res.lifeExpectancy : depAge ?? res.lifeExpectancy}
          range={covered ? undefined : depRange}
          yo={yo}
        />
      )}
      {!goals && covered && <Metric label={t('Ending (today’s money)')} value={money(endReal)} range={endRange} />}

      {goals && <StrategyTable res={res} mc={mc} money={money} yo={yo} />}
    </section>
  )
}

function StrategyTable({ res, mc, money, yo }: {
  res: ReturnType<typeof computeRetirement>
  mc: ReturnType<typeof simulateRetirementMc> | null
  money: (n: number) => string
  yo: (a: number) => string
}) {
  const f = res.summaryFactor!
  const p = res.summaryPlain!
  const names = res.goalNames ?? []
  const life = res.lifeExpectancy
  const rm = res.retireMonth

  // Pot at retirement: median + 16–84% money range under Monte Carlo.
  const potCell = (det: number, band?: { p16: number[]; p50: number[]; p84: number[] }) =>
    band ? { value: money(band.p50[rm]), range: moneyRangeCompact(band.p16[rm], band.p84[rm]) } : { value: money(det), range: undefined }

  // Per-goal age: median + range from that strategy's goal events under Monte Carlo.
  const goalCell = (name: string, detHits: NonNullable<typeof res.goalHitsFactor>, events?: NonNullable<typeof mc>['goalEvents']) => {
    if (mc && events) {
      const ev = events.find((e) => e.name === name)
      if (ev && ev.p50 != null) return { value: yo(ev.p50), range: ageRangeText(ev.p16, ev.p84, life, false), tone: '' }
      return { value: t('not reached'), range: undefined, tone: 'amt-expense' }
    }
    const hit = detHits.find((h) => h.name === name)
    return hit ? { value: yo(hit.age), range: undefined, tone: '' } : { value: t('not reached'), range: undefined, tone: 'amt-expense' }
  }

  // Outcome: two-line cell (phrase + age), with an age range under Monte Carlo.
  const outcomeCell = (detCovered: boolean, detDepAge: number | null, dep?: { p16: number | null; p50: number | null; p84: number | null } | null) => {
    if (mc) {
      const covered = !dep || dep.p50 == null
      return { covered, age: covered ? life : dep!.p50!, range: covered ? undefined : ageRangeText(dep!.p16, dep!.p84, life, false) }
    }
    return { covered: detCovered, age: detCovered ? life : detDepAge ?? life, range: undefined }
  }
  const fOut = outcomeCell(f.covered, f.depletionAge, mc?.depletion)
  const pOut = outcomeCell(p.covered, p.depletionAge, mc?.depletionPlain)

  return (
    <div className="subcat-table" style={{ marginTop: 14 }}>
      <div className="subcat-grid subcat-head">
        <span className="subcat-name">{t('If goals bought')}</span>
        <span className="subcat-col">{t('×Time rule')}</span>
        <span className="subcat-col">{t('Buy immediately')}</span>
      </div>
      <div className="subcat-grid subcat-group">
        <span className="subcat-name">{t('Pot at retirement')}</span>
        <SCell {...potCell(f.potAtRetirement, mc?.factorNominal)} />
        <SCell {...potCell(p.potAtRetirement, mc?.plainNominal)} />
      </div>
      <div className="subcat-grid subcat-row">
        <span className="subcat-name">{t('Spent on goals')}</span>
        <span className="subcat-col muted">{money(f.totalSpent)}</span>
        <span className="subcat-col muted">{money(p.totalSpent)}</span>
      </div>
      {names.map((name) => {
        const fa = goalCell(name, res.goalHitsFactor!, mc?.goalEvents)
        const pa = goalCell(name, res.goalHitsPlain!, mc?.goalEventsPlain)
        return (
          <div key={name} className="subcat-grid subcat-row">
            <span className="subcat-name">{name}</span>
            <SCell value={fa.value} range={fa.range} tone={fa.tone} />
            <SCell value={pa.value} range={pa.range} tone={pa.tone} />
          </div>
        )
      })}
      <div className="subcat-grid subcat-group">
        <span className="subcat-name">{t('Outcome')}</span>
        <SOutcome {...fOut} yo={yo} />
        <SOutcome {...pOut} yo={yo} />
      </div>
      <div className="subcat-grid subcat-row">
        <span className="subcat-name">{t('Ending (today’s money)')}</span>
        <span className="subcat-col muted">{money(f.endingReal)}</span>
        <span className="subcat-col muted">{money(p.endingReal)}</span>
      </div>
    </div>
  )
}

// A strategy-table cell: a value with an optional muted range sub-line beneath it.
function SCell({ value, range, tone }: { value: string; range?: string; tone?: string }) {
  return (
    <span className={`subcat-col ${tone ?? ''}`}>
      <span className="subcat-val">{value}</span>
      {range && <span className="subcat-range">{range}</span>}
    </span>
  )
}

// Outcome cell: a coloured phrase, the age, then an optional range sub-line.
function SOutcome({ covered, age, range, yo }: { covered: boolean; age: number; range?: string; yo: (a: number) => string }) {
  return (
    <span className="subcat-col">
      <span className={`subcat-phrase ${covered ? 'amt-income' : 'amt-expense'}`}>{covered ? t('Funds last through') : t('Funds run out')}</span>
      <span className="subcat-val">{yo(age)}</span>
      {range && <span className="subcat-range">{range}</span>}
    </span>
  )
}

// A label + a right-aligned value, with an optional uncertainty range centred on a
// muted sub-line beneath the value.
function Metric({ label, value, range, tone, accent }: { label: string; value: string; range?: string; tone?: string; accent?: boolean }) {
  return (
    <div className="ret-row">
      <span className="ret-row-label">{label}</span>
      <span className="ret-metric">
        <span className={`ret-metric-value${accent ? ' accent' : ''}${tone ? ` ${tone}` : ''}`}>{value}</span>
        {range && <span className="ret-metric-range">{range}</span>}
      </span>
    </div>
  )
}

// Outcome: a coloured phrase on line 1, then the age (+ range) as a normal metric.
function OutcomeMetric({ covered, age, range, yo }: { covered: boolean; age: number; range?: string; yo: (a: number) => string }) {
  return (
    <div className="ret-row">
      <span className="ret-row-label">{t('Outcome')}</span>
      <span className="ret-metric">
        <span className={`ret-metric-phrase ${covered ? 'amt-income' : 'amt-expense'}`}>
          {covered ? t('Funds last through') : t('Funds run out')}
        </span>
        <span className="ret-metric-value">{yo(age)}</span>
        {range && <span className="ret-metric-range">{range}</span>}
      </span>
    </div>
  )
}

function Field({ label, value, set, numeric, wide, unit }: { label: string; value: string; set: (v: string) => void; numeric?: boolean; wide?: boolean; unit?: string }) {
  return (
    <label className={`calc-field${wide ? ' wide' : ''}`}>
      <span>{label}{unit ? <span className="calc-unit"> ({unit})</span> : null}</span>
      <input value={value} onChange={(e) => set(e.target.value)} type="number" inputMode={numeric ? 'numeric' : 'decimal'} />
    </label>
  )
}
