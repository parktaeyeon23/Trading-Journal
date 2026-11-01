import { describe, expect, it } from 'vitest'
import { ema, fillMarks, planCharts, sessionVwap, sma, type AutoSlot } from '../../src/core/chartData'

describe('indicators', () => {
  it('computes a simple moving average once n values are in', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
    expect(sma([1, 2], 3)).toEqual([null, null])
  })
  it('seeds the EMA with the first SMA, then smooths with 2/(n+1)', () => {
    const e = ema([2, 4, 6, 8, 10], 3)
    expect(e.slice(0, 3)).toEqual([null, null, 4])
    expect(e[3]).toBeCloseTo(8 * 0.5 + 4 * 0.5, 12)
    expect(e[4]).toBeCloseTo(10 * 0.5 + 6 * 0.5, 12)
  })
  it('computes VWAP from typical price × volume and restarts each session', () => {
    const v = sessionVwap([
      { date: 'd1', high: 11, low: 9, close: 10, volume: 100 }, // tp 10
      { date: 'd1', high: 14, low: 10, close: 12, volume: 300 }, // tp 12
      { date: 'd1', high: 13, low: 13, close: 13, volume: null },
      { date: 'd2', high: 21, low: 19, close: 20, volume: 0 },
      { date: 'd2', high: 21, low: 19, close: 20, volume: 50 },
    ])
    expect(v[0]).toBe(10)
    expect(v[1]).toBeCloseTo((10 * 100 + 12 * 300) / 400, 12)
    expect(v[2]).toBeCloseTo(11.5, 12) // no volume: unchanged
    expect(v[3]).toBeNull() // new session, nothing traded yet
    expect(v[4]).toBe(20)
  })
})

const fill = (ts: string, side: 'buy' | 'sell', price = 100, qty = 10, stage: number | null = null) => ({ id: ts + side, ts, side, price, qty, pyramid_stage: stage })
// KR fills: 01:00Z = 10:00 KST.
const kr = [fill('2026-10-05T01:00:00.000Z', 'buy', 100, 10, 1), fill('2026-10-07T02:00:00.000Z', 'buy', 104, 5, 2), fill('2026-10-12T05:00:00.000Z', 'sell', 110, 15)]

const slots = (p: ReturnType<typeof planCharts>) => p.jobs.map((j) => `${j.slot}:${j.kind}:${j.showFrom}..${j.showTo}`)

describe('planCharts', () => {
  it('plans every empty slot of a closed trade, extra entry days as free attachments', () => {
    const p = planCharts({ market: 'KR', direction: 'long', fills: kr, closed: true, filled: new Set(), today: '2026-11-02' })
    expect(slots(p)).toEqual([
      'setup:daily:2026-04-06..2026-10-04',
      'entry:intraday:2026-10-05..2026-10-05',
      'free:intraday:2026-10-07..2026-10-07',
      'exit:daily:2026-08-05..2026-10-19',
      'post:daily:2026-09-25..2026-11-02',
    ])
    // Daily jobs fetch ~300 days earlier for the 200-day average.
    expect(p.jobs[0].fetchFrom).toBe('2025-06-10')
    expect(p.skipped).toEqual([])
  })

  it('skips filled slots, open trades, posts not yet due and expired intraday data', () => {
    const filled = new Set<AutoSlot>(['setup'])
    const open = planCharts({ market: 'KR', direction: 'long', fills: kr.slice(0, 2), closed: false, filled, today: '2026-10-08' })
    expect(slots(open).map((s) => s.split(':')[0])).toEqual(['entry', 'free'])
    expect(open.skipped).toEqual([
      { slot: 'setup', reason: 'filled' },
      { slot: 'exit', reason: 'not_closed' },
      { slot: 'post', reason: 'not_closed' },
    ])
    const early = planCharts({ market: 'KR', direction: 'long', fills: kr, closed: true, filled: new Set(), today: '2026-10-20' })
    expect(early.skipped).toContainEqual({ slot: 'post', reason: 'post_not_due' })
    const late = planCharts({ market: 'KR', direction: 'long', fills: kr, closed: true, filled: new Set(), today: '2027-01-15' })
    expect(late.skipped).toContainEqual({ slot: 'entry', reason: 'intraday_expired', date: '2026-10-05' })
    expect(planCharts({ market: 'KR', direction: 'long', fills: [], closed: false, filled: new Set(), today: '2026-10-08' }).jobs).toEqual([])
  })

  it('caps the daily request at the backend limit for very long holds', () => {
    const long = [fill('2025-01-06T01:00:00.000Z', 'buy'), fill('2026-10-12T05:00:00.000Z', 'sell')]
    const exit = planCharts({ market: 'KR', direction: 'long', fills: long, closed: true, filled: new Set(), today: '2026-10-14' }).jobs.find((j) => j.slot === 'exit')!
    expect(exit.fetchTo).toBe('2026-10-14')
    expect(exit.fetchFrom).toBe('2024-08-15') // 790 days back
  })
})

describe('fillMarks', () => {
  it('puts daily marks on trading dates and intraday marks on their bar', () => {
    expect(fillMarks(kr, 'long', 'KR', { kind: 'daily' }).map((m) => [m.at, m.isEntry, m.stage])).toEqual([
      ['2026-10-05', true, 1],
      ['2026-10-07', true, 2],
      ['2026-10-12', false, null],
    ])
    const intra = fillMarks([fill('2026-10-05T01:03:20.000Z', 'buy')], 'long', 'KR', { kind: 'intraday', date: '2026-10-05', barSeconds: 300 })
    expect(intra[0].at).toBe(Date.parse('2026-10-05T01:00:00.000Z') / 1000)
    expect(fillMarks(kr, 'long', 'KR', { kind: 'intraday', date: '2026-10-07', barSeconds: 300 })).toHaveLength(1)
  })
})
