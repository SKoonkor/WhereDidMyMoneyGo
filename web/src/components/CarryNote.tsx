import { useBaseCurrency } from '../features/transactions/useConfig'
import { t } from '../i18n'

// The leftover from the last saved transaction, floating over whatever is on
// screen — including an open Add sheet, which is the whole point: you record the
// remainder while it's still fresh.
//
// Unlike Toast this does not time itself out. It goes when it's used, dismissed,
// or superseded by the next save (see carryNote.ts); a reminder that vanishes
// while you're reaching for it is worse than no reminder.
export function CarryNote({
  amount,
  onUse,
  onClose,
}: {
  amount: number
  onUse: () => void // tap the body — fills an open form, or opens a prefilled one
  onClose: () => void
}) {
  const currency = useBaseCurrency()
  const shown = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return (
    <div className="carry-note" role="status" aria-live="polite">
      <button type="button" className="carry-note-body" onClick={onUse}>
        <span className="carry-note-label">{t('Still to record from your last transaction')}</span>
        <strong className="carry-note-amount">{shown} {currency}</strong>
      </button>
      <button
        type="button"
        className="carry-note-close"
        onClick={onClose}
        aria-label={t('Dismiss')}
      >
        ×
      </button>
    </div>
  )
}
