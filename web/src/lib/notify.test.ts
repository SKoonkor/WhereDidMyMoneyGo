import { describe, it, expect } from 'vitest'
import { nextOccurrences } from './notify'

// nextOccurrences is pure; assert against local wall-clock so results are
// timezone-independent (we compare hours/minutes and day sequence, not raw ms).
describe('nextOccurrences', () => {
  it('schedules today when the time is still ahead', () => {
    const from = new Date(2026, 0, 10, 8, 0, 0) // Jan 10, 08:00 local
    const [first] = nextOccurrences('20:00', 1, from)
    const d = new Date(first)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(10)
    expect(d.getHours()).toBe(20)
    expect(d.getMinutes()).toBe(0)
    expect(d.getSeconds()).toBe(0)
  })

  it('rolls to tomorrow when the time already passed', () => {
    const from = new Date(2026, 0, 10, 21, 0, 0) // 21:00, past 20:00
    const [first] = nextOccurrences('20:00', 1, from)
    const d = new Date(first)
    expect(d.getDate()).toBe(11)
    expect(d.getHours()).toBe(20)
  })

  it('treats an exact match as already passed (rolls to next day)', () => {
    const from = new Date(2026, 0, 10, 20, 0, 0) // exactly 20:00
    const [first] = nextOccurrences('20:00', 1, from)
    expect(new Date(first).getDate()).toBe(11)
  })

  it('returns n strictly-increasing consecutive daily occurrences at the same time', () => {
    const from = new Date(2026, 0, 10, 8, 0, 0) // 08:00 → 07:30 already passed today
    const arr = nextOccurrences('07:30', 7, from)
    expect(arr).toHaveLength(7)
    arr.forEach((ts, i) => {
      const d = new Date(ts)
      expect(d.getHours()).toBe(7)
      expect(d.getMinutes()).toBe(30)
      expect(d.getDate()).toBe(11 + i) // rolls to tomorrow, then consecutive days
    })
    for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThan(arr[i - 1])
  })

  it('starts today when the first daily time is still ahead of `from`', () => {
    const from = new Date(2026, 0, 10, 6, 0, 0) // 06:00, before 07:30
    const arr = nextOccurrences('07:30', 3, from)
    expect(new Date(arr[0]).getDate()).toBe(10)
    expect(new Date(arr[2]).getDate()).toBe(12)
  })

  it('handles month rollover', () => {
    const from = new Date(2026, 0, 30, 8, 0, 0) // Jan 30
    const arr = nextOccurrences('09:00', 3, from) // Jan 30, Jan 31, Feb 1
    const ymd = arr.map((ts) => { const d = new Date(ts); return [d.getMonth(), d.getDate()] })
    expect(ymd).toEqual([[0, 30], [0, 31], [1, 1]])
  })
})
