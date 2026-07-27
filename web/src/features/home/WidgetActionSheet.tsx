import { useRef } from 'react'
import { Modal } from '../../components/Modal'
import { t } from '../../i18n'

// What a hold on a Home box opens: go to that section's full page, or drop the
// widget from Home.
//
// The settling guard is not optional. A touch long-press fires this sheet while
// the finger is still down, so the compat `click` synthesised at touch-end lands
// on the backdrop that just mounted underneath it and closes the sheet
// instantly. Ignoring every dismissal for the first 400 ms swallows that stray
// click. It lives here rather than in the caller so a second caller can't forget
// it.
const SETTLE_MS = 400

export function WidgetActionSheet({
  title, canNavigate, onNavigate, onRemove, onClose,
}: {
  title: string
  canNavigate: boolean
  onNavigate: () => void
  onRemove: () => void
  onClose: () => void
}) {
  const openedAt = useRef(Date.now())
  const settling = () => Date.now() - openedAt.current < SETTLE_MS
  const guard = (fn: () => void) => () => { if (!settling()) fn() }

  return (
    <Modal title={title} onClose={guard(onClose)}>
      <div className="sheet-actions">
        {canNavigate && (
          <button type="button" className="sheet-action" onClick={guard(onNavigate)}>
            <span className="sheet-action-icon" aria-hidden="true">→</span>
            <span>{t('Go to page')}</span>
          </button>
        )}
        <button type="button" className="sheet-action danger" onClick={guard(onRemove)}>
          <span className="sheet-action-icon" aria-hidden="true">✕</span>
          <span>{t('Remove from home')}</span>
        </button>
      </div>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn ghost" onClick={guard(onClose)}>{t('Cancel')}</button>
      </div>
    </Modal>
  )
}
