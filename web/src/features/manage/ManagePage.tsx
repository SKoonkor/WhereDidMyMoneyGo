import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  accountUsage, categoryUsage, subcategoryUsage,
  getCategories, saveCategories,
  addAccount, renameAccount, deleteAccount, reorderAccounts,
  addCategory, renameCategory, deleteCategory, reorderCategories,
  addSubcategory, renameSubcategory, deleteSubcategory,
} from '../../db'
import { useAccounts, useCategories } from '../transactions/useConfig'
import { t } from '../../i18n'

// One editable line: shows the name, a usage count, reorder arrows, and
// Rename / Delete. Rename edits inline; delete is blocked while the item is in
// use (mirrors manage.py, which rewrites past transactions on rename and only
// allows deleting something no transaction references).
function Row({
  name, used, canUp, canDown, onRename, onDelete, onUp, onDown, onToggle, expanded,
}: {
  name: string
  used: number
  canUp: boolean
  canDown: boolean
  onRename: (next: string) => Promise<boolean>
  onDelete: () => void | Promise<void>
  onUp: () => void
  onDown: () => void
  onToggle?: () => void
  expanded?: boolean
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
    if (used > 0) {
      setErr(t('In use by {n} transaction(s) — reassign those first.', { n: used }))
      return
    }
    if (confirm(t('Delete "{name}"?', { name }))) onDelete()
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
    <div className="manage-row">
      <div className="manage-reorder">
        <button type="button" aria-label={t('Move up')} disabled={!canUp} onClick={onUp}>▲</button>
        <button type="button" aria-label={t('Move down')} disabled={!canDown} onClick={onDown}>▼</button>
      </div>
      <span className="manage-name" onClick={onToggle} style={onToggle ? { cursor: 'pointer' } : undefined}>
        {onToggle && <span className="manage-caret">{expanded ? '▾' : '▸'}</span>}
        {name}
        {used > 0 && <span className="manage-used"> · {t('{n} used', { n: used })}</span>}
      </span>
      <button type="button" className="btn sm" onClick={() => { setVal(name); setErr(''); setEditing(true) }}>
        {t('Rename')}
      </button>
      <button type="button" className="btn sm danger" onClick={del}>{t('Delete')}</button>
      {err && <span className="manage-err">{err}</span>}
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

function move<T>(arr: T[], i: number, delta: number): T[] {
  const next = [...arr]
  const [item] = next.splice(i, 1)
  next.splice(i + delta, 0, item)
  return next
}

// Persist a reordered subcategory list without touching other categories.
async function saveSubOrder(category: string, order: string[]) {
  const cats = await getCategories()
  cats.expense = { ...cats.expense, [category]: order }
  await saveCategories(cats)
}

// Subcategory list under one expense category.
function SubList({ category }: { category: string }) {
  const categories = useCategories()
  const subs = categories.expense[category] ?? []
  const usage = useLiveQuery(() => subcategoryUsage(category), [category], {} as Record<string, number>) ?? {}
  return (
    <div className="manage-list sub">
      {subs.map((s, i) => (
        <Row
          key={s}
          name={s}
          used={usage[s] ?? 0}
          canUp={i > 0}
          canDown={i < subs.length - 1}
          onUp={() => saveSubOrder(category, move(subs, i, -1))}
          onDown={() => saveSubOrder(category, move(subs, i, 1))}
          onRename={(next) => renameSubcategory(category, s, next)}
          onDelete={() => deleteSubcategory(category, s)}
        />
      ))}
      <AddRow placeholder={t('New subcategory')} onAdd={(n) => addSubcategory(category, n)} />
    </div>
  )
}

export function ManagePage() {
  const accounts = useAccounts()
  const categories = useCategories()
  const acctUse = useLiveQuery(() => accountUsage(), [], {} as Record<string, number>) ?? {}
  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const catUse = useLiveQuery(() => categoryUsage(kind), [kind], {} as Record<string, number>) ?? {}
  const [openCat, setOpenCat] = useState<string | null>(null)

  const catNames = Object.keys(categories[kind])

  return (
    <div>
      <h1 className="h1">{t('Manage accounts & categories')}</h1>

      <section className="manage-section">
        <h2 className="manage-h2">{t('Accounts')}</h2>
        <div className="manage-list">
          {accounts.map((a, i) => (
            <Row
              key={a}
              name={a}
              used={acctUse[a] ?? 0}
              canUp={i > 0}
              canDown={i < accounts.length - 1}
              onUp={() => reorderAccounts(move(accounts, i, -1))}
              onDown={() => reorderAccounts(move(accounts, i, 1))}
              onRename={(next) => renameAccount(a, next)}
              onDelete={() => deleteAccount(a)}
            />
          ))}
          <AddRow placeholder={t('New account')} onAdd={addAccount} />
        </div>
      </section>

      <section className="manage-section">
        <h2 className="manage-h2">{t('Categories')}</h2>
        <div className="seg">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={k === kind ? 'seg-btn active' : 'seg-btn'}
              onClick={() => { setKind(k); setOpenCat(null) }}
            >
              {t(k === 'income' ? 'Income' : 'Expense')}
            </button>
          ))}
        </div>
        <div className="manage-list">
          {catNames.map((c, i) => (
            <div key={c}>
              <Row
                name={c}
                used={catUse[c] ?? 0}
                canUp={i > 0}
                canDown={i < catNames.length - 1}
                onUp={() => reorderCategories(kind, move(catNames, i, -1))}
                onDown={() => reorderCategories(kind, move(catNames, i, 1))}
                onRename={(next) => renameCategory(kind, c, next)}
                onDelete={() => deleteCategory(kind, c)}
                onToggle={kind === 'expense' ? () => setOpenCat(openCat === c ? null : c) : undefined}
                expanded={openCat === c}
              />
              {kind === 'expense' && openCat === c && <SubList category={c} />}
            </div>
          ))}
          <AddRow placeholder={t('New category')} onAdd={(n) => addCategory(kind, n)} />
        </div>
      </section>
    </div>
  )
}
