import { useCensor } from '../../../prefs'
import { useGoalSavings } from '../useGoalSavings'
import { TONE_COLOR } from '../../budget/tone'
import { EMERGENCY_FUND } from '../../../data/defaults'
import { fundedPct, nextGoal } from '../../../lib/analytics/goalSavings'
import { Ring } from './Ring'
import { t } from '../../../i18n'

// What to save for next: the highest-priority goal that isn't finished yet, in
// the user's own order from Financial Goals — the Emergency Fund first, then
// their drag order, skipping anything already fully funded. Only one ring fits
// at ~108px, and the goal still needing money is the one worth that space.
export function MiniGoals() {
  const data = useGoalSavings()
  const [censor] = useCensor()
  if (!data) return null

  const hasTargets = data.standings.some((s) => s.target > 0)
  if (!hasTargets) {
    return (
      <>
        <div className="small-slot-title">{t('Goal savings')}</div>
        <div className="small-slot-body">
          <span className="muted" style={{ fontSize: 12 }}>{t('No goals yet.')}</span>
        </div>
      </>
    )
  }

  const next = nextGoal(data.standings)
  // Nothing left to fund — an end state of its own, not an arbitrary goal at 100%.
  if (!next) {
    return (
      <>
        <div className="small-slot-title">{t('Goal savings')}</div>
        <div className="small-slot-body">
          <Ring pct={100} color={TONE_COLOR.good} label="✓" ariaLabel={t('All goals funded')} />
        </div>
        <div className="small-slot-note">{t('All goals funded')}</div>
      </>
    )
  }

  const pct = fundedPct(next.ratio)
  return (
    <>
      <div className="small-slot-title">{t('Goal savings')}</div>
      <div className="small-slot-body">
        <Ring
          pct={pct}
          color={TONE_COLOR[next.tone]}
          label={censor ? '•••' : `${pct}%`}
          ariaLabel={t('{name}: {pct}% funded', { name: next.name, pct: String(pct) })}
        />
      </div>
      <div className="small-slot-note">
        {next.isEmergencyFund ? t(EMERGENCY_FUND) : next.name}
      </div>
    </>
  )
}
