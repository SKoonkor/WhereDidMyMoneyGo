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
import { monthBudgetSummary } from '../../lib/analytics/budget'
import { useMoneyFlow, FLOW_PLOT_CONFIG } from '../flow/useMoneyFlow'
import { ThisPeriodBudget } from '../budget/ThisPeriodBudget'
import { SavingsPoolGauge } from '../goals/SavingsPoolGauge'
import { Plot } from '../../components/Plot'
import { t } from '../../i18n'

export const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

// Net worth — masked (bullets + blur) in privacy mode via the .money class.
export function NetWorthHero() {
  const all = useLiveTxns()
  const currency = useBaseCurrency()
  const nw = useMemo(() => netWorth(all), [all])
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
