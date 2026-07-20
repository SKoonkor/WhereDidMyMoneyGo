import { useMemo, useState } from 'react'
import { useLiveTxns } from '../useLiveTxns'
import { useBaseCurrency } from '../transactions/useConfig'
import { useTheme, useCensor } from '../../prefs'
import { buildFlow } from '../../lib/analytics/moneyflow'
import { forecast as runForecast } from '../../lib/analytics/forecast'
import { buildFlowFigure, type FlowUi } from './figure'
import { Plot } from '../../components/Plot'
import { t } from '../../i18n'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const HORIZONS: Array<{ label: string; days: number }> = [
  { label: '30 d', days: 30 },
  { label: '90 d', days: 90 },
  { label: '180 d', days: 180 },
  { label: '1 y', days: 365 },
]

export function FlowPage() {
  const all = useLiveTxns()
  const currency = useBaseCurrency()
  const [theme] = useTheme()
  const [censor] = useCensor()
  const [horizon, setHorizon] = useState(30)

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
        defaultDays: 60,
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
    [flow, fc, currency, censor, ui],
  )

  return (
    <div>
      <h1 className="h1">{t('Money Flow')}</h1>
      <p className="muted" style={{ marginTop: -4, marginBottom: 14 }}>
        {t('Running balance across your accounts, with a forward forecast.')}
      </p>

      <div className="flow-controls">
        <span className="muted" style={{ fontSize: 13 }}>{t('Forecast')}:</span>
        <div className="seg">
          {HORIZONS.map((h) => (
            <button
              key={h.days}
              type="button"
              className={h.days === horizon ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setHorizon(h.days)}
            >
              {t(h.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 8 }}>
        <Plot data={fig.data} layout={fig.layout} ariaLabel={t('Money Flow')} style={{ width: '100%' }} />
      </div>
      {!fc && flow.bars.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {t('Add a few more weeks of history to see a forecast.')}
        </p>
      )}
    </div>
  )
}
