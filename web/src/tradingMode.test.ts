import { describe, it, expect, beforeEach } from 'vitest'
import {
  isTrading, enterTrading, exitTrading, openSheet, closeSheet, currentSheet,
  currentPendingExit, requestLeave, confirmExit, cancelExit, resetTradingMode,
} from './tradingMode'

beforeEach(() => {
  resetTradingMode()
})

describe('the trading mode flag', () => {
  it('starts off, so nothing about the app changes for someone who never opens it', () => {
    expect(isTrading()).toBe(false)
  })

  it('turns on and off', () => {
    enterTrading()
    expect(isTrading()).toBe(true)
    exitTrading()
    expect(isTrading()).toBe(false)
  })

  it('mirrors itself into sessionStorage, and survives a re-read', () => {
    // Per-tab on purpose: a reload mid-position must not eject the user, and a
    // visit last week must not still be dressing the nav as a trading bar.
    enterTrading()
    expect(sessionStorage.getItem('trading-mode')).toBe('on')
    exitTrading()
    expect(sessionStorage.getItem('trading-mode')).toBeNull()
  })
})

describe('requestLeave', () => {
  it('lets everything through when the mode is off', () => {
    // The regression this exists to catch: this predicate sits on every tile of
    // the Apps page. Getting it wrong with the mode off breaks the launcher.
    expect(requestLeave('/budget')).toBe(true)
    expect(requestLeave('/')).toBe(true)
    expect(requestLeave('/trading')).toBe(true)
  })

  it('lets trading destinations through without a prompt', () => {
    enterTrading()
    expect(requestLeave('/trading')).toBe(true)
    expect(requestLeave('/trading/accounts')).toBe(true)
    expect(requestLeave('/trading/options')).toBe(true)
  })

  it('stops a departure and remembers where it was headed', () => {
    enterTrading()
    expect(requestLeave('/budget')).toBe(false)
    expect(currentPendingExit()).toBe('/budget')
    expect(confirmExit()).toBe('/budget')
  })

  it('leaves the mode on when the departure is cancelled', () => {
    enterTrading()
    requestLeave('/budget')
    cancelExit()
    expect(isTrading()).toBe(true)
    expect(currentPendingExit()).toBeNull()
    // …and a second attempt still asks rather than sailing through.
    expect(requestLeave('/budget')).toBe(false)
  })

  it('ends the mode when the departure is confirmed', () => {
    enterTrading()
    requestLeave('/budget')
    confirmExit()
    expect(isTrading()).toBe(false)
    expect(requestLeave('/budget')).toBe(true)
  })

  it('falls back to home when confirmed with nothing pending', () => {
    enterTrading()
    expect(confirmExit()).toBe('/')
  })
})

describe('the mode sheets', () => {
  it('replaces rather than stacks', () => {
    // One nullable field is what makes this true by construction: tapping
    // Settings while the ticket is up should swap, never layer two sheets.
    enterTrading()
    openSheet('ticket')
    expect(currentSheet()).toBe('ticket')
    openSheet('settings')
    expect(currentSheet()).toBe('settings')
    // One close empties it — there is no second sheet underneath.
    closeSheet()
    expect(currentSheet()).toBeNull()
  })

  it('is cleared by leaving the mode', () => {
    // A sheet surviving the exit would render over the normal app.
    enterTrading()
    openSheet('ticket')
    exitTrading()
    expect(currentSheet()).toBeNull()
    expect(isTrading()).toBe(false)
  })

  it('is cleared when a departure is confirmed', () => {
    enterTrading()
    openSheet('settings')
    requestLeave('/budget')
    confirmExit()
    expect(currentSheet()).toBeNull()
    expect(currentPendingExit()).toBeNull()
  })
})
