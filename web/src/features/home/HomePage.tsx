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

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

export function HomePage() {
  const all = useLiveTxns()
  const accounts = useAccounts()
  const currency = useBaseCurrency()
  const [censor] = useCensor()

  const nw = useMemo(() => netWorth(all), [all])
  const balances = useMemo(() => accountBalances(all), [all])

  // Default money-flow figure (2 months history + 1 month forecast).
  const { fig } = useMoneyFlow()

  // Current-month budget summary for the "This period" bars.
  const bcfg = useLiveQuery(() => getBudget(), [])
  const budgetSummary = useMemo(
    () => (bcfg ? monthBudgetSummary(all, bcfg, currentMonthKey()) : null),
    [all, bcfg],
  )

  // Configured accounts in order, then any stray account that still holds money.
  const acctRows = useMemo(() => {
    const known = new Set(accounts)
    const extra = Object.keys(balances).filter((a) => !known.has(a) && balances[a] !== 0)
    return [...accounts, ...extra].map((a) => [a, balances[a] ?? 0] as [string, number])
  }, [accounts, balances])

  return (
    <div className="home">
      {/* Net worth — masked as ****** in privacy mode (kept crisp, no CSS blur). */}
      <div className="card nw-hero">
        <div className="nw-label">{t('Net worth')}</div>
        <div className="nw-value">
          {censor ? '******' : fmt(nw)} <span className="nw-cur">{currency}</span>
        </div>
      </div>

      {/* Money flow: running balance + forward forecast (the default plot). */}
      <div className="card dash-card">
        <div className="dash-title">{t('Money Flow')}</div>
        <Plot data={fig.data} layout={fig.layout} config={FLOW_PLOT_CONFIG} ariaLabel={t('Money Flow')} style={{ width: '100%' }} />
      </div>

      {/* Budget — this period's 50/30/20 bars. */}
      {budgetSummary && (
        <section className="card budget-card">
          <div className="dash-title">{t('Budget')}</div>
          <ThisPeriodBudget summary={budgetSummary} censor={censor} />
        </section>
      )}

      {/* Savings pool gauge (Emergency Fund + ticked goals). */}
      <SavingsPoolGauge />

      {/* Per-account balances. */}
      <div className="card dash-card">
        <div className="dash-title">{t('Account balances')}</div>
        {acctRows.map(([name, bal]) => (
          <div key={name} className="acct-row">
            <span>{name}</span>
            <span className="money">{fmt(bal)}</span>
          </div>
        ))}
      </div>

      <p className="muted">{t('Your data is stored on this device only.')}</p>
    </div>
  )
}
