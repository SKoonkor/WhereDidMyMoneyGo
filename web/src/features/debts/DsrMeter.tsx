import { DSR_CAP, DSR_COMFORT, DSR_STRETCHED } from '../../lib/analytics/debt'
import type { Tone } from '../../lib/analytics/budget'
import { t } from '../../i18n'

// The debt service ratio on a straight track rather than an arc.
//
// This number only means anything against three specific lines — 36% (the classic
// 28/36 rule's cap on all debt), ~50% (where lenders stop stretching) and 70%
// (the Bank of Thailand's ceiling for vulnerable borrowers) — and a marked track
// says "you are here, that is the wall" in a way a sweep never does.
export function DsrMeter({ pct, tone }: { pct: number; tone: Tone }) {
  const marks = [
    { at: DSR_COMFORT, label: t('Comfortable') },
    { at: DSR_STRETCHED, label: t('Stretched') },
    { at: DSR_CAP, label: t('Limit') },
  ]
  return (
    <div className="dsr-meter">
      <div
        className="dsr-track"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('Debt service ratio')}
      >
        <div className={`dsr-fill ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        {marks.map((m) => (
          <span key={m.at} className="dsr-tick" style={{ left: `${m.at}%` }} aria-hidden="true" />
        ))}
      </div>
      <div className="dsr-scale" aria-hidden="true">
        {marks.map((m) => (
          <span key={m.at} className="dsr-mark" style={{ left: `${m.at}%` }}>
            {m.at}% <span className="muted">{m.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
