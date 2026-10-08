import { describe, expect, it } from 'vitest'
import {
  addDays,
  dailyBuckets,
  dayChange,
  equityCurve,
  eventValue,
  intensity,
  monthWeeks,
  sumDays,
  summarizePeriod,
  tradeDate,
  tradeEvents,
  weekStart,
  weekdayMon0,
  weeklyStats,
  type CalEvent,
  type CalTradeInput,
  type UnitContext,
} from '../../src/core/calendar'

const fill = (id: string, ts: string, side: 'buy' | 'sell', price: number, qty: number) => ({ id, ts, side, price, qty })
const ctx: UnitContext = { usdkrw: { '2026-10-05': 1400, '2026-10-06': 1410 }, accountKR: 100_000_000, accountUS: 50_000 }

describe('tradeDate', () => {
  it('uses each market’s own calendar day', () => {
    // 2026-10-09 02:00 KST = 2026-10-08 13:00 New York
    expect(tradeDate('2026-10-08T17:00:00.000Z', 'US')).toBe('2026-10-08')
    expect(tradeDate('2026-10-08T17:00:00.000Z', 'KR')).toBe('2026-10-09')
    // 09:30 KST is still the previous UTC day
    expect(tradeDate('2026-10-07T00:30:00.000Z', 'KR')).toBe('2026-10-07')
  })
})

describe('dates', () => {
  it('adds days and finds Monday-first weeks', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(weekdayMon0('2026-10-05')).toBe(0) // Monday
    expect(weekdayMon0('2026-10-11')).toBe(6) // Sunday
    expect(weekStart('2026-10-11')).toBe('2026-10-05')
  })
  it('lays a month out in whole weeks', () => {
    const w = monthWeeks(2026, 10) // Oct 1 2026 is a Thursday
    expect(w).toHaveLength(5)
    expect(w[0][0]).toEqual({ date: '2026-09-28', inMonth: false })
    expect(w[0][3]).toEqual({ date: '2026-10-01', inMonth: true })
    expect(w.at(-1)!.at(-1)).toEqual({ date: '2026-11-01', inMonth: false })
    expect(monthWeeks(2027, 2)).toHaveLength(4) // Feb 2027 starts on a Monday, 28 days
  })
})

const scaled: CalTradeInput = {
  id: 'p1',
  market: 'KR',
  direction: 'long',
  oneR: 100_000,
  fills: [
    fill('b1', '2026-10-05T00:30:00.000Z', 'buy', 10_000, 100),
    fill('s1', '2026-10-06T01:00:00.000Z', 'sell', 11_000, 40), // +40,000
    fill('s2', '2026-10-06T05:00:00.000Z', 'sell', 10_500, 30), // +15,000 same day
    fill('s3', '2026-10-08T02:00:00.000Z', 'sell', 9_000, 30), // −30,000
  ],
}

describe('tradeEvents', () => {
  it('splits a scaled exit across its exit days, merging same-day exits', () => {
    expect(tradeEvents(scaled, 'exit')).toEqual([
      { tradeId: 'p1', market: 'KR', date: '2026-10-06', net: 55_000, r: 0.55 },
      { tradeId: 'p1', market: 'KR', date: '2026-10-08', net: -30_000, r: -0.3 },
    ])
  })
  it('puts the whole result on the first entry day with the entry basis', () => {
    expect(tradeEvents(scaled, 'entry')).toEqual([{ tradeId: 'p1', market: 'KR', date: '2026-10-05', net: 25_000, r: 0.25 }])
  })
  it('has no events before any exit, and no R without 1R', () => {
    expect(tradeEvents({ ...scaled, fills: scaled.fills.slice(0, 1) }, 'exit')).toEqual([])
    expect(tradeEvents({ ...scaled, oneR: null }, 'exit')[0].r).toBeNull()
  })
})

describe('units', () => {
  const us: CalEvent = { tradeId: 'u', market: 'US', date: '2026-10-06', net: 100, r: 1 }
  const kr: CalEvent = { tradeId: 'k', market: 'KR', date: '2026-10-06', net: 141_000, r: 0.5 }
  it('converts with that day’s USD/KRW (or the last earlier one)', () => {
    expect(eventValue(us, 'KRW', ctx)).toBe(141_000)
    expect(eventValue(kr, 'USD', ctx)).toBe(100)
    expect(eventValue({ ...us, date: '2026-10-07' }, 'KRW', ctx)).toBe(141_000) // falls back to 10-06
    expect(eventValue({ ...us, date: '2026-09-01' }, 'KRW', ctx)).toBeNull()
    expect(eventValue(us, 'USD', ctx)).toBe(100)
    expect(eventValue(kr, 'KRW', ctx)).toBe(141_000)
  })
  it('gives R and % of the market’s own account', () => {
    expect(eventValue(us, 'R', ctx)).toBe(1)
    expect(eventValue(us, 'PCT', ctx)).toBeCloseTo(0.2, 12)
    expect(eventValue(kr, 'PCT', ctx)).toBeCloseTo(0.141, 12)
    expect(eventValue(kr, 'PCT', { ...ctx, accountKR: null })).toBeNull()
  })
})

