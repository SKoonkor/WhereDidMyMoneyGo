import { useLimits } from '../useLimits'
import { compactAmount } from '../../../lib/format'
import { t } from '../../../i18n'

const SHOWN = 3

// The three limits nearest to being blown. Same treatment as MiniBudgetBars —
// at ~108px there's no room for names, so the bar plus what's left is the most
// the tile can carry.
export function MiniLimits() {
  const limits = useLimits()
  if (!limits) return null

  const top = limits.statuses.slice(0, SHOWN)
  return (
    <>
      <div className="small-slot-title">{t('Limits')}</div>
      {top.length === 0 ? (
        <div className="small-slot-body">
          <div className="small-slot-empty-note">{t('No limits set yet.')}</div>
        </div>
      ) : (
        <div className="mini-bars small-slot-body">
          {top.map((s) => (
            <div key={s.key} className="mini-bar-row">
              <div className="budget-bar mini-bar">
                <div className={`budget-bar-fill ${s.tone}`}
                  style={{ width: `${Math.min(100, Math.max(0, s.ratio * 100)).toFixed(0)}%` }} />
              </div>
              <span className={`mini-bar-amt money ${s.tone}`}>{compactAmount(s.remaining)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
