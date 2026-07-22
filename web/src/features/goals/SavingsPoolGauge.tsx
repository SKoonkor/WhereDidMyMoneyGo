import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getGoals } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useSettings } from '../transactions/useConfig'
import { useTheme, useCensor } from '../../prefs'
import { EMERGENCY_FUND } from '../../data/defaults'
import { emergencyFundStatus, poolTarget } from '../../lib/analytics/goals'
import { buildGoalGauge, gaugeBands } from './figure'
import { Plot } from '../../components/Plot'
import { t } from '../../i18n'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const MONTHS_CAP = 6

// The Savings-Pool gauge: Emergency Fund base + whichever goals are ticked on the
// Financial Goals page. Self-contained (loads goals config + settings), so both
// GoalsPage and the Home dashboard render it the same way. Returns null until the
// goals config loads.
// `bare` renders just the gauge plot (no card/title) so a CollapsibleCard can own
// the box on Home; GoalsPage uses the default self-contained card.
export function SavingsPoolGauge({ bare = false }: { bare?: boolean } = {}) {
  const all = useLiveTxns()
  const settings = useSettings()
  const cfg = useLiveQuery(() => getGoals(), [])
  const [theme] = useTheme()
  const [censor] = useCensor()
  const currency = settings.baseCurrency
  const efTarget = settings.monthlyRequired * settings.targetMonths

  const fig = useMemo(() => {
    if (!cfg) return null
    const selected = cfg.selected.filter((g) => g in cfg.goals)
    const pooled = poolTarget(efTarget, cfg.goals, selected, cfg.factors)
    const ef = emergencyFundStatus(all, settings.savingsAccounts, settings.monthlyRequired, settings.targetMonths)
    const balance = ef.currentBalance
    const pct = Math.min((balance / Math.max(pooled, 1)) * 100, 100)
    const months = settings.monthlyRequired > 0 ? balance / settings.monthlyRequired : 0
    const monthsTxt = months >= MONTHS_CAP ? `${MONTHS_CAP}+` : months.toFixed(1)

    // Summarise the pool to a count so it always fits the gauge: EF alone, EF + the
    // single goal's name, or "EF + N goals" once more than one is ticked.
    const efName = t(EMERGENCY_FUND)
    const s = selected.length
    const subtitle = censor
      ? (s > 0 ? `${efName} + ${t('Goals')}` : efName)
      : s === 0 ? efName
      : s === 1 ? `${efName} + ${selected[0]}`
      : `${efName} + ${t('{n} goals', { n: s })}`
    const targetLine = censor ? '' : `<br>${t('Target')}: ${fmt(pooled)} ${currency}`
    const footer = censor
      ? t('{pct}%', { pct: pct.toFixed(1) })
      : t('{pct}% · Emergency Fund covers {months} months', { pct: pct.toFixed(1), months: monthsTxt })

    return buildGoalGauge({
      balance,
      pooledTarget: pooled,
      currency,
      censor,
      ink: cssVar('--ink', '#e6e9ee'),
      bands: gaugeBands(theme === 'dark'),
      title: '', // the box header below shows "SAVINGS POOL" now
      subtitle: subtitle + targetLine,
      footer,
    })
    // theme included so the gauge bands rebuild on toggle
  }, [cfg, all, settings, efTarget, currency, censor, theme])

  if (!fig) return null

  const plot = <Plot data={fig.data} layout={fig.layout} ariaLabel={t('Savings Pool')} style={{ width: '100%' }} />
  if (bare) return plot

  return (
    <section className="card goals-gauge-card">
      <div className="dash-title">{t('Savings Pool')}</div>
      {plot}
    </section>
  )
}
