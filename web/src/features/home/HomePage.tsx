import { useMemo } from 'react'
import { useLiveTxns } from '../useLiveTxns'
import { useAccounts, useBaseCurrency } from '../transactions/useConfig'
import { useTheme, useCensor } from '../../prefs'
import { filterByMonth, currentMonthKey, monthSummary } from '../transactions/month'
import { accountBalances } from '../../lib/balances'
import { netWorth, netWorthTrend } from '../../lib/analytics/networth'
import { buildNetWorthTrendFigure } from './figure'
import { Plot } from '../../components/Plot'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function HomePage() {
  const all = useLiveTxns()
  const accounts = useAccounts()
  const currency = useBaseCurrency()
  const [theme] = useTheme()
  const [censor] = useCensor()

  const nw = useMemo(() => netWorth(all), [all])
  const balances = useMemo(() => accountBalances(all), [all])
  const month = currentMonthKey()
  const summary = useMemo(() => monthSummary(filterByMonth(all, month)), [all, month])
  const trend = useMemo(() => netWorthTrend(all, 180), [all])

  // Re-read CSS variables when the theme toggles so the chart recolours.
  const palette = useMemo(
    () => ({
      accent: cssVar('--accent', '#1abc9c'),
      muted: cssVar('--muted', '#8a94a6'),
      grid: cssVar('--border-soft', 'rgba(128,128,128,0.2)'),
    }),
    [theme],
  )
  const figure = useMemo(
    () => buildNetWorthTrendFigure(trend, { palette, censor }),
    [trend, palette, censor],
  )

  // Configured accounts in order, then any stray account that still holds money.
  const acctRows = useMemo(() => {
    const known = new Set(accounts)
    const extra = Object.keys(balances).filter((a) => !known.has(a) && balances[a] !== 0)
    return [...accounts, ...extra].map((a) => [a, balances[a] ?? 0] as [string, number])
  }, [accounts, balances])

  return (
    <div>
      <h1 className="h1">{t('Home')}</h1>

      <div className="card nw-hero">
        <div className="nw-label">{t('Net worth')}</div>
        <div className="nw-value money">
          {fmt(nw)} <span className="nw-cur">{currency}</span>
        </div>
      </div>

      {all.length > 0 && (
        <div className="card dash-card">
          <div className="dash-title">{t('Net worth · last 6 months')}</div>
          <Plot data={figure.data} layout={figure.layout} ariaLabel={t('Net worth trend')} style={{ width: '100%' }} />
        </div>
      )}

      <div className="summary-strip card dash-card">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t('Income')}</div>
          <div className="money" style={{ color: 'var(--income)' }}>{fmt(summary.income)}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t('Expense')}</div>
          <div className="money" style={{ color: 'var(--expense)' }}>{fmt(summary.expense)}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t('Net')}</div>
          <div className="money">{fmt(summary.net)}</div>
        </div>
      </div>

      <div className="card dash-card">
        <div className="dash-title">{t('Accounts')}</div>
        {acctRows.map(([name, bal]) => (
          <div key={name} className="acct-row">
            <span>{name}</span>
            <span className="money">{fmt(bal)}</span>
          </div>
        ))}
      </div>

      <p className="muted" style={{ marginTop: 16 }}>{t('Your data is stored on this device only.')}</p>
    </div>
  )
}
