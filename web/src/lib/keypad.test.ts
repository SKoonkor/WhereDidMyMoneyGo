import { describe, it, expect, beforeEach } from 'vitest'
import {
  pressKey, keyFromEvent, nextKeypadId, openKeypad, closeKeypad, keypadOwner, resetKeypad,
  type Key,
} from './keypad'

// Tap a sequence of keys in one go, the way a finger would.
const type = (keys: Key[], mode: 'calc' | 'digits' = 'calc', allowDecimal = true) =>
  keys.reduce((s, k) => pressKey(s, k, mode, allowDecimal), '')

describe('pressKey — digits', () => {
  it('appends digits', () => {
    expect(type(['5', '0', '0'])).toBe('500')
  })

  it('replaces a lone leading zero rather than growing 007', () => {
    expect(type(['0', '7'])).toBe('7')
    expect(type(['0', '0'])).toBe('0')
    // …but a zero after a decimal point is a real digit.
    expect(type(['0', '.', '0', '5'])).toBe('0.05')
    // …and so is one starting the second number.
    expect(type(['5', '-', '0', '7'])).toBe('5 - 7')
  })
})

describe('pressKey — decimal point', () => {
  it('allows only one per number', () => {
    expect(type(['1', '.', '5', '.'])).toBe('1.5')
    expect(type(['1', '.', '5', '.', '2'])).toBe('1.52')
  })

  it('turns a leading dot into 0.', () => {
    expect(type(['.', '5'])).toBe('0.5')
    expect(type(['1', '+', '.', '5'])).toBe('1 + 0.5')
  })

  it('starts a fresh decimal for each number', () => {
    expect(type(['1', '.', '5', '+', '2', '.', '5'])).toBe('1.5 + 2.5')
  })

  it('is unreachable when the field takes whole numbers only', () => {
    expect(type(['1', '.', '5'], 'digits', false)).toBe('15')
  })
})

describe('pressKey — operators', () => {
  it('writes ASCII + and - but typographic × and ÷', () => {
    expect(type(['5', '+', '2'])).toBe('5 + 2')
    expect(type(['5', '-', '2'])).toBe('5 - 2')
    expect(type(['5', '*', '2'])).toBe('5 × 2')
    expect(type(['5', '/', '2'])).toBe('5 ÷ 2')
  })

  it('replaces a trailing operator instead of stacking one', () => {
    expect(type(['5', '0', '0', '+', '-'])).toBe('500 - ')
    expect(type(['5', '0', '0', '+', '-', '*', '/'])).toBe('500 ÷ ')
    // Two operators in a row can never be entered.
    expect(type(['5', '+', '-', '2'])).toBe('5 - 2')
  })

  it('lets a leading minus stand, but nothing else', () => {
    expect(pressKey('', '-', 'calc')).toBe('-')
    expect(pressKey('', '+', 'calc')).toBe('')
    expect(pressKey('', '*', 'calc')).toBe('')
    expect(pressKey('', '/', 'calc')).toBe('')
    // A negative reconcile balance is typed exactly this way.
    expect(type(['-', '5', '0'])).toBe('-50')
  })

  it('treats another operator after a lone minus as changing the sign', () => {
    expect(pressKey('-', '+', 'calc')).toBe('')
    expect(pressKey('-', '-', 'calc')).toBe('-')
  })

  it('is unreachable in digits mode', () => {
    expect(type(['5', '+', '2'], 'digits')).toBe('52')
    expect(type(['5', '*', '2'], 'digits')).toBe('52')
  })
})

describe('pressKey — backspace and clear', () => {
  it('removes one digit at a time', () => {
    expect(pressKey('500', 'back', 'calc')).toBe('50')
  })

  it('removes a whole " - " group in one press, not one space at a time', () => {
    expect(pressKey('500 - ', 'back', 'calc')).toBe('500')
    expect(pressKey('500 - 7', 'back', 'calc')).toBe('500 - ')
    expect(pressKey('500 × ', 'back', 'calc')).toBe('500')
  })

  it('bottoms out at empty', () => {
    expect(pressKey('5', 'back', 'calc')).toBe('')
    expect(pressKey('', 'back', 'calc')).toBe('')
  })

  it('clear empties everything', () => {
    expect(pressKey('500 - 75 + 25', 'clear', 'calc')).toBe('')
  })
})

describe('pressKey — equals', () => {
  it('collapses the expression in place', () => {
    expect(pressKey('500 - 75 + 25', 'equals', 'calc')).toBe('450')
    expect(pressKey('500 - 3 × 45', 'equals', 'calc')).toBe('365')
    expect(pressKey('1200 ÷ 4', 'equals', 'calc')).toBe('300')
  })

  it('leaves the result plain, so it can go on being edited', () => {
    // Not "268.50" and not "1,200" — the hint line does the formatting.
    expect(pressKey('89.5 × 3', 'equals', 'calc')).toBe('268.5')
    expect(pressKey('600 × 2', 'equals', 'calc')).toBe('1200')
  })

  it('is a no-op on something that does not parse', () => {
    expect(pressKey('500 ÷ 0', 'equals', 'calc')).toBe('500 ÷ 0')
    expect(pressKey('', 'equals', 'calc')).toBe('')
  })

  it('does nothing in digits mode', () => {
    expect(pressKey('45', 'equals', 'digits')).toBe('45')
  })

  it('can be pressed twice without changing anything the second time', () => {
    const once = pressKey('500 - 75', 'equals', 'calc')
    expect(pressKey(once, 'equals', 'calc')).toBe(once)
  })
})

describe('keyFromEvent — physical keyboards still work', () => {
  it('maps the keys a desktop user would reach for', () => {
    expect(keyFromEvent('7')).toBe('7')
    expect(keyFromEvent('.')).toBe('.')
    expect(keyFromEvent(',')).toBe('.') // numpad decimal on a Thai/EU layout
    expect(keyFromEvent('*')).toBe('*')
    expect(keyFromEvent('x')).toBe('*')
    expect(keyFromEvent('/')).toBe('/')
    expect(keyFromEvent('Backspace')).toBe('back')
    expect(keyFromEvent('Enter')).toBe('equals')
  })

  it('ignores everything else, so Tab and Escape reach the browser', () => {
    for (const k of ['Tab', 'Escape', 'a', 'ArrowLeft', 'Shift']) {
      expect(keyFromEvent(k)).toBeNull()
    }
  })
})

describe('keypad ownership', () => {
  beforeEach(resetKeypad)

  it('hands the pad to one field at a time', () => {
    const a = nextKeypadId()
    const b = nextKeypadId()
    expect(a).not.toBe(b)
    openKeypad(a)
    expect(keypadOwner()).toBe(a)
    openKeypad(b)
    expect(keypadOwner()).toBe(b)
  })

  it('ignores a close from a field that no longer holds it', () => {
    const a = nextKeypadId()
    const b = nextKeypadId()
    openKeypad(a)
    openKeypad(b)
    // A's blur arrives after B has taken over; it must not close B's pad.
    closeKeypad(a)
    expect(keypadOwner()).toBe(b)
    closeKeypad(b)
    expect(keypadOwner()).toBeNull()
  })
})
