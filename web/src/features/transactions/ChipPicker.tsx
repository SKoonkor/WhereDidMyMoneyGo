import { useState } from 'react'
import { t } from '../../i18n'
import { Modal } from '../../components/Modal'

// A tappable summary row ("value ›") that opens a 3-column grid bottom-sheet for
// picking an account (also used for transfer From / To). Selecting a cell closes
// the sheet; "＋ Add" reveals an inline field that persists via onAddNew, then
// selects the new value. Replaces the old always-inline chip list.
export function ChipPicker({
  value,
  options,
  onChange,
  onAddNew,
  addPlaceholder,
  title,
  placeholder,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  onAddNew?: (name: string) => Promise<void> | void
  addPlaceholder?: string
  title?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const close = () => { setAdding(false); setDraft(''); setOpen(false) }

  async function commit() {
    const name = draft.trim()
    if (name) {
      if (onAddNew && !options.includes(name)) await onAddNew(name)
      onChange(name)
      close()
    }
  }

  function pick(o: string) {
    onChange(o)
    close()
  }

  return (
    <>
      <button type="button" className="pick-summary" onClick={() => setOpen(true)}>
        <span className={value ? '' : 'muted'}>{value || placeholder || t('Select')}</span>
        <span className="pick-summary-arrow">›</span>
      </button>

      {open && (
        <Modal title={title ?? t('Account')} onClose={close}>
          {adding ? (
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
          ) : (
            <div className="pick-sheet-grid">
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={o === value ? 'pick-cell on' : 'pick-cell'}
                  onClick={() => pick(o)}
                >
                  {o}
                </button>
              ))}
              {onAddNew && (
                <button type="button" className="pick-cell add" onClick={() => setAdding(true)}>＋ {t('Add')}</button>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
