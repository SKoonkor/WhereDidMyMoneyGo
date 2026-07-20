import { useState } from 'react'
import { t } from '../../i18n'

// A single-level tap-a-chip picker: a wrap grid of option chips (the selected one
// highlighted) plus a "＋ Add" chip that reveals an inline text field. Replaces
// the old <select> ComboSelect for Account / transfer From-To. The add-new flow
// mirrors ComboSelect (persist via onAddNew, then select the new value).
export function ChipPicker({
  value,
  options,
  onChange,
  onAddNew,
  addPlaceholder,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  onAddNew?: (name: string) => Promise<void> | void
  addPlaceholder?: string
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  async function commit() {
    const name = draft.trim()
    if (name) {
      if (onAddNew && !options.includes(name)) await onAddNew(name)
      onChange(name)
    }
    setDraft('')
    setAdding(false)
  }

  if (adding) {
    return (
      <div className="pick-add">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
          placeholder={addPlaceholder ?? t('Add')}
        />
        <button type="button" className="btn btn-accent" onClick={commit}>{t('Add')}</button>
        <button type="button" className="btn" onClick={() => { setDraft(''); setAdding(false) }}>✕</button>
      </div>
    )
  }

  return (
    <div className="pick-grid">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={o === value ? 'pick-chip on' : 'pick-chip'}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
      {onAddNew && (
        <button type="button" className="pick-chip add" onClick={() => setAdding(true)}>＋ {t('Add')}</button>
      )}
    </div>
  )
}
