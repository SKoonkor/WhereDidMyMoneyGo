import { describe, it, expect } from 'vitest'
import { dateStatus } from './dateWarn'

describe('dateStatus', () => {
  const today = '2026-07-23'

  it('flags future dates', () => {
    expect(dateStatus('2026-07-24', today)).toBe('future')
    expect(dateStatus('2027-01-01', today)).toBe('future')
  })

  it('treats today and recent past as ok', () => {
    expect(dateStatus(today, today)).toBe('ok')
    expect(dateStatus('2026-07-20', today)).toBe('ok')
    // exactly 10 days ago is still within the window
    expect(dateStatus('2026-07-13', today)).toBe('ok')
  })

  it('flags dates more than 10 days old', () => {
    expect(dateStatus('2026-07-12', today)).toBe('old') // 11 days ago
    expect(dateStatus('2026-06-01', today)).toBe('old')
  })
})
