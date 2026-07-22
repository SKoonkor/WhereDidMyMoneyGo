import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { CollapsibleCard } from '../../components/CollapsibleCard'
import { Modal } from '../../components/Modal'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

export function HomePage() {
  const all = useLiveTxns()
  const accounts = useAccounts()
  const currency = useBaseCurrency()
  const [censor] = useCensor()
  const navigate = useNavigate()
  // Double-tapping a box asks whether to open that section's full page.
  const [navPrompt, setNavPrompt] = useState<{ label: string; to: string } | null>(null)

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
      <CollapsibleCard
        id="flow" title={t('Money Flow')} className="dash-card plot-card"
        onNavigate={() => setNavPrompt({ label: t('Money Flow'), to: '/flow' })}
      >
        <Plot data={fig.data} layout={fig.layout} config={FLOW_PLOT_CONFIG} ariaLabel={t('Money Flow')} style={{ width: '100%' }} />
      </CollapsibleCard>

      {/* Budget — this period's 50/30/20 bars. */}
      {budgetSummary && (
        <CollapsibleCard
          id="budget" title={t('Budget')} className="budget-card"
          onNavigate={() => setNavPrompt({ label: t('Budget'), to: '/budget' })}
        >
          <ThisPeriodBudget summary={budgetSummary} censor={censor} hidePeriodLabel />
        </CollapsibleCard>
      )}

      {/* Savings pool gauge (Emergency Fund + ticked goals). */}
      <CollapsibleCard
        id="pool" title={t('Savings Pool')} className="goals-gauge-card"
        onNavigate={() => setNavPrompt({ label: t('Financial Goals'), to: '/goals' })}
      >
        <SavingsPoolGauge bare />
      </CollapsibleCard>

      {/* Per-account balances. */}
      <CollapsibleCard
        id="accounts" title={t('Account balances')} className="dash-card"
        onNavigate={() => setNavPrompt({ label: t('Transactions'), to: '/transactions' })}
      >
        {acctRows.map(([name, bal]) => (
          <div key={name} className="acct-row">
            <span>{name}</span>
            <span className="money">{fmt(bal)}</span>
          </div>
        ))}
      </CollapsibleCard>

      <p className="muted">{t('Your data is stored on this device only.')}</p>

      {navPrompt && (
        <Modal title={t('Go to {section}?', { section: navPrompt.label })} onClose={() => setNavPrompt(null)}>
          <p className="muted" style={{ margin: '0 0 14px' }}>
            {t('Open the full {section} page?', { section: navPrompt.label })}
          </p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost" onClick={() => setNavPrompt(null)}>{t('Cancel')}</button>
            <button type="button" className="btn btn-accent" onClick={() => { const to = navPrompt.to; setNavPrompt(null); navigate(to) }}>
              {t('Open')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
