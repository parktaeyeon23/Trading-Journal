import { describe, expect, it } from 'vitest'
import {
  adherenceGap,
  breakdown,
  buildAnaTrade,
  disciplineScore,
  entryWeekday,
  exitEfficiency,
  filterTrades,
  holdBucket,
  metrics,
  mistakeCost,
  periodRange,
  planDeviation,
  resultOf,
  valNative,
  valR,
  type AnaTrade,
} from '../../src/core/analysis'

function mk(p: Partial<AnaTrade> & { id: string }): AnaTrade {
  return {
    market: 'KR',
    setup: null,
    regime: null,
    grade: null,
    noPlan: false,
    tagIds: [],
    emotionTagIds: [],
    checklist: null,
    entryDate: '2026-10-01',
    exitDate: '2026-10-01',
    holdDays: 0,
    net: 0,
    netKrw: 0,
    r: null,
    entryDeviationPct: null,
    qtyDeviationPct: null,
    stopWidened: 0,
    stopMoves: 0,
    mfeR: null,
    maeR: null,
    mfePct: null,
    maePct: null,
    ...p,
  }
}

// Hand-computed fixture (numbers checked in the comments below).
const T: AnaTrade[] = [
  mk({ id: 'A', exitDate: '2026-10-01', entryDate: '2026-09-28', r: 2, net: 200, setup: 'VCP', holdDays: 3, checklist: { a: true, b: true }, tagIds: ['reason-rs'], grade: 'A', entryDeviationPct: 0.5, qtyDeviationPct: 10, mfeR: 4, maeR: -0.2 }),
  mk({ id: 'B', exitDate: '2026-10-02', r: -1, net: -100, setup: 'VCP', holdDays: 1, checklist: { a: true, b: false }, tagIds: ['chase'], grade: 'C', entryDeviationPct: 2, qtyDeviationPct: -20, stopWidened: 1, stopMoves: 1, mfeR: 0.5, maeR: -1.2 }),
  mk({ id: 'C', exitDate: '2026-10-03', r: -1, net: -100, setup: '눌림목', holdDays: 5, checklist: { a: true }, tagIds: ['chase'], grade: 'A', entryDeviationPct: -1.5 }),
  mk({ id: 'D', exitDate: '2026-10-06', r: 3, net: 300, setup: '눌림목', holdDays: 10, checklist: { a: true }, market: 'US', mfeR: 6, maeR: -0.6 }),
  mk({ id: 'E', exitDate: '2026-10-07', r: null, net: -50, setup: 'EP', tagIds: ['fomo'] }),
  mk({ id: 'F', exitDate: '2026-10-08', r: 0, net: 0 }),
]

describe('metrics', () => {
  it('matches the hand calculation in R (trades without R drop out)', () => {
    const m = metrics(T, valR)
    expect(m).toMatchObject({ count: 6, measured: 5, wins: 2, losses: 2, breakeven: 1, winRate: 0.5, total: 3, avgWin: 2.5, avgLoss: -1, payoff: 2.5, profitFactor: 2.5, maxDrawdown: -2 })
    expect(m.expectancy).toBeCloseTo(0.6, 12) // (2 − 1 − 1 + 3 + 0) / 5
    expect(m.avgHoldWin).toBe(6.5) // (3 + 10) / 2
    expect(m.avgHoldLoss).toBe(3) // (1 + 5) / 2
    expect(m.maxDrawdownPct).toBeNull()
  })
  it('matches in money, with drawdown as % of account + peak', () => {
    const m = metrics(T, valNative, 1000)
    expect(m.total).toBe(250)
    expect(m.expectancy).toBeCloseTo(250 / 6, 12)
    expect(m.maxDrawdown).toBe(-200) // 200 → 100 → 0
    expect(m.maxDrawdownPct).toBeCloseTo((-200 / 1200) * 100, 12)
  })
  it('is empty-safe', () => {
    expect(metrics([], valR)).toMatchObject({ count: 0, winRate: null, expectancy: null, payoff: null, profitFactor: null, maxDrawdown: 0 })
  })
})

describe('discipline', () => {
  it('scores kept ÷ answered over the latest n reviewed trades', () => {
    expect(disciplineScore(T)).toEqual({ score: 5 / 6, trades: 4 })
    expect(disciplineScore(T, 2)).toEqual({ score: 1, trades: 2 }) // D and C
    expect(disciplineScore([])).toEqual({ score: null, trades: 0 })
  })
})

describe('breakdowns', () => {
  it('groups by setup, best total first, ids kept for drill-down', () => {
    const rows = breakdown(T, (t) => [t.setup ?? '(없음)'], valR)
    expect(rows.map((r) => [r.key, r.count, r.total, r.avg])).toEqual([
      ['눌림목', 2, 2, 1],
      ['VCP', 2, 1, 0.5],
      ['(없음)', 1, 0, 0],
      ['EP', 1, 0, null],
    ])
    expect(rows[0].ids).toEqual(['C', 'D'])
  })
  it('counts a trade once per distinct key', () => {
    const rows = breakdown([mk({ id: 'x', tagIds: ['a', 'a', 'b'], r: 1 })], (t) => t.tagIds, valR)
    expect(rows.map((r) => r.key)).toEqual(['a', 'b'])
  })
  it('buckets holding time and weekday', () => {
    expect([0, 1, 3, 4, 7, 8, 20, 21].map(holdBucket)).toEqual(['당일', '1–3일', '1–3일', '4–7일', '4–7일', '8–20일', '8–20일', '21일+'])
    expect(entryWeekday(T[0])).toBe('월') // 2026-09-28
  })
  it('costs mistakes, most expensive first', () => {
    expect(mistakeCost(T, new Set(['chase', 'fomo']), valNative).map((m) => [m.tagId, m.count, m.total])).toEqual([
      ['chase', 2, -200],
      ['fomo', 1, -50],
    ])
  })
  it('compares rule-keepers with rule-breakers inside a setup', () => {
    expect(adherenceGap(T, valR)).toEqual([
      { setup: 'VCP', kept: { count: 1, expectancy: 2 }, broke: { count: 1, expectancy: -1 }, gap: 3 },
      { setup: '눌림목', kept: { count: 2, expectancy: 1 }, broke: { count: 0, expectancy: null }, gap: null },
    ])
  })
})

