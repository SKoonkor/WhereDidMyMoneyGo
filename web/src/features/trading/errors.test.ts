import { describe, it, expect } from 'vitest'
import { cancelReasonLabel, tradeErrorMessage, warningMessage } from './errors'
import type { CancelReason, TradeErrorCode } from '../../lib/trading/broker/types'

// The point of these is not that the wording is right — that is W9's and the
// user's judgement. It is that EVERY code the broker can emit reaches a sentence,
// with its numbers in it, and that nothing leaks machine text.
//
// The union is listed out by hand rather than derived, deliberately: TypeScript
// already fails the build if `errors.ts` misses a code, and this list failing to
// compile is the second signal, from the other direction, that the union moved.

const ALL_CODES: TradeErrorCode[] = [
  'no-symbol', 'unknown-instrument', 'no-quote', 'bad-qty', 'bad-amount',
  'insufficient-funds', 'insufficient-collateral', 'exceeds-leverage',
  'reduce-only-would-open', 'missing-limit', 'missing-stop', 'missing-trail',
  'option-expired', 'margin-deficit', 'market-closed',
]

const ALL_REASONS: CancelReason[] = [...ALL_CODES, 'user', 'ioc', 'day-expired']

describe('trade error messages', () => {
  it('gives every code a real sentence', () => {
    for (const code of ALL_CODES) {
      const msg = tradeErrorMessage({ code })
      expect(msg.length, code).toBeGreaterThan(8)
      // A message that is just the code back means the map fell through.
      expect(msg).not.toBe(code)
      // Nothing may reach the user with an unfilled placeholder in it.
      expect(msg, code).not.toMatch(/\{[a-z]+\}/i)
    }
  })

  it('interpolates the numbers the engine attached', () => {
    const msg = tradeErrorMessage({ code: 'insufficient-funds', vars: { need: 1500.5, have: 200 } })
    expect(msg).toContain('1,500.5')
    expect(msg).toContain('200')
  })

  it('interpolates a symbol', () => {
    expect(tradeErrorMessage({ code: 'unknown-instrument', vars: { symbol: 'XYZ' } })).toContain('XYZ')
  })

  it('survives a code whose vars were not supplied', () => {
    // The engine always attaches them, but a restored order or a future call site
    // might not — an em dash is a far better failure than "NaN" or "undefined".
    const msg = tradeErrorMessage({ code: 'insufficient-funds' })
    expect(msg).toContain('—')
    expect(msg).not.toContain('undefined')
    expect(msg).not.toContain('NaN')
  })

  it('never renders a non-finite number', () => {
    const msg = tradeErrorMessage({ code: 'exceeds-leverage', vars: { cap: Infinity } })
    expect(msg).not.toContain('Infinity')
  })

  it('warnings reuse the same sentences', () => {
    expect(warningMessage('market-closed')).toBe(tradeErrorMessage({ code: 'market-closed' }))
  })
})

describe('cancel reasons', () => {
  it('labels every reason, including the two that are not refusals', () => {
    for (const reason of ALL_REASONS) {
      const label = cancelReasonLabel(reason)
      expect(label.length, reason).toBeGreaterThan(3)
      expect(label).not.toBe(reason)
    }
  })

  it('falls back to the plain word for anything unrecognised', () => {
    // A hand-edited row or a future engine must not print machine text at a user.
    expect(cancelReasonLabel('something-new')).toBe('Cancelled')
    expect(cancelReasonLabel(undefined)).toBe('Cancelled')
  })
})
