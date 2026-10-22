import { Modal } from '../../components/Modal'
import { t } from '../../i18n'

// What holding the ＋ offers once AI is set up: snap a receipt, or say it.
export function AiChooser({
  onReceipt,
  onVoice,
  onClose,
}: {
  onReceipt: () => void
  onVoice: () => void
  onClose: () => void
}) {
  return (
    <Modal title={t('Add with AI')} onClose={onClose}>
      <div className="ai-choices">
        <button type="button" className="ai-choice" onClick={onReceipt}>
          <span className="ai-choice-icon" aria-hidden="true">📷</span>
          <span className="ai-choice-label">{t('Scan a receipt')}</span>
        </button>
        <button type="button" className="ai-choice" onClick={onVoice}>
          <span className="ai-choice-icon" aria-hidden="true">🎤</span>
          <span className="ai-choice-label">{t('Say a transaction')}</span>
        </button>
      </div>
    </Modal>
  )
}
