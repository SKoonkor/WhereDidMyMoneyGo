import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HomePage } from './HomePage'
import { db, ensureSeeded, addTxn, saveReconcileState } from '../../db'

// The banner gate is the whole point of the reminder switch, and it is the one
// part of it that lives above the database — everything else (the merge, the
// backup round trip) is asserted at the Dexie boundary and would stay green with
// this gate deleted.

beforeEach(async () => {
  await db.transactions.clear()
  await db.config.clear()
  await ensureSeeded()
  // The nudge is suppressed on an empty ledger, so every case needs a row.
  await addTxn({ period: '2026-01-05', account: 'Cash', amount: 10, type: 'Income', category: 'Salary' })
})

const renderHome = () => render(<MemoryRouter><HomePage /></MemoryRouter>)

describe('home reconcile banner', () => {
  it('shows when overdue and the reminder is on', async () => {
    await saveReconcileState({ lastReconciled: '2020-01-01', remindersOn: true })
    renderHome()
    expect(await screen.findByText('Time to reconcile')).toBeTruthy()
  })

  it('stays hidden when the reminder is switched off', async () => {
    await saveReconcileState({ lastReconciled: '2020-01-01', remindersOn: false })
    renderHome()
    await screen.findByText('Net worth') // the page really rendered
    await waitFor(() => expect(screen.queryByText('Time to reconcile')).toBeNull())
  })

  it('treats a record written before the switch existed as on', async () => {
    // `!== false`, not truthiness: a legacy row has no such field, and that has
    // to read as "on" rather than silently hiding the nudge.
    await db.config.put({ key: 'reconcile', value: { lastReconciled: '2020-01-01' } })
    renderHome()
    expect(await screen.findByText('Time to reconcile')).toBeTruthy()
  })

  it('stays hidden when nothing is overdue', async () => {
    await saveReconcileState({ lastReconciled: new Date().toISOString().slice(0, 10), remindersOn: true })
    renderHome()
    await screen.findByText('Net worth')
    await waitFor(() => expect(screen.queryByText('Time to reconcile')).toBeNull())
  })
})
