import { describe, expect, it } from 'vitest'
import type { CalEvent } from '../../src/core/calendar'
import { goalProgress, limitLevel, marketToday, rangeR, riskState, todayR, weekR } from '../../src/core/goals'

const ev = (market: 'KR' | 'US', date: string, r: number | null, id = date + market): CalEvent => ({ tradeId: id, market, date, net: r ?? 0, r })

// Thu 2026-10-08 23:30 KST = Thu 10:30 New York (US session open).
const NOW = '2026-10-08T14:30:00.000Z'
// Fri 2026-10-09 02:00 KST = Thu 13:00 New York — still Thursday's US session.
const LATE = '2026-10-08T17:00:00.000Z'

describe('marketToday', () => {
  it('uses each market’s own date', () => {
    expect(marketToday(NOW)).toEqual({ KR: '2026-10-08', US: '2026-10-08' })
    expect(marketToday(LATE)).toEqual({ KR: '2026-10-09', US: '2026-10-08' })
  })
})

describe('today and week', () => {
  const events = [
    ev('KR', '2026-10-08', -1.5),
    ev('US', '2026-10-08', -1),
    ev('US', '2026-10-07', 2),
    ev('KR', '2026-10-05', -0.5),
    ev('KR', '2026-10-02', -9), // last week
    ev('US', '2026-10-08', null, 'nostop'),
  ]
  it('sums today per market date and counts results without R', () => {
    expect(todayR(events, NOW)).toEqual({ r: -2.5, missing: 1 })
    // After midnight in Seoul the KR day is Friday (nothing yet), the US session is still Thursday.
    expect(todayR(events, LATE)).toEqual({ r: -1, missing: 1 })
  })
  it('sums Monday through today', () => {
    expect(weekR(events, NOW)).toEqual({ r: -1, missing: 1 })
    expect(rangeR(events, '2026-10-01', '2026-10-31')).toEqual({ r: -10, missing: 1 })
  })
})

describe('limits', () => {
  it('warns at 80 % and stops at the limit', () => {
    expect(limitLevel(-1, 3)).toBe('ok')
    expect(limitLevel(-2.4, 3)).toBe('warn')
    expect(limitLevel(-3, 3)).toBe('stop')
    expect(limitLevel(-5, 3)).toBe('stop')
    expect(limitLevel(2, 3)).toBe('ok')
    expect(limitLevel(-5, null)).toBeNull()
    expect(limitLevel(-5, 0)).toBeNull()
  })
  it('takes the worse of the daily and weekly state', () => {
    const events = [ev('KR', '2026-10-08', -1), ev('KR', '2026-10-06', -4.2)]
    const s = riskState(events, { monthlyR: 10, dailyLossR: 3, weeklyLossR: 6 }, NOW)
    expect([s.daily, s.weekly, s.level]).toEqual(['ok', 'warn', 'warn'])
    expect(riskState(events, { monthlyR: null, dailyLossR: 1, weeklyLossR: 6 }, NOW).level).toBe('stop')
    expect(riskState(events, { monthlyR: null, dailyLossR: null, weeklyLossR: null }, NOW).level).toBeNull()
  })
})

describe('goalProgress', () => {
  it('clamps between 0 and 1', () => {
    expect(goalProgress(4.2, 10)).toBeCloseTo(0.42, 12)
    expect(goalProgress(-3, 10)).toBe(0)
    expect(goalProgress(12, 10)).toBe(1)
    expect(goalProgress(3, null)).toBeNull()
  })
})
