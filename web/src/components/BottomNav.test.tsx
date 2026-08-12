import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { enterTrading, resetTradingMode } from '../tradingMode'

// The one render test in the app, and it earns its place: BottomNav ships on
// every screen, and the change that repurposes its five slots for paper trading
// hangs off a single ternary pair feeding ONE useHold call. Get that pair wrong
// and either every user loses the ＋, or a hold on a button that currently means
// "place an order" opens the AI receipt scanner — which, with "Review before
// saving" off, writes a real Expense to the real ledger.

function renderNav(props: Partial<Parameters<typeof BottomNav>[0]> = {}) {
  const handlers = {
    onAdd: vi.fn(),
    onLongPress: vi.fn(),
    onCentre: vi.fn(),
    onChartSettings: vi.fn(),
    ...props,
  }
  render(
    <MemoryRouter>
      <BottomNav {...handlers} />
    </MemoryRouter>,
  )
  return handlers
}

/** Hold the ＋ past useHold's 500 ms threshold, on fake timers. `act` because the
 *  hold's own setPressing(false) lands inside the timer callback.
 *  (setPointerCapture is absent in jsdom; useHold already swallows that throw.) */
function holdCentre(label: string) {
  fireEvent.pointerDown(screen.getByLabelText(label))
  act(() => { vi.advanceTimersByTime(600) })
}

beforeEach(() => {
  resetTradingMode()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('BottomNav', () => {
  it('shows the money slots and their targets outside trading', () => {
    renderNav()
    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/')
    expect(screen.getByText('Transactions').closest('a')).toHaveAttribute('href', '/transactions')
    expect(screen.getByText('Apps').closest('a')).toHaveAttribute('href', '/apps')
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings')
    expect(screen.getByLabelText('Add transaction')).toBeInTheDocument()
    expect(screen.queryByText('Chart')).not.toBeInTheDocument()
  })

  it('repurposes the slots in trading, with slot 5 a button rather than a link', () => {
    enterTrading()
    renderNav()
    expect(screen.getByText('Chart').closest('a')).toHaveAttribute('href', '/trading')
    expect(screen.getByText('Accounts').closest('a')).toHaveAttribute('href', '/trading/accounts')
    // Slot 4 is the one that does not change.
    expect(screen.getByText('Apps').closest('a')).toHaveAttribute('href', '/apps')
    expect(screen.getByLabelText('Buy or sell')).toBeInTheDocument()
    expect(screen.queryByLabelText('Add transaction')).not.toBeInTheDocument()

    const settings = screen.getByText('Chart settings').closest('button')
    expect(settings).toBeInTheDocument()
    expect(screen.getByText('Chart settings').closest('a')).toBeNull()
  })

  it('fires onLongPress on a hold outside trading', () => {
    const h = renderNav()
    holdCentre('Add transaction')
    expect(h.onLongPress).toHaveBeenCalledTimes(1)
    expect(h.onCentre).not.toHaveBeenCalled()
  })

  it('fires onCentre — and never onLongPress — on a hold inside trading', () => {
    enterTrading()
    const h = renderNav()
    holdCentre('Buy or sell')
    expect(h.onCentre).toHaveBeenCalledTimes(1)
    expect(h.onLongPress).not.toHaveBeenCalled()
    expect(h.onAdd).not.toHaveBeenCalled()
  })

  it('still holds to the tap action when no long-press handler is supplied', () => {
    const h = renderNav({ onLongPress: undefined })
    holdCentre('Add transaction')
    expect(h.onAdd).toHaveBeenCalledTimes(1)
  })
})
