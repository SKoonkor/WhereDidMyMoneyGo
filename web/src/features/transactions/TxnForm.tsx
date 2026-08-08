import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addTxn, updateTxn, addTransfer, updateTransfer, deleteTxn, getGoals, getTransferGoal,
  addAccount, addCategory, addSubcategory, type Txn, type TxnType,
} from '../../db'
import { EMERGENCY_FUND } from '../../data/defaults'
import { useAccounts, useCategories, useBaseCurrency, useSettings } from './useConfig'
import { ChipPicker } from './ChipPicker'
import { CategoryPicker } from './CategoryPicker'
import { Modal } from '../../components/Modal'
import { NumberField } from '../../components/NumberField'
import { dateStatus, isOldDateWarningSnoozed, snoozeOldDateWarning, type DateStatus } from './dateWarn'
import { kindOf, txnChanged, type Kind } from './txnDirty'
import { parseAmountExpr, exprText } from './amountExpr'
import { setCarry, revealCarry, registerCarryFill } from './carryNote'
import { t, getLang } from '../../i18n'

// User-facing type choices; a Transfer expands to two -In/-Out legs on save.
// Saving isn't a separate kind — it's a Transfer into a savings account, and
// Settings decides which accounts count toward the savings pool.
const KINDS: Kind[] = ['Expense', 'Income', 'Transfer']

const today = () => new Date().toISOString().slice(0, 10)

// Money as it reads on a receipt. The typed sum is played back by exprText, which
// lives in amountExpr.ts so it can render × and ÷ from the same token stream the
// parser produced.
const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Values to pre-fill a fresh (non-editing) form — e.g. from an AI receipt scan.
// Everything is optional; a missing field just starts blank/default. `account`
// is intentionally absent (receipts don't say which account paid), so the user
// always picks it. Ignored when `editing` is set.
export interface TxnPrefill {
  kind?: Kind
  amount?: number | null
  date?: string | null
  note?: string
  category?: string
}

