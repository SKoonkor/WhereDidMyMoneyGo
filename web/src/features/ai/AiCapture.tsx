import { useRef, useState } from 'react'
import { Modal } from '../../components/Modal'
import { getAi, getCategories, getSettings } from '../../db'
import { makeProvider, type ReceiptDraft, type ReceiptImage } from '../../lib/ai'
import { fileToScaledImage } from './scaleImage'
import { t } from '../../i18n'

// Turn a provider error code/message into a user-facing line.
function friendlyError(err: string): string {
  if (err === 'missing-key') return t('Add your API key in Settings first.')
  if (err === 'unreadable') return t("Couldn't read the receipt — try a clearer photo.")
  return t('Scan failed: {error}', { error: err })
}

// Receipt capture: pick/take a photo, preview it, then scan it with the configured
// AI provider. On success it hands the extracted draft to the parent (which opens
// the review/save form in P7). Manual entry is unaffected — this is the long-press
// path only.
export function AiCapture({
  onExtracted,
  onClose,
}: {
  onExtracted: (draft: ReceiptDraft) => void
  onClose: () => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [image, setImage] = useState<ReceiptImage | null>(null)
  const [phase, setPhase] = useState<'pick' | 'scanning' | 'error'>('pick')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setError('')
    setPhase('pick')
    try {
      const scaled = await fileToScaledImage(file)
      setPreview(scaled.dataUrl)
      setImage({ base64: scaled.dataUrl, mime: scaled.mime })
    } catch {
      setPhase('error')
      setError(t("Couldn't read the receipt — try a clearer photo."))
    }
  }

  async function scan() {
    if (!image) return
    setPhase('scanning')
    setError('')
    const [cfg, cats, settings] = await Promise.all([getAi(), getCategories(), getSettings()])
    const ctx = {
      categories: Object.keys(cats.expense),
      defaultCurrency: settings.baseCurrency,
      today: new Date().toISOString().slice(0, 10),
    }
    const r = await makeProvider(cfg).extractReceipt(image, ctx)
    if (r.ok) onExtracted(r.draft)
    else {
      setPhase('error')
      setError(friendlyError(r.error))
    }
  }

  return (
    <Modal title={t('Scan a receipt')} onClose={onClose}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onFile}
      />

      {preview
        ? <img src={preview} alt={t('Receipt preview')} className="receipt-preview" />
        : (
            <button type="button" className="receipt-drop" onClick={() => fileRef.current?.click()}>
              <span className="receipt-drop-icon" aria-hidden="true">📷</span>
              <span>{t('Take or choose a photo of the receipt')}</span>
            </button>
          )}

      {phase === 'error' && <p className="amt-expense" style={{ marginTop: 8 }}>{error}</p>}

      <p className="set-hint" style={{ marginTop: 10 }}>
        {t('The photo is sent to your AI provider to read it, then you confirm before it’s saved.')}
      </p>

      <div className="row" style={{ gap: 12, marginTop: 12 }}>
        {preview && (
          <button type="button" className="btn ghost" disabled={phase === 'scanning'} onClick={() => fileRef.current?.click()}>
            {t('Retake')}
          </button>
        )}
        {preview && (
          <button type="button" className="btn btn-accent" disabled={phase === 'scanning'} onClick={scan}>
            {phase === 'scanning' ? t('Scanning…') : t('Scan receipt')}
          </button>
        )}
      </div>
    </Modal>
  )
}
