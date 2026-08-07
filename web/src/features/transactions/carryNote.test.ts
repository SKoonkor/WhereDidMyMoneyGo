import { describe, it, expect, beforeEach } from 'vitest'
import {
  CARRY_MS, setCarry, dismissCarry, revealCarry, readCarry,
  registerCarryFill, carryFiller, resetCarry,
} from './carryNote'

const T0 = Date.UTC(2026, 7, 7, 10, 0, 0)

beforeEach(() => { resetCarry() })

describe('setCarry', () => {
  it('holds a leftover amount', () => {
    setCarry(92, T0)
    expect(readCarry(T0)).toMatchObject({ amount: 92, at: T0, hidden: false })
  })

  it('clears on a save with nothing left over', () => {
    setCarry(92, T0)
    setCarry(null, T0)
    expect(readCarry(T0)).toBeNull()
  })

  it('replaces an older leftover rather than stacking', () => {
    setCarry(92, T0)
    setCarry(40, T0 + 1000)
    expect(readCarry(T0 + 1000)?.amount).toBe(40)
  })

  it('ignores zero and negatives — there is nothing to record', () => {
    setCarry(0, T0)
    expect(readCarry(T0)).toBeNull()
    setCarry(-5, T0)
    expect(readCarry(T0)).toBeNull()
  })
})

describe('readCarry', () => {
  it('expires after the backstop window', () => {
    setCarry(92, T0)
    expect(readCarry(T0 + CARRY_MS - 1)).not.toBeNull()
    expect(readCarry(T0 + CARRY_MS)).toBeNull()
  })
})

describe('dismissCarry / revealCarry', () => {
  it('hides without forgetting, and comes back', () => {
    setCarry(92, T0)
    dismissCarry()
    // Still there — the amount survives the (×), only its visibility changed.
    expect(readCarry(T0)).toMatchObject({ amount: 92, hidden: true })
    revealCarry()
    expect(readCarry(T0)?.hidden).toBe(false)
  })

  it('does nothing when there is no carry', () => {
    dismissCarry()
    revealCarry()
    expect(readCarry(T0)).toBeNull()
  })

  it('cannot resurrect an expired carry', () => {
    setCarry(92, T0)
    dismissCarry()
    revealCarry()
    expect(readCarry(T0 + CARRY_MS)).toBeNull()
  })
})

describe('registerCarryFill', () => {
  it('hands taps to the newest handler', () => {
    const first = () => {}
    const second = () => {}
    registerCarryFill(first)
    registerCarryFill(second)
    expect(carryFiller()).toBe(second)
  })

  it('unregistering an old handler leaves its replacement alone', () => {
    const first = () => {}
    const second = () => {}
    const dropFirst = registerCarryFill(first)
    registerCarryFill(second)
    dropFirst() // the old form unmounts after the new one mounted
    expect(carryFiller()).toBe(second)
  })

  it('stands down when the current handler unregisters', () => {
    const drop = registerCarryFill(() => {})
    drop()
    expect(carryFiller()).toBeNull()
  })
})
