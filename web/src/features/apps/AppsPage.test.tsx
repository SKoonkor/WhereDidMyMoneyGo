import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppsPage } from './AppsPage'
import { TRADING_ENABLED } from '../../tradingMode'

// Paper trading is parked behind TRADING_ENABLED. The Apps page is the only
// place a user could ever reach it from, so this is the assertion that the
// feature is actually unreachable — not merely that a flag exists somewhere.
describe('AppsPage', () => {
  const renderPage = () => render(<MemoryRouter><AppsPage /></MemoryRouter>)

  it('still lists the finance apps and the calculators', () => {
    renderPage()
    expect(screen.getByText('Personal Finance')).toBeTruthy()
    expect(screen.getByText('Calculators')).toBeTruthy()
    expect(screen.getByText('Budget')).toBeTruthy()
  })

  it('hides paper trading while it is parked', () => {
    expect(TRADING_ENABLED).toBe(false)
    renderPage()
    expect(screen.queryByText('Paper trading')).toBeNull()
    // The heading has to go with the tile, or an empty section is left behind.
    expect(screen.queryByText('Simulators')).toBeNull()
    expect(document.querySelector('a[href*="/trading"]')).toBeNull()
  })
})
