import { useCensor } from '../../../prefs'
import { fundedPct } from '../../../lib/analytics/goalSavings'
import { useDebts } from '../../debts/useDebts'
import { TONE_COLOR } from '../../budget/tone'
import { Ring } from './Ring'
import { t } from '../../../i18n'

// What to pay off next: the debt at the top of the active payoff order, and how
// much of it is already gone. `ranked` is whichever order the user chose on the
// Debts page — avalanche or snowball — so this tile always agrees with the plan
// rather than picking a favourite of its own.
export function MiniDebt() {
  const view = useDebts()
  const [censor] = useCensor()
  if (!view) return null

  // Settled debts drop out; what's left is the front of the queue.
  const next = view.ranked.find((s) => s.balance > 0)

  if (!next) {
    return (
      <>
        <div className="small-slot-title">{t('Debts')}</div>
        <div className="small-slot-body">
          {view.standings.length === 0
            ? <span className="muted" style={{ fontSize: 12 }}>{t('No debts tracked.')}</span>
            : <Ring pct={100} color={TONE_COLOR.good} label="✓" ariaLabel={t('Debt free')} />}
        </div>
        {view.standings.length > 0 && <div className="small-slot-note">{t('Debt free')}</div>}
      </>
    )
  }

  const pct = fundedPct(next.paidOff)
  return (
    <>
      <div className="small-slot-title">{t('Debts')}</div>
      <div className="small-slot-body">
        <Ring
          pct={pct}
          color={TONE_COLOR[next.tone]}
          label={censor ? '•••' : `${pct}%`}
          ariaLabel={t('{name}: {pct}% paid off', { name: next.debt.name, pct: String(pct) })}
        />
      </div>
      <div className="small-slot-note">{next.debt.name}</div>
    </>
  )
}
