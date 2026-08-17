import { useMemo } from 'react'
import { useLiveTxns } from '../useLiveTxns'
import { useBaseCurrency } from '../transactions/useConfig'
import { useTheme, useCensor } from '../../prefs'
import { buildFlow, type FlowData } from '../../lib/analytics/moneyflow'
import { forecast as runForecast, type Forecast } from '../../lib/analytics/forecast'
import { buildFlowFigure, type FlowUi } from './figure'
import { t } from '../../i18n'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// Pan-only interaction: keep horizontal pan, but disable the double-tap autozoom
// (axis reset) so a stray double-tap doesn't jump the view.
export const FLOW_PLOT_CONFIG = { doubleClick: false as const, scrollZoom: false }

export interface MoneyFlow {
  fig: ReturnType<typeof buildFlowFigure>
  fc: Forecast | null
  /** Scoped to `account` when one is picked — this is what the plot draws. */
  flow: FlowData
  /**
   * Always the whole ledger. The "Latest balances" card reads this so it keeps
   * listing every account while the plot is filtered to one; when no account is
   * picked it is the very same object as `flow`, so the Home widget does exactly
   * the work it always did.
   */
  flowAll: FlowData
  currency: string
  censor: boolean
}

// Builds the money-flow figure (running balance + forward forecast). Defaults mirror
// the "default money flow plot": a 1-month forecast over a 2-month opening window.
// Shared by FlowPage (which varies the horizon and can scope to one account) and
// the Home dashboard embed.
// `height` overrides the figure's own box (the Flow page draws a much taller
// chart than the Home tile); leave it out to keep the widget-sized default.
export function useMoneyFlow(horizon = 30, defaultDays = 60, account: string | null = null, height?: number): MoneyFlow {
  const all = useLiveTxns()
  const currency = useBaseCurrency()
  const [theme] = useTheme()
  const [censor] = useCensor()

  const scoped = useMemo(
    () => (account ? all.filter((tx) => tx.account === account) : all),
    [all, account],
  )

  // Scoping to one account makes transfers the dominant flow, so the forecast
  // has to count them (see ForecastScope).
  const fc = useMemo(
    () => runForecast(scoped, horizon, undefined, account ? { scope: 'account' } : {}),
    [scoped, horizon, account],
  )
  const flow = useMemo(() => {
    const fcEnd = fc ? new Date(fc.dates[fc.dates.length - 1] + 'T00:00:00Z').getTime() : undefined
    return buildFlow(scoped, fcEnd)
  }, [scoped, fc])

  // Memoised on `all` alone, so changing the horizon doesn't rebuild it.
  const flowAll = useMemo(() => (account ? buildFlow(all) : flow), [account, all, flow])

  const ui: FlowUi = useMemo(
    () => ({
      ink: cssVar('--ink', '#e6e9ee'),
      muted: cssVar('--muted', '#8a94a6'),
      grid: cssVar('--border-soft', 'rgba(128,128,128,0.2)'),
      band: cssVar('--muted', '#8a94a6'),
      annoBg: cssVar('--surface-2', '#1b1f27'),
    }),
    [theme],
  )

  const fig = useMemo(
    () =>
      buildFlowFigure(flow, fc, {
        currency,
        defaultDays,
        censor,
        ui,
        // Bar colours are picked by position, so pass the full account list —
        // otherwise filtering to one account would recolour it.
        allAccounts: flowAll.accounts,
        height,
        noData: t('No transactions yet'),
        labels: {
          // Scoped, the in-plot line is that account's balance, not net worth.
          netWorth: account ? t('{account} balance', { account }) : t('Net worth'),
          balances: t('Latest balances'),
          amount: t('Amount'),
          balanceAfter: t('Balance after'),
          forecast: t('Forecast'),
          hidden: t('Hidden cost (untracked)'),
        },
      }),
    [flow, fc, currency, defaultDays, censor, ui, flowAll, account, height],
  )

  return { fig, fc, flow, flowAll, currency, censor }
}