describe('plan vs execution and exits', () => {
  it('summarizes deviations and stop widening', () => {
    const d = planDeviation(T)
    expect(d.withPlan).toBe(3)
    expect(d.avgEntryDevPct).toBeCloseTo(1 / 3, 12)
    expect(d.entryOver1Pct).toBeCloseTo(2 / 3, 12)
    expect(d.avgQtyDevPct).toBe(-5)
    expect(d.oversized).toBe(0.5)
    expect(d.stopWidenedRate).toBeCloseTo(1 / 6, 12)
    expect(d.stopWidenedTrades).toEqual(['B'])
    expect(planDeviation([])).toMatchObject({ withPlan: 0, avgEntryDevPct: null, entryOver1Pct: null, stopWidenedRate: null })
  })
  it('measures capture of the favourable move and MAE depth', () => {
    const e = exitEfficiency(T)
    expect(e.measured).toBe(3)
    expect(e.captureRatio).toBeCloseTo((0.5 - 2 + 0.5) / 3, 12)
    expect(e.avgMfeR).toBeCloseTo(3.5, 12)
    expect(e.maeWinners.map((b) => b.count)).toEqual([0, 0, 0, 1, 0, 1])
    expect(e.maeLosers.map((b) => b.count)).toEqual([0, 1, 0, 0, 0, 0])
  })
})

describe('filters and periods', () => {
  it('ANDs every filter, period on the exit day', () => {
    const ids = (f: Parameters<typeof filterTrades>[1]) => filterTrades(T, f).map((t) => t.id)
    expect(ids({ from: '2026-10-02', to: '2026-10-06' })).toEqual(['B', 'C', 'D'])
    expect(ids({ market: 'US' })).toEqual(['D'])
    expect(ids({ setup: 'VCP', result: 'loss' })).toEqual(['B'])
    expect(ids({ tagIds: ['chase'], grade: 'A' })).toEqual(['C'])
    expect(ids({ result: 'be' })).toEqual(['F'])
    expect(resultOf(T[0])).toBe('win')
  })
  it('finds the period around a date', () => {
    expect(periodRange('day', '2026-10-08')).toEqual({ from: '2026-10-08', to: '2026-10-08' })
    expect(periodRange('week', '2026-10-08')).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(periodRange('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodRange('quarter', '2026-11-30')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('year', '2026-11-30')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
})

describe('buildAnaTrade', () => {
  const kr = {
    id: 'k',
    market: 'KR' as const,
    direction: 'long' as const,
    setup: 'VCP',
    grade: 'B',
    tags: [{ tagId: 'chase' }, { tagId: 'calm', phase: 'entry' }],
    fills: [
      { id: 'b', ts: '2026-10-05T00:30:00.000Z', side: 'buy' as const, price: 10_000, qty: 100 },
      { id: 's', ts: '2026-10-07T01:00:00.000Z', side: 'sell' as const, price: 11_000, qty: 100 },
    ],
    oneR: 100_000,
    originalStop: 9_500,
    planEntry: 9_900,
    planQty: 80,
    stopMoves: [
      { oldStop: 9_500, newStop: 9_300 },
      { oldStop: 9_300, newStop: 10_200 },
    ],
    bars: [
      { date: '2026-10-05', high: 10_500, low: 9_800 },
      { date: '2026-10-06', high: 11_500, low: 9_900 },
      { date: '2026-10-07', high: 11_200, low: 10_800 },
      { date: '2026-10-08', high: 20_000, low: 5_000 }, // after the exit — ignored
    ],
    usdkrw: {},
  }
  it('derives dates, results, deviations, stop widening and MFE/MAE', () => {
    const t = buildAnaTrade(kr)!
    expect(t).toMatchObject({ entryDate: '2026-10-05', exitDate: '2026-10-07', holdDays: 2, net: 100_000, netKrw: 100_000, r: 1, grade: 'B', tagIds: ['chase'], emotionTagIds: ['calm'], stopWidened: 1, stopMoves: 2, mfeR: 3, maeR: -0.4, mfePct: 15, maePct: -2, qtyDeviationPct: 25 })
    expect(t.entryDeviationPct).toBeCloseTo((100 / 9_900) * 100, 12)
  })
  it('converts US results with the exit day’s rate, and skips open trades', () => {
    const us = buildAnaTrade({ ...kr, market: 'US', fills: kr.fills.map((f) => ({ ...f, price: f.price / 1000 })), oneR: null, usdkrw: { '2026-10-06': 1400 } })!
    expect(us.netKrw).toBeCloseTo(100 * 1400, 9) // exit 10/6 New York (10/7 01:00Z)
    expect(us.r).toBeNull()
    expect(buildAnaTrade({ ...kr, usdkrw: {}, market: 'US' })!.netKrw).toBeNull()
    expect(buildAnaTrade({ ...kr, fills: kr.fills.slice(0, 1) })).toBeNull()
    expect(buildAnaTrade({ ...kr, grade: 'Z', bars: [] })).toMatchObject({ grade: null, mfeR: null })
  })
})
