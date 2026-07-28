import { useCensor } from '../../../prefs'
import { useSavingsPool } from '../../goals/useSavingsPool'
import { Ring } from './Ring'
import { t } from '../../../i18n'

// How full the savings pool is, plus what's in it ("EF + 2 G"). Shares its
// numbers with the full gauge through useSavingsPool.
export function MiniPoolGauge() {
  const pool = useSavingsPool()
  const [censor] = useCensor()
  if (!pool) return null

  // "EF" alone, or "EF + 2 G" — initialised because the full "Emergency Fund +
  // 2 goals" never fits at this width.
  const n = pool.selected.length
  const note = n === 0 ? t('EF') : t('EF + {n} G', { n })

  return (
    <>
      <div className="small-slot-title">{t('Savings Pool')}</div>
      <div className="small-slot-body">
        <Ring
          pct={pool.pct}
          color="var(--accent)"
          label={censor ? '•••' : `${Math.round(pool.pct)}%`}
          ariaLabel={t('Savings Pool')}
        />
      </div>
      <div className="small-slot-note">{note}</div>
    </>
  )
}