describe('dailyBuckets with KR and US on the same day', () => {
  const events: CalEvent[] = [
    { tradeId: 'k1', market: 'KR', date: '2026-10-06', net: 200_000, r: 1 },
    { tradeId: 'k2', market: 'KR', date: '2026-10-06', net: -59_000, r: -0.5 },
    { tradeId: 'u1', market: 'US', date: '2026-10-06', net: -50, r: -0.25 },
    { tradeId: 'u2', market: 'US', date: '2026-09-01', net: 10, r: null }, // no rate that day
  ]
  it('keeps market totals and the converted total consistent', () => {
    const b = dailyBuckets(events, 'KRW', ctx).get('2026-10-06')!
    expect(b.KR).toBe(141_000)
    expect(b.US).toBe(-50)
    expect(b.value).toBe(141_000 - 50 * 1410)
    expect(b.r).toBeCloseTo(0.25, 12)
    expect([b.trades, b.wins, b.losses]).toEqual([3, 1, 2])
    const usd = dailyBuckets(events, 'USD', ctx).get('2026-10-06')!
    expect(usd.value).toBeCloseTo(141_000 / 1410 - 50, 9)
  })
  it('counts events it could not convert instead of guessing', () => {
    const b = dailyBuckets(events, 'KRW', ctx).get('2026-09-01')!
    expect([b.value, b.missing, b.US]).toEqual([0, 1, 10])
    expect(sumDays(dailyBuckets(events, 'KRW', ctx), ['2026-10-06', '2026-09-01', '2026-10-07'])).toEqual({
      value: 141_000 - 70_500,
      r: 0.25,
      trades: 4,
      missing: 1,
    })
  })
})

describe('summaries and curve', () => {
  const events: CalEvent[] = [
    { tradeId: 'a', market: 'KR', date: '2026-10-01', net: -100, r: -1 },
    { tradeId: 'b', market: 'KR', date: '2026-10-02', net: 300, r: 3 },
    { tradeId: 'b', market: 'KR', date: '2026-10-05', net: -100, r: -1 },
    { tradeId: 'c', market: 'KR', date: '2026-10-05', net: 50, r: 0.5 },
    { tradeId: 'd', market: 'KR', date: '2026-09-30', net: 999, r: 9 },
  ]
  it('summarizes a period per position', () => {
    const s = summarizePeriod(events, 'KRW', ctx, '2026-10-01', '2026-10-31')
    expect(s.total).toBe(150)
    expect(s.rSum).toBeCloseTo(1.5, 12)
    expect([s.wins, s.losses]).toEqual([2, 1]) // b nets +200, c +50, a −100
    expect(s.winRate).toBeCloseTo(2 / 3, 12)
    expect(s.payoff).toBeCloseTo(125 / 100, 12)
    expect(s.tradingDays).toBe(3)
    expect(s.best).toEqual({ date: '2026-10-02', value: 300 })
    expect(s.worst).toEqual({ date: '2026-10-01', value: -100 })
  })
  it('has no win rate or payoff without both sides', () => {
    const s = summarizePeriod(events, 'KRW', ctx, '2026-11-01', '2026-11-30')
    expect([s.winRate, s.payoff, s.best, s.worst, s.tradingDays]).toEqual([null, null, null, null, 0])
  })
  it('builds the cumulative curve with drawdown from the running peak', () => {
    const b = dailyBuckets(events, 'KRW', ctx)
    expect(equityCurve(b, '2026-10-01', '2026-10-31')).toEqual([
      { date: '2026-10-01', cum: -100, dd: -100 },
      { date: '2026-10-02', cum: 200, dd: 0 },
      { date: '2026-10-05', cum: 150, dd: -50 },
    ])
  })
  it('scales colour against the largest day', () => {
    expect(intensity(0, 100)).toBe(0)
    expect(intensity(-100, 100)).toBe(1)
    expect(intensity(5, 100)).toBe(0.15)
    expect(intensity(50, 0)).toBe(0)
  })
})

describe('weeklyStats', () => {
  it('fills the weekly review numbers', () => {
    const s = weeklyStats({
      events: [
        { tradeId: 'k', market: 'KR', date: '2026-10-05', net: 100_000, r: 1 },
        { tradeId: 'u', market: 'US', date: '2026-10-06', net: -20, r: -0.5 },
        { tradeId: 'u', market: 'US', date: '2026-08-01', net: 5, r: null },
      ],
      ctx,
      checklists: [{ a: true, b: false }, { a: true, b: true }],
      mistakeTagIds: ['chase', 'fomo', 'chase', 'late', 'early'],
    })
    expect([s.KR, s.US, s.krw, s.krwMissing, s.r, s.trades]).toEqual([100_000, -15, 100_000 - 28_200, 1, 0.5, 2])
    expect(s.adherence).toBe(0.75)
    expect(s.topMistakes).toEqual([
      { tagId: 'chase', count: 2 },
      { tagId: 'early', count: 1 },
      { tagId: 'fomo', count: 1 },
    ])
    expect(weeklyStats({ events: [], ctx, checklists: [], mistakeTagIds: [] }).adherence).toBeNull()
  })
})

describe('dayChange', () => {
  it('compares a day’s close with the previous bar', () => {
    const bars = [
      { date: '2026-10-06', close: 110 },
      { date: '2026-10-02', close: 100 },
      { date: '2026-10-07', close: null },
    ]
    expect(dayChange(bars, '2026-10-06')).toEqual({ close: 110, changePct: 10 })
    expect(dayChange(bars, '2026-10-02')).toEqual({ close: 100, changePct: null })
    expect(dayChange(bars, '2026-10-07')).toBeNull()
  })
})
