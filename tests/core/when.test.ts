import { describe, expect, it } from 'vitest'
import { isLocalDateTime, previousWeekday, shiftDays, withDate } from '../../src/core/when'

describe('datetime-local helpers', () => {
  it('shifts by calendar days keeping the time', () => {
    expect(shiftDays('2026-10-31T15:13', -1)).toBe('2026-10-30T15:13')
    expect(shiftDays('2026-03-01T09:00', -1)).toBe('2026-02-28T09:00')
    expect(shiftDays('2026-12-31T23:59', 1)).toBe('2027-01-01T23:59')
    expect(shiftDays('bad', 1)).toBe('bad')
  })
  it('steps back to the previous weekday', () => {
    expect(previousWeekday('2026-11-02T10:00')).toBe('2026-10-30T10:00') // Mon → Fri
    expect(previousWeekday('2026-11-01T10:00')).toBe('2026-10-30T10:00') // Sun → Fri
    expect(previousWeekday('2026-10-30T10:00')).toBe('2026-10-29T10:00') // Fri → Thu
  })
  it('swaps the date part', () => {
    expect(withDate('2026-10-31T15:13', '2026-10-29')).toBe('2026-10-29T15:13')
    expect(withDate('2026-10-31T15:13', 'x')).toBe('2026-10-31T15:13')
    expect(isLocalDateTime('2026-10-31T15:13')).toBe(true)
    expect(isLocalDateTime('2026-10-31')).toBe(false)
  })
})
