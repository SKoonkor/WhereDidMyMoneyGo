import { DSR_CAP } from '../../../lib/analytics/debt'
import { useDebts } from '../../debts/useDebts'
import { TONE_COLOR } from '../../budget/tone'
import { Ring } from './Ring'
import { t } from '../../../i18n'

// The share of income going out as debt payments, as a ring.
//
// The ring is scaled against the 70% ceiling rather than 100%, because that is
// what the number is measured against — a full ring here means "at the limit
// lenders work to", not "all of your income", which is a line nobody reaches.
export function MiniDsr() {
  const view = useDebts()
  if (!view) return null

  if (view.standings.length === 0 || view.income <= 0) {
    return (
      <>
        <div className="small-slot-title">{t('Debt ratio')}</div>
        <div className="small-slot-body">
          <span className="muted" style={{ fontSize: 12 }}>
            {view.standings.length === 0 ? t('No debts tracked.') : t('Set your income.')}
          </span>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="small-slot-title">{t('Debt ratio')}</div>
      <div className="small-slot-body">
        <Ring
          pct={(view.dsr / DSR_CAP) * 100}
          color={TONE_COLOR[view.tone]}
          // Not censored: a ratio isn't an amount, the same call the goal rings make.
          label={`${view.dsr.toFixed(0)}%`}
          ariaLabel={t('{pct}% of your income goes to debt', { pct: view.dsr.toFixed(0) })}
        />
      </div>
      <div className="small-slot-note">{t('of income')}</div>
    </>
  )
}
