import { Fragment, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { Modal } from '../../components/Modal'

// A tappable summary row ("Food/Lunch ›") that opens a 3-column grid sheet
// (slide 15). A category with subcategories shows a ▾ under its name; tapping it
// marks it selected and smoothly expands its subcategories as a full-width block
// right under that category's row (chevron flips to ▴), including a "None" cell
// that keeps the row category-only and a "＋ Add" cell. Tapping a subcategory — or
// a category that has none — commits the pick and closes. Income categories have
// no subcategories, so they always select-and-close.
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
  placeholder,
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
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  // `mounted` keeps a collapsing block in the DOM so it can animate closed, and
  // `shown` toggles the .open class that drives the height transition.
  const [mounted, setMounted] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const [adding, setAdding] = useState<'cat' | 'sub' | null>(null)
  const [draft, setDraft] = useState('')

  const hasSubs = (c: string) => kind === 'Expense' && subsOf(c).length > 0
  const close = () => {
    setOpen(false); setAdding(null); setDraft('')
    setExpanded(null); setMounted(null); setShown(false)
  }

  // Drive the expand/collapse animation from `expanded`.
  useEffect(() => {
    if (expanded) {
      setMounted(expanded)
      const id = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const id = setTimeout(() => setMounted(null), 260)
    return () => clearTimeout(id)
  }, [expanded])

  function openSheet() {
    // Re-open showing the current selection's subcategories when relevant.
    setExpanded(category && hasSubs(category) ? category : null)
    setOpen(true)
  }

  function pickCategory(c: string) {
    onCategory(c)
    onSubcategory('')
    if (hasSubs(c)) {
      setExpanded((e) => (e === c ? null : c)) // toggle its subcategory block
    } else {
      close()
    }
  }

  function pickSub(s: string) {
    onSubcategory(s)
    close()
  }

  async function commitAdd() {
    const name = draft.trim()
    if (!name) return
    if (adding === 'sub' && mounted) {
      if (!subsOf(mounted).includes(name)) await onAddSubcategory(name)
      onSubcategory(name)
      close()
    } else {
      if (!catNames.includes(name)) await onAddCategory(name)
      onCategory(name)
      onSubcategory('')
      close()
    }
  }

  // Category cells (+ a trailing "＋ Add"), chunked into rows of three so an
  // expanded category's subcategory block can slot in right after its full row.
  const cells = [...catNames, '__add__']
  const rows: string[][] = []
  for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3))

  const summary = category ? category + (subcategory ? `/${subcategory}` : '') : ''

  return (
    <>
      <button type="button" className="pick-summary" onClick={openSheet}>
        <span className={summary ? '' : 'muted'}>{summary || placeholder || t('Select')}</span>
        <span className="pick-summary-arrow">›</span>
      </button>

      {open && (
        <Modal title={t('Category')} onClose={close}>
          {adding ? (
            <div className="pick-add">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commitAdd())}
                placeholder={adding === 'sub' ? t('New subcategory') : t('New category')}
              />
              <button type="button" className="btn btn-accent" onClick={commitAdd}>{t('Add')}</button>
              <button type="button" className="btn" onClick={() => { setDraft(''); setAdding(null) }}>✕</button>
            </div>
          ) : (
            <div className="pick-sheet">
              {rows.map((row, ri) => (
                <Fragment key={ri}>
                  <div className="pick-sheet-grid">
                    {row.map((c) =>
                      c === '__add__' ? (
                        <button key={c} type="button" className="pick-cell add" onClick={() => { setAdding('cat'); setDraft('') }}>
                          ＋ {t('Add')}
                        </button>
                      ) : (
                        <button
                          key={c}
                          type="button"
                          className={c === category ? 'pick-cell on' : 'pick-cell'}
                          onClick={() => pickCategory(c)}
                        >
                          {c}
                          {hasSubs(c) && <span className="pick-caret">{expanded === c ? '▴' : '▾'}</span>}
                        </button>
                      ),
                    )}
                  </div>

                  {mounted && row.includes(mounted) && (
                    <div className={shown ? 'pick-subwrap open' : 'pick-subwrap'}>
                      <div className="pick-sheet-grid pick-subgrid">
                        <button
                          type="button"
                          className={subcategory === '' ? 'pick-cell on' : 'pick-cell'}
                          onClick={() => pickSub('')}
                        >
                          {t('None')}
                        </button>
                        {subsOf(mounted).map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={s === subcategory ? 'pick-cell on' : 'pick-cell'}
                            onClick={() => pickSub(s)}
                          >
                            {s}
                          </button>
                        ))}
                        <button type="button" className="pick-cell add" onClick={() => { setAdding('sub'); setDraft('') }}>
                          ＋ {t('Add')}
                        </button>
                      </div>
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
