import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  accountUsage, categoryUsage, subcategoryUsage,
  getCategories, saveCategories,
  addAccount, renameAccount, deleteAccount, reorderAccounts,
  addCategory, renameCategory, deleteCategory, reorderCategories,
  addSubcategory, renameSubcategory, deleteSubcategory,
} from '../../db'
import { OTHER_NAME } from '../../data/defaults'
import { useAccounts, useCategories } from '../transactions/useConfig'
import { useDragReorder } from '../../lib/useDragReorder'
import { t } from '../../i18n'

// Drag props handed from a list to each of its rows.
interface DragProps {
  ref: (el: HTMLDivElement | null) => void
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  style: React.CSSProperties | undefined
  dragging: boolean
}

// Confirmation text for a delete, spelling out where affected transactions go.
function acctOrCatPrompt(name: string, used: number): string {
  if (used <= 0) return t('Delete "{name}"?', { name })
  return name === OTHER_NAME
    ? t('Delete "{name}"? {n} transaction(s) will become "Unknown" until you reassign them.', { name, n: used })
    : t('Delete "{name}"? {n} transaction(s) will move to "Other".', { name, n: used })
}
function subPrompt(name: string, used: number): string {
  return used > 0
    ? t('Delete "{name}"? {n} transaction(s) will keep the main category.', { name, n: used })
    : t('Delete "{name}"?', { name })
}

// One editable line: name + usage count, a ⠿ drag handle (grab it to reorder —
// the only drag target, so the row body still scrolls), and Rename / Delete.
// Rename cascades to past transactions;
// Delete reassigns them (see db.ts) after a confirmation that says where they go.
function Row({
  name, used, deletePrompt, onRename, onDelete, drag, caret,
}: {
  name: string
  used: number
  deletePrompt: string
  onRename: (next: string) => Promise<boolean>
  onDelete: () => void | Promise<void>
  drag: DragProps
  caret?: { expanded: boolean; onToggle: () => void }
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(name)
  const [err, setErr] = useState('')

  async function save() {
    const ok = await onRename(val)
    if (ok) setEditing(false)
    else setErr(t('That name already exists.'))
  }
  function del() {
    if (confirm(deletePrompt)) onDelete()
  }

  if (editing) {
    return (
      <div className="manage-row editing">
        <input
          autoFocus
          value={val}
          onChange={(e) => { setVal(e.target.value); setErr('') }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button type="button" className="btn btn-accent sm" onClick={save}>{t('Save')}</button>
        <button type="button" className="btn sm" onClick={() => { setEditing(false); setVal(name); setErr('') }}>
          {t('Cancel')}
        </button>
        {err && <span className="manage-err">{err}</span>}
      </div>
    )
  }

  return (
    <div
      className={`manage-row${drag.dragging ? ' dragging' : ''}`}
      ref={drag.ref}
      style={drag.style}
      onPointerDown={drag.onPointerDown}
    >
      <span className="drag-handle" aria-hidden="true">⠿</span>
      {caret && (
        <button
          type="button"
          className="manage-caret-btn"
          aria-label={caret.expanded ? t('Collapse') : t('Expand')}
          onClick={caret.onToggle}
        >
          {caret.expanded ? '▾' : '▸'}
        </button>
      )}
      <span className="manage-name">
        {name}
        {used > 0 && <span className="manage-used"> · {t('{n} used', { n: used })}</span>}
      </span>
      <button type="button" className="btn sm" onClick={() => { setVal(name); setErr(''); setEditing(true) }}>
        {t('Rename')}
      </button>
      <button type="button" className="btn sm danger" onClick={del}>{t('Delete')}</button>
    </div>
  )
}

// The "＋ add a new item" input at the foot of a list.
function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void | Promise<void> }) {
  const [val, setVal] = useState('')
  async function add() {
    const name = val.trim()
    if (!name) return
    await onAdd(name)
    setVal('')
  }
  return (
    <div className="manage-row add">
      <input
        value={val}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      <button type="button" className="btn sm" onClick={add}>＋ {t('Add')}</button>
    </div>
  )
}

const DRAG_OPTS = { handle: '.drag-handle', ignore: 'button, input', handleOnly: true }

