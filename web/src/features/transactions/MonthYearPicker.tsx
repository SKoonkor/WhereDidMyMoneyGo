import { useState } from 'react'
import { Modal } from '../../components/Modal'
import { getLang, t } from '../../i18n'

// Short localized month name ("Jan" / "ม.ค.") — year is fixed, only month matters.
function shortMonth(i: number, locale: string): string {
  return new Date(2000, i, 1).toLocaleDateString(locale, { month: 'short' })
}

// A month/year grid launched from the transactions month label. Year is navigated
// with ‹ ›; tapping a month picks "YYYY-MM" and closes.
export function MonthYearPicker({
  value,
  onSelect,
  onClose,
}: {
  value: string // "YYYY-MM"
  onSelect: (key: string) => void
  onClose: () => void
}) {
  const [selY, selM] = value.split('-').map(Number) // selM is 1-based
  const [year, setYear] = useState(selY)
  const locale = getLang() === 'th' ? 'th-TH' : 'en-US'
  // th-TH renders the Buddhist-era year, matching the list's month label.
  const yearLabel = new Date(year, 0, 1).toLocaleDateString(locale, { year: 'numeric' })

  return (
    <Modal title={t('Select month')} onClose={onClose}>
      <div className="my-year">
        <button className="tool-btn month-arrow" onClick={() => setYear((y) => y - 1)} aria-label={t('Previous year')}>‹</button>
        <span className="my-year-label">{yearLabel}</span>
        <button className="tool-btn month-arrow" onClick={() => setYear((y) => y + 1)} aria-label={t('Next year')}>›</button>
      </div>
      <div className="my-grid">
        {Array.from({ length: 12 }, (_, i) => {
          const key = `${year}-${String(i + 1).padStart(2, '0')}`
          const isSel = year === selY && i + 1 === selM
          return (
            <button
              key={i}
              type="button"
              className={`my-month${isSel ? ' is-sel' : ''}`}
              onClick={() => { onSelect(key); onClose() }}
            >
              {shortMonth(i, locale)}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
