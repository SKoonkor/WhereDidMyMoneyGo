import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TxnForm } from './TxnForm'
import { db, ensureSeeded, getAccounts, getCategories, saveCategories, saveSettings, getSettings } from '../../db'
import { todayISO } from '../../lib/analytics/reconcile'

// What the voice flow hands the form must come out the other side as exactly the
// row the speaker described — and nothing may be written before Save.
let A: string[]
beforeEach(async () => {
  await db.transactions.clear()
  await db.config.clear()
  await ensureSeeded()
  const cats = await getCategories()
  cats.expense = { ...cats.expense, Food: ['Lunch', 'Coffee'] }
  await saveCategories(cats)
  A = await getAccounts()
  await saveSettings({ ...(await getSettings()), savingsAccounts: [] })
})

const rows = () => db.transactions.toArray()
const ready = async () => {
  await screen.findByRole('button', { name: 'Save' })
  await waitFor(() => expect(A.length).toBeGreaterThan(1))
}

describe('TxnForm seeded from a voice draft', () => {
  it('writes nothing until Save, then the exact expense described', async () => {
    const onClose = () => {}
    render(<TxnForm onClose={onClose} prefill={{
      kind: 'Expense', amount: 120, date: todayISO(), note: 'Pad thai', account: A[0], category: 'Food', subcategory: 'Lunch',
    }} />)
    await ready()
    expect(await rows()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await rows()).toHaveLength(1))
    expect((await rows())[0]).toMatchObject({
      type: 'Expense', amount: 120, account: A[0], category: 'Food', subcategory: 'Lunch', note: 'Pad thai', period: todayISO(),
    })
  })

  it('a custom category and sub-category survive the form\'s first render (not wiped by the built-in defaults)', async () => {
    const cats = await getCategories()
    cats.expense = { ...cats.expense, Pets: ['Vet', 'Toys'] }
    await saveCategories(cats)
    render(<TxnForm onClose={() => {}} prefill={{
      kind: 'Expense', amount: 65, date: todayISO(), account: A[0], category: 'Pets', subcategory: 'Vet',
    }} />)
    await ready()
    await new Promise((r) => setTimeout(r, 100)) // let the live categories arrive
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await rows()).toHaveLength(1))
    expect((await rows())[0]).toMatchObject({ category: 'Pets', subcategory: 'Vet', amount: 65 })
  })

  it('a transfer writes both legs between the two accounts', async () => {
    render(<TxnForm onClose={() => {}} prefill={{
      kind: 'Transfer', amount: 500, date: todayISO(), account: A[0], toAccount: A[1],
    }} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await rows()).toHaveLength(2))
    const r = await rows()
    expect(r.find((x) => x.type === 'Transfer-Out')).toMatchObject({ account: A[0], category: A[1], amount: 500 })
    expect(r.find((x) => x.type === 'Transfer-In')).toMatchObject({ account: A[1], category: A[0], amount: 500 })
  })

  it('income keeps its category and account, and drops any sub-category', async () => {
    render(<TxnForm onClose={() => {}} prefill={{
      kind: 'Income', amount: 30000, date: todayISO(), account: A[0], category: 'Salary', subcategory: 'Lunch',
    }} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await rows()).toHaveLength(1))
    const [row] = await rows()
    expect(row).toMatchObject({ type: 'Income', category: 'Salary', account: A[0], amount: 30000 })
    expect(row.subcategory).toBeUndefined()
  })

  it('missing fields stay blank and block Save', async () => {
    render(<TxnForm onClose={() => {}} prefill={{ kind: 'Expense', amount: null, date: todayISO() }} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await new Promise((r) => setTimeout(r, 50))
    expect(await rows()).toHaveLength(0)
  })
})
