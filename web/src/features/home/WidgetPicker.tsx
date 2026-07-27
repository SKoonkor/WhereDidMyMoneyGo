import { Modal } from '../../components/Modal'
import { SMALL_IDS, type LargeWidgetId, type SmallWidgetId } from '../../lib/homeLayout'
import { LARGE, SMALL } from './registry'
import { t } from '../../i18n'

// "+ Add widget" (large) and the small-widget slot picker share one sheet — the
// only difference is what the rows list and whether a "leave empty" row appears.
export function WidgetPicker({ mode, onClose }: {
  mode:
    | { kind: 'large'; options: LargeWidgetId[]; onPick: (id: LargeWidgetId) => void }
    | { kind: 'small'; current: SmallWidgetId | null; onPick: (id: SmallWidgetId | null) => void }
  onClose: () => void
}) {
  if (mode.kind === 'large') {
    return (
      <Modal title={t('Add a widget')} onClose={onClose}>
        {mode.options.length === 0 && <p className="muted">{t('Nothing left to add.')}</p>}
        {mode.options.map((id) => (
          <button key={id} type="button" className="picker-row" onClick={() => mode.onPick(id)}>
            <span className="picker-row-body">
              <span className="picker-row-title">{t(LARGE[id].title)}</span>
              <span className="picker-row-desc">{t(LARGE[id].desc)}</span>
            </span>
            <span className="picker-row-plus" aria-hidden="true">+</span>
          </button>
        ))}
      </Modal>
    )
  }

  return (
    <Modal title={t('Add a small widget')} onClose={onClose}>
      {SMALL_IDS.map((id) => (
        <button
          key={id} type="button"
          className={`picker-row ${mode.current === id ? 'is-current' : ''}`}
          onClick={() => mode.onPick(id)}
        >
          <span className="picker-row-body">
            <span className="picker-row-title">{t(SMALL[id].title)}</span>
          </span>
          <span className="picker-row-plus" aria-hidden="true">{mode.current === id ? '✓' : '+'}</span>
        </button>
      ))}
      {mode.current && (
        <button type="button" className="picker-row danger" onClick={() => mode.onPick(null)}>
          <span className="picker-row-body">
            <span className="picker-row-title">{t('Leave this slot empty')}</span>
          </span>
          <span className="picker-row-plus" aria-hidden="true">✕</span>
        </button>
      )}
    </Modal>
  )
}