// Add or edit a transaction. `editing` is the row tapped (for a transfer, the
// collapsed Transfer-Out leg); `initialDate` pre-fills the date when adding (e.g.
// tapping a day header); `prefill` seeds a new form from an AI receipt draft.
// Closes via onClose after a successful save/delete.
export function TxnForm({
  editing,
  onClose,
  initialDate,
  prefill,
  notice,
}: {
  editing?: Txn | null
  onClose: () => void
  initialDate?: string
  prefill?: TxnPrefill
  notice?: string // small banner atop the form (e.g. a low-confidence scan warning)
}) {
  const accounts = useAccounts()
  const categories = useCategories()
  const currency = useBaseCurrency()

  const [kind, setKind] = useState<Kind>(editing ? kindOf(editing) : prefill?.kind ?? 'Expense')
  const [period, setPeriod] = useState(editing?.period.slice(0, 10) ?? prefill?.date ?? initialDate ?? today())
  const [amount, setAmount] = useState(
    editing ? String(editing.amount) : prefill?.amount != null ? String(prefill.amount) : '',
  )
  const [note, setNote] = useState(editing?.note ?? prefill?.note ?? '')
  // Single-row fields (Income/Expense) — start unselected so the picker prompts
  // "Select account / category" rather than pre-choosing one. A scanned category
  // seeds `category` but is cleared below if it isn't a real category.
  const [account, setAccount] = useState(editing?.account ?? '')
  const [category, setCategory] = useState(editing?.category ?? prefill?.category ?? '')
  const [subcategory, setSubcategory] = useState(editing?.subcategory ?? '')
  // Transfer fields — for the Out leg, account=from and category=to.
  const [from, setFrom] = useState(editing?.account ?? '')
  const [to, setTo] = useState(
    editing && kindOf(editing) === 'Transfer' ? editing.category : '',
  )

  // ── Goal earmarking (transfers that cross the savings-pool boundary) ───────
  // Which goal this transfer's money belongs to. '' = leave it in the unallocated
  // pool, which is also what a transfer that misses the pool always means.
  const settings = useSettings()
  const goalsCfg = useLiveQuery(() => getGoals(), [])
  const [goal, setGoal] = useState('')
  // Prefill from the linked move when editing an existing transfer.
  const storedGoal = useLiveQuery(
    () => (editing?.transferId ? getTransferGoal(editing.transferId) : Promise.resolve('')),
    [editing?.transferId],
  )
  const [goalSeeded, setGoalSeeded] = useState(false)
  useEffect(() => {
    if (!goalSeeded && storedGoal !== undefined) { setGoal(storedGoal); setGoalSeeded(true) }
  }, [storedGoal, goalSeeded])

  // Only offered when the transfer changes the pool total — with the pool on both
  // sides (or neither) there is nothing to earmark, and db.ts drops the goal anyway.
  const pool = useMemo(() => new Set(settings.savingsAccounts), [settings.savingsAccounts])
  const crossesPool = kind === 'Transfer' && !!from && !!to && pool.has(from) !== pool.has(to)
  const goalOptions = useMemo(
    () => [EMERGENCY_FUND, ...Object.keys(goalsCfg?.goals ?? {})],
    [goalsCfg],
  )
  // The picker deals in labels; index 0 is "leave it unallocated".
  const goalLabelOf = (g: string) => (g ? (g === EMERGENCY_FUND ? t(EMERGENCY_FUND) : g) : t('Unallocated'))
  const goalLabels = useMemo(
    () => [t('Unallocated'), ...goalOptions.map(goalLabelOf)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goalOptions],
  )

  const catNames = useMemo(
    () => Object.keys(kind === 'Income' ? categories.income : categories.expense),
    [kind, categories],
  )

  // Clear the category if it isn't valid for the current kind's option list
  // (e.g. after switching Expense↔Income) — but never auto-select one.
  useEffect(() => {
    if (kind !== 'Transfer' && category && !catNames.includes(category)) {
      setCategory('')
      setSubcategory('')
    }
  }, [kind, catNames, category])

  // ── Amount as a mini calculator ───────────────────────────────────────────
  // The field takes several amounts ("500 - 75 + 25"); the net is what's saved and
  // whatever was subtracted is carried out to the note after a successful save.
  const expr = useMemo(() => parseAmountExpr(amount), [amount])
  const amountNum = expr.net
  // Drives the hint under the field: the tip while the box is empty-ish and
  // focused, the running total once there's arithmetic to check.
  const [amountFocus, setAmountFocus] = useState(false)

  // Let a tap on the floating note land in this form rather than opening another
  // one. Appended as a new term instead of replacing, so a tap can never wipe out
  // something half-typed — and the preview line shows the result immediately.
  useEffect(() => registerCarryFill((n) => {
    setAmount((a) => (a.trim() ? `${a.trim()} + ${n}` : String(n)))
  }), [])

  // Required-field validation. `attempted` flips on the first Save press, so the
  // red outlines appear only after the user tries to save; they then clear live as
  // each field is corrected. Note is optional (blank → "-" in the list).
  const [attempted, setAttempted] = useState(false)
  const errors = {
    date: !period,
    amount: !(expr.valid && amountNum > 0),
    account: kind !== 'Transfer' && !account,
    category: kind !== 'Transfer' && !category,
    from: kind === 'Transfer' && !from,
    to: kind === 'Transfer' && (!to || to === from),
  }
  const invalid = (k: keyof typeof errors) => attempted && errors[k]

  // Counts failed Save presses so the offending fields can re-animate on EVERY
  // press, not just the first: `attempted` alone stops changing after press one.
  // Odd/even picks between two identical animations — see the .nudge-a/.nudge-b
  // comment in App.css for why the same one can't simply be re-applied.
  const [nudge, setNudge] = useState(0)

  // Unusual-date safeguard: which confirmation (if any) is currently blocking the
  // save — 'future' or 'old'. Null means no confirmation is showing.
  const [dateWarn, setDateWarn] = useState<DateStatus | null>(null)
  // The last gate before the write, covering two separate safeguards in one dialog
  // so they can't stack: `amount` shows the arithmetic that's about to be saved,
  // `edit` warns that an existing row is being overwritten. Null means no dialog.
  const [confirmSave, setConfirmSave] = useState<{ amount: boolean; edit: boolean } | null>(null)

  // Write the row(s) and close. Called once validation (and any date confirmation)
  // has passed.
  async function commit() {
    if (kind === 'Transfer') {
      const tr = {
        period, amount: amountNum, from, to, note: note || undefined,
        // Dropped when the transfer doesn't cross the pool — a goal there would
        // earmark money the pool never gained or lost.
        goal: crossesPool ? goal || undefined : undefined,
      }
      if (editing?.transferId) await updateTransfer(editing.transferId, tr)
      else await addTransfer(tr)
    } else {
      const type: TxnType = kind // Income | Expense map 1:1
      const row = {
        period, account, amount: amountNum, type,
        category,
        subcategory: kind === 'Expense' ? subcategory || undefined : undefined,
        note: note || undefined,
      }
      if (editing) await updateTxn(editing.id, row)
      else await addTxn(row)
    }
    // Hand whatever was subtracted to the floating note — and clear a previous
    // one when there's nothing left over. Only a completed save touches it, so
    // opening a form and thinking better of it leaves the reminder standing.
    setCarry(expr.negative > 0 ? expr.negative : null)
    onClose()
  }

  // Last gate before the write. An edit that changed something asks first, so a
  // row opened by a stray tap can't be overwritten without a deliberate yes; and
  // an amount that was typed as a sum shows its arithmetic, since that's the one
  // case where what's saved isn't simply what's on screen. Neither applies to a
  // plain new transaction, which still saves in one tap.
  function requestSave() {
    const changed = editing && txnChanged(editing, {
      kind, period, amount: amountNum, note,
      account, category, subcategory, from, to,
      goal: crossesPool ? goal : '',
    }, storedGoal ?? '')
    if (expr.multi || changed) setConfirmSave({ amount: expr.multi, edit: !!changed })
    else void commit()
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    setAttempted(true)
    if (Object.values(errors).some(Boolean)) {
      setNudge((n) => n + 1) // re-animate the offending fields
      return
    }

    // Skip the date check when editing without touching the (legitimately old) date.
    const dateUnchanged = editing && period === editing.period.slice(0, 10)
    const status = dateUnchanged ? 'ok' : dateStatus(period, today())
    // Future dates always confirm; past-date warnings can be snoozed for 30 min.
    if (status === 'future' || (status === 'old' && !isOldDateWarningSnoozed())) {
      setDateWarn(status)
      return
    }
    requestSave()
  }

  async function remove() {
    if (editing && confirm(t('Delete this transaction?'))) {
      await deleteTxn(editing.id)
      onClose()
    }
  }

  return (
    <>
    <form className={`txn-form${nudge ? (nudge % 2 ? ' nudge-a' : ' nudge-b') : ''}`} onSubmit={save}>
      {notice && <p className="txn-notice" role="status">{notice}</p>}
      <div className="seg">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            // Active button fills with its type colour (Income green, Expense
            // dark-red, Transfer grey) to match the transaction-list amounts.
            className={k === kind ? `seg-btn active is-${k.toLowerCase()}` : 'seg-btn'}
            onClick={() => setKind(k)}
          >
            {/* Concise Transfer label on this control; row labels keep the full โอนข้ามบัญชี. */}
            {k === 'Transfer' && getLang() === 'th' ? t('Transfer (short)') : t(k)}
          </button>
        ))}
      </div>

      <div className="row">
        <div className={`field${invalid('date') ? ' is-invalid' : ''}`} style={{ flex: '1 1 0', minWidth: 0 }}>
          <label>{t('Date')}</label>
          {/* Blur on pick so the native calendar closes and applies immediately. */}
          <input
            type="date"
            value={period}
            aria-invalid={invalid('date') || undefined}
            onChange={(e) => { setPeriod(e.target.value); e.target.blur() }}
          />
        </div>
        <div className={`field${invalid('amount') ? ' is-invalid' : ''}`} style={{ flex: '1 1 0', minWidth: 0 }}>
          <label>{t('Amount')} ({currency})</label>
          {/* The pad is up as soon as the sheet is: an amount is the first thing
              anyone types here, and the arithmetic keys are the whole point. */}
          <NumberField
            mode="calc"
            label={`${t('Amount')} (${currency})`}
            autoOpen
            value={amount}
            aria-invalid={invalid('amount') || undefined}
            onChange={setAmount}
            // Going to type an amount is exactly when a dismissed leftover is
            // worth seeing again, so reaching for the field un-hides it.
            onFocus={() => { setAmountFocus(true); revealCarry() }}
            onBlur={() => setAmountFocus(false)}
            placeholder="0"
          />
        </div>
      </div>

      {/* Always rendered, height reserved in CSS, so the form doesn't jump when
          the tip appears on focus or gives way to the running total. */}
      <p className="amount-hint" aria-live="polite">
        {expr.multi && expr.valid ? (
          <>
            <span className="amount-hint-net">= {fmt(amountNum)} {currency}</span>
            {expr.negative > 0 && (
              <span className="amount-hint-aside">
                {' · '}{t('{amount} set aside', { amount: fmt(expr.negative) })}
              </span>
            )}
          </>
        ) : amountFocus && !expr.multi ? (
          t('Tip: type several amounts, e.g. 500 - 75 + 25')
        ) : null}
      </p>

      {kind === 'Transfer' ? (
        <>
          <div className={`field pick-field${invalid('from') ? ' is-invalid' : ''}`}>
            <label>{t('From')}</label>
            <ChipPicker value={from} options={accounts} onChange={setFrom} onAddNew={addAccount} title={t('From')} placeholder={t('Select account')} />
          </div>
          <div className={`field pick-field${invalid('to') ? ' is-invalid' : ''}`}>
            <label>{t('To')}</label>
            <ChipPicker value={to} options={accounts} onChange={setTo} onAddNew={addAccount} title={t('To')} placeholder={t('Select account')} />
          </div>
          {/* Only when this transfer changes the savings-pool total. */}
          {crossesPool && (
            <div className="field pick-field">
              <label>{t('Goal')}</label>
              <ChipPicker
                value={goalLabelOf(goal)}
                options={goalLabels}
                onChange={(label) => {
                  // Matched by position, not by string, so a goal named like one
                  // of the labels can't be mistaken for it.
                  const i = goalLabels.indexOf(label)
                  setGoal(i <= 0 ? '' : goalOptions[i - 1])
                }}
                title={t('Goal')}
              />
              <span className="set-hint">
                {pool.has(to)
                  ? t('Earmark this money for a goal, or leave it unallocated.')
                  : t('Take this money out of a goal, or out of the unallocated pool.')}
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={`field pick-field${invalid('account') ? ' is-invalid' : ''}`}>
            <label>{t('Account')}</label>
            <ChipPicker value={account} options={accounts} onChange={setAccount} onAddNew={addAccount} title={t('Account')} placeholder={t('Select account')} />
          </div>
          <div className={`field pick-field${invalid('category') ? ' is-invalid' : ''}`}>
            <label>{t('Category')}</label>
            <CategoryPicker
              kind={kind}
              category={category}
              subcategory={subcategory}
              catNames={catNames}
              subsOf={(c) => categories.expense[c] ?? []}
              onCategory={(v) => { setCategory(v); setSubcategory('') }}
              onSubcategory={setSubcategory}
              onAddCategory={(n) => addCategory(kind === 'Income' ? 'income' : 'expense', n)}
              onAddSubcategory={(n) => addSubcategory(category, n)}
              placeholder={t('Select category')}
            />
          </div>
        </>
      )}

      <div className="row">
        <div className="field">
          <label>{t('Note')}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Shows in your transaction list')} />
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        {editing ? (
          <button type="button" className="btn" style={{ color: 'var(--expense)' }} onClick={remove}>
            {t('Delete')}
          </button>
        ) : (
          <span />
        )}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn btn-accent">{t('Save')}</button>
        </div>
      </div>
    </form>

    {/* Unusual-date confirmation. Future dates always ask; a past date beyond 10
        days asks too, but offers a 30-minute snooze for back-entering old records. */}
    {dateWarn && (
      <Modal title={t('Check the date')} onClose={() => setDateWarn(null)}>
        <p className="txn-warn-msg">
          {dateWarn === 'future'
            ? t('This date is in the future ({date}). Do you want to save it anyway?', { date: period })
            : t('This date is more than 10 days ago ({date}). Do you want to save it anyway?', { date: period })}
        </p>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => setDateWarn(null)}>{t('Go back')}</button>
          <button type="button" className="btn btn-accent" onClick={() => { setDateWarn(null); requestSave() }}>
            {t('Save anyway')}
          </button>
        </div>
        {dateWarn === 'old' && (
          <button
            type="button"
            className="txn-warn-ignore"
            onClick={() => { snoozeOldDateWarning(); setDateWarn(null); requestSave() }}
          >
            {t('Ignore this warning for 30 minutes')}
          </button>
        )}
      </Modal>
    )}

    {/* Two safeguards sharing one dialog so they can never stack. `amount` plays
        the typed sum back before it's saved; `edit` is the accidental-overwrite
        guard, reachable only when this form was opened on an existing row AND a
        field actually differs — so an edit sheet opened by a stray tap and saved
        untouched still closes without a dialog. */}
    {confirmSave && (
      <Modal
        title={confirmSave.amount ? t('Save this amount?') : t('Save changes?')}
        onClose={() => setConfirmSave(null)}
      >
        {confirmSave.amount && (
          <>
            <div className="amount-confirm">
              <span className="amount-confirm-expr">{exprText(expr.terms)}</span>
              <strong className="amount-confirm-net">{fmt(amountNum)} {currency}</strong>
            </div>
            {expr.negative > 0 && (
              <p className="txn-warn-msg amount-confirm-aside">
                {t('{amount} will be kept as a note, still to record.', {
                  amount: `${fmt(expr.negative)} ${currency}`,
                })}
              </p>
            )}
          </>
        )}
        {confirmSave.edit && <p className="txn-warn-msg">{t('This will update the saved transaction.')}</p>}
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => setConfirmSave(null)}>{t('Go back')}</button>
          <button type="button" className="btn btn-accent" onClick={() => { setConfirmSave(null); void commit() }}>
            {confirmSave.edit ? t('Save changes') : t('Save')}
          </button>
        </div>
      </Modal>
    )}
    </>
  )
}
