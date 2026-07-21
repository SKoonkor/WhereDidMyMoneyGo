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
  flow: FlowData
  currency: string
  censor: boolean
}

// Builds the money-flow figure (running balance + forward forecast). Defaults mirror
// the "default money flow plot": a 1-month forecast over a 2-month opening window.
// Shared by FlowPage (which varies the horizon) and the Home dashboard embed.
export function useMoneyFlow(horizon = 30, defaultDays = 60): MoneyFlow {
  const all = useLiveTxns()
  const currency = useBaseCurrency()
  const [theme] = useTheme()
  const [censor] = useCensor()

  const fc = useMemo(() => runForecast(all, horizon), [all, horizon])
  const flow = useMemo(() => {
    const fcEnd = fc ? new Date(fc.dates[fc.dates.length - 1] + 'T00:00:00Z').getTime() : undefined
    return buildFlow(all, fcEnd)
  }, [all, fc])

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
        noData: t('No transactions yet'),
        labels: {
          netWorth: t('Net worth'),
          balances: t('Latest balances'),
          amount: t('Amount'),
          balanceAfter: t('Balance after'),
          forecast: t('Forecast'),
          hidden: t('Hidden cost (untracked)'),
        },
      }),
    [flow, fc, currency, defaultDays, censor, ui],
  )

  return { fig, fc, flow, currency, censor }
}
