import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IncomeTaxPage } from './IncomeTaxPage'
import { db, ensureSeeded, getTax, getCategories, saveCategories, renameSubcategory, deleteSubcategory, saveTax } from '../../db'

beforeEach(async () => {
  await db.transactions.clear()
  await db.config.clear()
  await ensureSeeded()
  const cats = await getCategories()
  cats.expense = { ...cats.expense, Tax: ['Withholding', 'Prepaid'] }
  await saveCategories(cats)
})

const taxSel = async () => (await getTax()).taxSelections

describe('Tax already paid picker', () => {
  it('tap a category opens its strip; tapping a sub stores "Category / Sub"', async () => {
    render(<IncomeTaxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Tax\s*▾/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Prepaid' }))
    await waitFor(async () => expect(await taxSel()).toEqual(['Tax / Prepaid']))
  })

  it('"All Tax" stores the whole category; a sub tap then excludes just that sub', async () => {
    render(<IncomeTaxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Tax\s*▾/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'All Tax' }))
    await waitFor(async () => expect(await taxSel()).toEqual(['Tax']))
    // liveQuery re-renders a beat after the write; click only once it has.
    await waitFor(() => expect(screen.getByRole('button', { name: 'All Tax' })).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(screen.getByRole('button', { name: 'Prepaid' }))
    await waitFor(async () => expect(await taxSel()).toEqual(['Tax / Withholding']))
  })

  it('two rapid taps both land (no lost update)', async () => {
    render(<IncomeTaxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Tax\s*▾/ }))
    const a = await screen.findByRole('button', { name: 'Withholding' })
    const b = await screen.findByRole('button', { name: 'Prepaid' })
    fireEvent.click(a)
    fireEvent.click(b)
    await waitFor(async () => expect(await taxSel()).toEqual(['Tax']))
  })

  it('an income tap right after a tax pick does not undo it', async () => {
    render(<IncomeTaxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Tax\s*▾/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Prepaid' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Salary' }))
    await waitFor(async () => {
      const c = await getTax()
      expect(c.taxSelections).toEqual(['Tax / Prepaid'])
      expect(c.incomeSelections).toEqual(['Salary'])
    })
  })

  it('a string-valued taxSelections from an old backup is normalised', async () => {
    await db.config.put({ key: 'tax', value: { country: 'Thailand', allowances: {}, taxSelections: 'Tax' } })
    expect((await getTax()).taxSelections).toEqual(['Tax'])
  })

  it('selections follow a sub-category rename and drop on delete', async () => {
    await saveTax({ ...(await getTax()), taxSelections: ['Tax / Prepaid', 'Tax / Withholding'] })
    await renameSubcategory('Tax', 'Prepaid', 'Pre')
    expect(await taxSel()).toEqual(['Tax / Pre', 'Tax / Withholding'])
    await deleteSubcategory('Tax', 'Pre')
    expect(await taxSel()).toEqual(['Tax / Withholding'])
  })
})