function AccountList() {
  const accounts = useAccounts()
  const acctUse = useLiveQuery(() => accountUsage(), [], {} as Record<string, number>) ?? {}
  const drag = useDragReorder(accounts, (order) => void reorderAccounts(order), DRAG_OPTS)
  return (
    <div className="manage-list" {...drag.listProps}>
      {drag.order.map((a) => (
        <Row
          key={a}
          name={a}
          used={acctUse[a] ?? 0}
          deletePrompt={acctOrCatPrompt(a, acctUse[a] ?? 0)}
          onRename={(next) => renameAccount(a, next)}
          onDelete={() => deleteAccount(a)}
          drag={{ ref: drag.itemRef(a), onPointerDown: drag.onItemPointerDown(a), style: drag.itemStyle(a), dragging: drag.dragging === a }}
        />
      ))}
      <AddRow placeholder={t('New account')} onAdd={addAccount} />
    </div>
  )
}

function CategoryList({ kind }: { kind: 'income' | 'expense' }) {
  const categories = useCategories()
  const catUse = useLiveQuery(() => categoryUsage(kind), [kind], {} as Record<string, number>) ?? {}
  const [openCat, setOpenCat] = useState<string | null>(null)
  const names = Object.keys(categories[kind])
  const drag = useDragReorder(names, (order) => void reorderCategories(kind, order), DRAG_OPTS)
  return (
    <div className="manage-list" {...drag.listProps}>
      {drag.order.map((c) => (
        <div key={c}>
          <Row
            name={c}
            used={catUse[c] ?? 0}
            deletePrompt={acctOrCatPrompt(c, catUse[c] ?? 0)}
            onRename={(next) => renameCategory(kind, c, next)}
            onDelete={() => deleteCategory(kind, c)}
            drag={{ ref: drag.itemRef(c), onPointerDown: drag.onItemPointerDown(c), style: drag.itemStyle(c), dragging: drag.dragging === c }}
            caret={kind === 'expense' ? { expanded: openCat === c, onToggle: () => setOpenCat(openCat === c ? null : c) } : undefined}
          />
          {kind === 'expense' && openCat === c && <SubList category={c} />}
        </div>
      ))}
      <AddRow placeholder={t('New category')} onAdd={(n) => addCategory(kind, n)} />
    </div>
  )
}

// Persist a reordered subcategory list without touching other categories.
async function saveSubOrder(category: string, order: string[]) {
  const cats = await getCategories()
  cats.expense = { ...cats.expense, [category]: order }
  await saveCategories(cats)
}

// Subcategory list under one expense category (also drag-reorderable).
function SubList({ category }: { category: string }) {
  const categories = useCategories()
  const subs = categories.expense[category] ?? []
  const usage = useLiveQuery(() => subcategoryUsage(category), [category], {} as Record<string, number>) ?? {}
  const drag = useDragReorder(subs, (order) => void saveSubOrder(category, order), DRAG_OPTS)
  return (
    <div className="manage-list sub" {...drag.listProps}>
      {drag.order.map((s) => (
        <Row
          key={s}
          name={s}
          used={usage[s] ?? 0}
          deletePrompt={subPrompt(s, usage[s] ?? 0)}
          onRename={(next) => renameSubcategory(category, s, next)}
          onDelete={() => deleteSubcategory(category, s)}
          drag={{ ref: drag.itemRef(s), onPointerDown: drag.onItemPointerDown(s), style: drag.itemStyle(s), dragging: drag.dragging === s }}
        />
      ))}
      <AddRow placeholder={t('New subcategory')} onAdd={(n) => addSubcategory(category, n)} />
    </div>
  )
}

export function ManagePage() {
  const [kind, setKind] = useState<'income' | 'expense'>('expense')

  return (
    <div>
      <h1 className="h1">{t('Manage accounts & categories')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 12 }}>
        {t('Grab the ⠿ handle to drag a row into order.')}
      </p>

      <section className="manage-section">
        <h2 className="manage-h2">{t('Accounts')}</h2>
        <AccountList />
      </section>

      <section className="manage-section">
        <h2 className="manage-h2">{t('Categories')}</h2>
        <div className="seg">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={k === kind ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setKind(k)}
            >
              {t(k === 'income' ? 'Income' : 'Expense')}
            </button>
          ))}
        </div>
        <CategoryList kind={kind} />
      </section>
    </div>
  )
}
