import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReconcilePage } from './ReconcilePage'
import { db, ensureSeeded, addTxn, getReconcileState, saveReconcileState } from '../../db'
import { todayISO } from '../../lib/analytics/reconcile'

// The page-level requirements no pure test can reach: the ± sign toggle is gone,
// the reminder switch persists, and Apply stamps the date on every path that
// counts as having reconciled — without ever claiming a balance matched on the
// strength of a half-typed entry.
//
// Note on gating: useAccounts() falls back to DEFAULT_ACCOUNTS synchronously while
// useLiveTxns() starts at [], so the inputs are on screen a frame before the
// ledger is. Anything that depends on a tracked balance has to wait for a value,
// not for the field.

beforeEach(async () => {
  await db.transactions.clear()
  await db.config.clear()
  await ensureSeeded()
})

const renderPage = () => render(<MemoryRouter><ReconcilePage /></MemoryRouter>)

/** Resolves once the reconcile record has loaded and the switch is live. */
const loadedSwitch = async (name: 'Off' | 'On') => {
  const btn = await screen.findByRole('button', { name })
  await waitFor(() => expect(btn).not.toBeDisabled())
  return btn
}

describe('ReconcilePage', () => {
  it('has no ± sign toggle', async () => {
    renderPage()
    await screen.findByText('Cash')
    expect(screen.queryByRole('button', { name: /toggle negative/i })).toBeNull()
    expect(screen.queryByText('±')).toBeNull()
  })

  it('persists the reminder switch', async () => {
    renderPage()
    fireEvent.click(await loadedSwitch('Off'))
    await waitFor(async () => expect((await getReconcileState()).remindersOn).toBe(false))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Off' })).toHaveClass('active'))
  })

  it('starts On, and toggling leaves the date alone', async () => {
    await saveReconcileState({ lastReconciled: '2026-01-01' })
    renderPage()
    // `not.toBeDisabled()` is the load gate, not the class: On carries `.active`
    // on the first frame from the `?? true` default, before the record arrives.
    const on = await loadedSwitch('On')
    expect(on).toHaveClass('active')
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    await waitFor(async () => {
      expect(await getReconcileState()).toEqual({ lastReconciled: '2026-01-01', remindersOn: false })
    })
  })

  // Requirement: Apply must clear the reminder even when every typed balance
  // already matches. It used to refuse outright and leave the nudge up.
  it('stamps today when the entered balances already match', async () => {
    await addTxn({ period: '2026-07-05', account: 'Cash', amount: 200, type: 'Income', category: 'Salary' })
    renderPage()
    const input = await screen.findByLabelText('Cash — Adjust')
    await screen.findByText('200.00') // the ledger has loaded, so tracked is 200
    fireEvent.change(input, { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply reconciliation' }))
    await waitFor(async () => expect((await getReconcileState()).lastReconciled).toBe(todayISO()))
  })

  it('stamps today via "Balances already correct"', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Balances already correct' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, all correct' }))
    await waitFor(async () => {
      expect(await getReconcileState()).toEqual({ lastReconciled: todayISO(), remindersOn: true })
    })
  })

  it('still refuses when nothing at all was entered', async () => {
    renderPage()
    await screen.findByText('Cash')
    fireEvent.click(screen.getByRole('button', { name: 'Apply reconciliation' }))
    await screen.findByText('No discrepancies — nothing to record.')
    expect((await getReconcileState()).lastReconciled).toBeNull()
  })

  // parseAmountExpr reports a trailing operator as VALID (it keeps the terms so
  // far so a running preview doesn't flicker). Read as a balance, "500 - " would
  // be a firm 500 — and against a tracked 500 that reads as "matches", stamping
  // the date and wiping the entry mid-keystroke.
  it('refuses a half-typed sum instead of reading it as a balance', async () => {
    await addTxn({ period: '2026-07-05', account: 'Cash', amount: 500, type: 'Income', category: 'Salary' })
    renderPage()
    const input = await screen.findByLabelText('Cash — Adjust')
    await screen.findByText('500.00')
    fireEvent.change(input, { target: { value: '500 - ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply reconciliation' }))
    await screen.findByText('Finish or clear the highlighted balances first.')
    expect((await getReconcileState()).lastReconciled).toBeNull()
    expect(input).toHaveValue('500 - ') // and the entry survives
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('refuses an entry that does not parse, rather than dropping it', async () => {
    await addTxn({ period: '2026-07-05', account: 'Cash', amount: 200, type: 'Income', category: 'Salary' })
    renderPage()
    await screen.findByText('200.00')
    fireEvent.change(await screen.findByLabelText('Cash — Adjust'), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText('Bank Accounts — Adjust'), { target: { value: '100 ÷ 0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply reconciliation' }))
    await screen.findByText('Finish or clear the highlighted balances first.')
    // The matching Cash row must NOT have been taken as a whole reconciliation.
    expect((await getReconcileState()).lastReconciled).toBeNull()
  })
})
