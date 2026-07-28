import { useCensor } from '../../../prefs'
import { useGoalSavings } from '../useGoalSavings'
import { TONE_COLOR } from '../../budget/tone'
import { EMERGENCY_FUND } from '../../../data/defaults'
import { Ring } from './Ring'
import { t } from '../../../i18n'

// The goal nearest to fully funded — the one worth celebrating. Only a single
// ring fits at ~108px, so ranking by ratio (rather than the user's priority
// order, which the full-size widget follows) is what makes the one on show
// worth showing.
export function MiniGoals() {
  const data = useGoalSavings()
  const [censor] = useCensor()
  if (!data) return null

  const funded = [...data.standings]
    .filter((s) => s.target > 0)
    .sort((a, b) => b.ratio - a.ratio)[0]
  if (!funded) {
    return (
      <>
        <div className="small-slot-title">{t('Goal savings')}</div>
        <div className="small-slot-body">
          <span className="muted" style={{ fontSize: 12 }}>{t('No goals yet.')}</span>
        </div>
      </>
    )
  }

  const pct = Math.round(funded.ratio * 100)
  return (
    <>
      <div className="small-slot-title">{t('Goal savings')}</div>
      <div className="small-slot-body">
        <Ring
          pct={pct}
          color={TONE_COLOR[funded.tone]}
          label={censor ? '•••' : `${pct}%`}
          ariaLabel={t('{name}: {pct}% funded', { name: funded.name, pct: String(pct) })}
        />
      </div>
      <div className="small-slot-note">
        {funded.isEmergencyFund ? t(EMERGENCY_FUND) : funded.name}
      </div>
    </>
  )
}
