import { useState } from 'react'
import { t } from '../../i18n'

// Two-level tap-a-chip category picker. Level 1 shows category chips; picking an
// Expense category that has subcategories drills into the same region — a
// "‹ {category}" back header plus its subcategory chips (with a "None" chip to
// keep the row category-only). Income categories have no subcategories, so they
// select at level 1. "＋ Add" at each level persists a new category/subcategory.
export function CategoryPicker({
  kind,
  category,
  subcategory,
  catNames,
  subsOf,
  onCategory,
  onSubcategory,
  onAddCategory,
  onAddSubcategory,
}: {
  kind: 'Income' | 'Expense'
  category: string
  subcategory: string
  catNames: string[]
  subsOf: (cat: string) => string[]
  onCategory: (v: string) => void
  onSubcategory: (v: string) => void
  onAddCategory: (name: string) => Promise<void> | void
  onAddSubcategory: (name: string) => Promise<void> | void
}) {
  const [drill, setDrill] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const subs = category ? subsOf(category) : []
  const resetAdd = () => { setAdding(false); setDraft('') }

  async function commitAdd() {
    const name = draft.trim()
    if (name) {
      if (drill) {
        if (!subs.includes(name)) await onAddSubcategory(name)
        onSubcategory(name)
      } else {
        if (!catNames.includes(name)) await onAddCategory(name)
        onCategory(name)
        if (kind === 'Expense') setDrill(true)
      }
    }
    resetAdd()
  }

  function pickCategory(cat: string) {
    onCategory(cat)
    resetAdd()
    setDrill(kind === 'Expense' && subsOf(cat).length > 0)
  }

  // Inline add field (shared by both levels — only one level shows at a time).
  if (adding) {
    return (
      <div className="pick-add">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commitAdd())}
          placeholder={drill ? t('New subcategory') : t('New category')}
        />
        <button type="button" className="btn btn-accent" onClick={commitAdd}>{t('Add')}</button>
        <button type="button" className="btn" onClick={resetAdd}>✕</button>
      </div>
    )
  }

  // Subcategory level.
  if (drill && kind === 'Expense' && category) {
    return (
      <div>
        <button type="button" className="pick-back" onClick={() => setDrill(false)}>‹ {category}</button>
        <div className="pick-grid">
          <button
            type="button"
            className={subcategory === '' ? 'pick-chip on' : 'pick-chip'}
            onClick={() => onSubcategory('')}
          >
            {t('None')}
          </button>
          {subs.map((s) => (
            <button
              key={s}
              type="button"
              className={s === subcategory ? 'pick-chip on' : 'pick-chip'}
              onClick={() => onSubcategory(s)}
            >
              {s}
            </button>
          ))}
          <button type="button" className="pick-chip add" onClick={() => setAdding(true)}>＋ {t('Add')}</button>
        </div>
      </div>
    )
  }

  // Category level.
  return (
    <div>
      <div className="pick-grid">
        {catNames.map((c) => (
          <button
            key={c}
            type="button"
            className={c === category ? 'pick-chip on' : 'pick-chip'}
            onClick={() => pickCategory(c)}
          >
            {c}
          </button>
        ))}
        <button type="button" className="pick-chip add" onClick={() => setAdding(true)}>＋ {t('Add')}</button>
      </div>
      {kind === 'Expense' && category && subsOf(category).length > 0 && (
        <button type="button" className="pick-caption" onClick={() => setDrill(true)}>
          {t('Subcategory')}: {subcategory || t('None')} ›
        </button>
      )}
    </div>
  )
}
