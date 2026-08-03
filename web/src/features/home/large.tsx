// The full-width Home boxes. Each one loads its own data via the shared hooks,
// so the registry can mount any subset in any order without HomePage having to
// know what a widget needs.
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useAccounts, useBaseCurrency } from '../transactions/useConfig'
import { useCensor } from '../../prefs'
import { currentMonthKey } from '../transactions/month'
import { accountBalances } from '../../lib/balances'
import { netWorth } from '../../lib/analytics/networth'
import { hiddenLiabilities } from '../../lib/analytics/debt'
import { monthBudgetSummary } from '../../lib/analytics/budget'
import { useMoneyFlow, FLOW_PLOT_CONFIG } from '../flow/useMoneyFlow'
import { ThisPeriodBudget } from '../budget/ThisPeriodBudget'
import { SavingsPoolGauge } from '../goals/SavingsPoolGauge'
import { Plot } from '../../components/Plot'
import { compactAmount } from '../../lib/format'
import { useLimits } from './useLimits'
import { useGoalSavings } from './useGoalSavings'
import { useDebts } from '../debts/useDebts'
import { DsrMeter } from '../debts/DsrMeter'
import { TONE_COLOR } from '../budget/tone'
import { Ring } from './small/Ring'
import { EMERGENCY_FUND } from '../../data/defaults'
import { t } from '../../i18n'

export const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

// Net worth — masked (bullets + blur) in privacy mode via the .money class.
export function NetWorthHero() {
  const all = useLiveTxns()
  const currency = useBaseCurrency()
  const debts = useDebts()
  // A linked debt is an account and is already in `netWorth` as a negative
  // balance; only standalone debts have to be taken off by hand. See
  // hiddenLiabilities — subtracting the linked ones too would double-count them.
  const nw = useMemo(
    () => netWorth(all) - hiddenLiabilities(debts?.standings ?? []),
    [all, debts],
  )
  return (
    <>
      <div className="nw-label">{t('Net worth')}</div>
      <div className="nw-value">
        <span className="money">{fmt(nw)}</span> <span className="nw-cur">{currency}</span>
      </div>
    </>
  )
}

// Money flow: running balance + forward forecast (the default plot).
export function FlowWidget() {
  const { fig } = useMoneyFlow()
  return (
    <Plot
      data={fig.data} layout={fig.layout} config={FLOW_PLOT_CONFIG}
      ariaLabel={t('Money Flow')} style={{ width: '100%' }}
    />
  )
}

// This period's 50/30/20 bars.
export function BudgetWidget() {
  const all = useLiveTxns()
  const [censor] = useCensor()
  const bcfg = useLiveQuery(() => getBudget(), [])
  const summary = useMemo(
    () => (bcfg ? monthBudgetSummary(all, bcfg, currentMonthKey()) : null),
    [all, bcfg],
  )
  if (!summary) return null
  return <ThisPeriodBudget summary={summary} censor={censor} hidePeriodLabel />
}

// Savings pool gauge (Emergency Fund + ticked goals).
export function PoolWidget() {
  return <SavingsPoolGauge bare />
}

// The spending limits nearest to being blown, worst first.
const LIMITS_SHOWN = 4

export function LimitsWidget() {
  const limits = useLimits()
  const [censor] = useCensor()
  if (!limits) return null
  if (limits.statuses.length === 0) {
    return <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t('No limits set yet.')}</p>
  }

  const shown = limits.statuses.slice(0, LIMITS_SHOWN)
  const rest = limits.statuses.length - shown.length
  return (
    <>
      {shown.map((s) => {
        const over = s.remaining < 0
        return (
          <div key={s.key} className="budget-row limit-row">
            <div className="budget-row-head">
              <span className="budget-row-name">
                {s.remaining <= limits.warnAt && <span className="limit-warn" aria-hidden="true">⚠ </span>}
                {s.label}
              </span>
              <span className="budget-row-note">
                <span className={over ? 'amt-expense' : ''} style={{ fontWeight: 600 }}>
                  <span className="money">{censor ? '•••' : compactAmount(Math.abs(s.remaining))}</span>
                  {' '}{t(over ? 'over' : 'left')}
                </span>
              </span>
            </div>
            <div className="budget-bar">
              <div className={`budget-bar-fill ${s.tone}`}
                style={{ width: `${Math.min(100, Math.max(0, s.ratio * 100)).toFixed(0)}%` }} />
            </div>
          </div>
        )
      })}
      {rest > 0 && (
        <p className="muted" style={{ fontSize: 12, textAlign: 'center', margin: '10px 0 0' }}>
          {t('+{n} more', { n: rest })}
        </p>
      )}
    </>
  )
}

// Per-account balances: configured accounts in order, then any stray account
// that still holds money.
export function AccountsWidget() {
  const all = useLiveTxns()
  const accounts = useAccounts()
  const balances = useMemo(() => accountBalances(all), [all])
  const rows = useMemo(() => {
    const known = new Set(accounts)
    const extra = Object.keys(balances).filter((a) => !known.has(a) && balances[a] !== 0)
    return [...accounts, ...extra].map((a) => [a, balances[a] ?? 0] as [string, number])
  }, [accounts, balances])
  return (
    <>
      {rows.map(([name, bal]) => (
        <div key={name} className="acct-row">
          <span>{name}</span>
          <span className="money">{fmt(bal)}</span>
        </div>
      ))}
    </>
  )
}

// Per-goal savings: how the pool is split between goals, plus what's left to
// assign. Rings follow the user's own goal order (Emergency Fund first, then the
// drag-ordered list) rather than a ranking — that order IS the priority they set.
const GOAL_RINGS_SHOWN = 4

export function GoalSavingsWidget() {
  const data = useGoalSavings()
  const [censor] = useCensor()
  const currency = useBaseCurrency()
  if (!data) return null

  const shown = data.standings.slice(0, GOAL_RINGS_SHOWN)
  const rest = data.standings.length - shown.length
  const short = data.unallocated < 0
  const money = (n: number) => (censor ? '•••' : compactAmount(n))

  return (
    <>
      <div className="gs-rings">
        {shown.map((s) => {
          const pct = Math.round(s.ratio * 100)
          return (
            <div key={s.name} className="gs-ring">
              <Ring
                pct={pct}
                color={TONE_COLOR[s.tone]}
                label={censor ? '•••' : `${pct}%`}
                ariaLabel={t('{name}: {pct}% funded', { name: s.name, pct: String(pct) })}
              />
              <span className="gs-ring-name">{s.isEmergencyFund ? t(EMERGENCY_FUND) : s.name}</span>
              <span className="gs-ring-amt money">{money(s.allocated)}</span>
            </div>
          )
        })}
      </div>
      {rest > 0 && (
        <p className="muted" style={{ fontSize: 12, textAlign: 'center', margin: '6px 0 0' }}>
          {t('+{n} more', { n: rest })}
        </p>
      )}
      <div className={`gs-widget-foot${short ? ' is-short' : ''}`}>
        <span>{t('Unallocated')}</span>
        <span className={`money${short ? ' amt-expense' : ''}`}>
          {money(data.unallocated)} {currency}
        </span>
      </div>
    </>
  )
}

// Debts: what is owed, what share of income it takes, and what to pay next.
// Three lines rather than a chart — on Home the question is "am I all right?",
// and the page itself is one tap away for the answer to "what should I do?".
export function DebtsWidget() {
  const view = useDebts()
  const [censor] = useCensor()
  if (!view) return null

  if (view.standings.length === 0) {
    return <span className="muted" style={{ fontSize: 12 }}>{t('No debts tracked.')}</span>
  }

  const next = view.ranked.find((s) => s.balance > 0)
  const money = (n: number) => (censor ? '•••' : `${fmt(n)} ${view.currency}`)

  return (
    <>
      <div className="debt-owed">
        <span className="debt-owed-amount money">{money(view.owed)}</span>
        <span className="muted debt-owed-note">{t('owed')}</span>
      </div>
      {view.income > 0 && (
        <>
          <div className="debt-dsr-line">
            <span className="muted">{t('Debt payments')}</span>
            <span>{t('{pct}% of income', { pct: view.dsr.toFixed(0) })}</span>
          </div>
          <DsrMeter pct={view.dsr} tone={view.tone} />
        </>
      )}
      {next && (
        <div className="debt-dsr-line">
          <span className="muted">{t('Pay next')}</span>
          <span>{next.debt.name}</span>
        </div>
      )}
    </>
  )
}
