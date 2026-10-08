import { describe, expect, it } from 'vitest'
import { excursion, oneR, openRiskPct, rMultiple } from '../../src/core/risk'
import type { PnlFill } from '../../src/core/pnl'

const buy = (id: string, ts: string, price: number, qty: number, stage?: number): PnlFill => ({ id, ts, side: 'buy', price, qty, pyramid_stage: stage })

describe('oneR', () => {
  const fills = [buy('a', '2026-10-02', 72.55, 81, 1), buy('b', '2026-10-05', 74.1, 49, 2)]
  it('prefers the planned risk amount', () => {
    expect(oneR({ direction: 'long', originalStop: 69.8, plannedRisk: 421, fills })).toBe(421)
  })
  it('falls back to stage-1 qty × |stage-1 avg − original stop|', () => {
    expect(oneR({ direction: 'long', originalStop: 69.8, fills })).toBeCloseTo(81 * 2.75, 9)
  })
  it('uses the first fill when no stage is recorded, and ignores moved stops', () => {
    const unstaged = [buy('a', '2026-10-05', 74.1, 49), buy('b', '2026-10-02', 72.55, 81)]
    expect(oneR({ direction: 'long', originalStop: 69.8, fills: unstaged })).toBeCloseTo(81 * 2.75, 9)
  })
  it('works for shorts', () => {
    const fills = [{ id: 's', ts: '2026-10-02', side: 'sell' as const, price: 50, qty: 100 }]
    expect(oneR({ direction: 'short', originalStop: 52, fills })).toBe(200)
  })
  it('is null without a stop, without entries, or with a zero-width stop', () => {
    expect(oneR({ direction: 'long', originalStop: null, fills })).toBeNull()
    expect(oneR({ direction: 'long', originalStop: 69.8, fills: [] })).toBeNull()
    expect(oneR({ direction: 'long', originalStop: 72.55, fills: [fills[0]] })).toBeNull()
  })
})

describe('rMultiple', () => {
  it('divides by 1R and is null without one', () => {
    expect(rMultiple(-84.6, 421)).toBeCloseTo(-84.6 / 421, 12)
    expect(rMultiple(100, null)).toBeNull()
    expect(rMultiple(100, 0)).toBeNull()
  })
})

describe('excursion', () => {
  const bars = [
    { date: '2026-10-02', high: 74, low: 71 },
    { date: '2026-10-05', high: 76, low: 72 },
    { date: '2026-10-07', high: 73, low: 70 },
  ]
  it('measures best and worst moves for a long, in % and R', () => {
    const e = excursion('long', 72.55, 69.8, bars)!
    expect(e.mfePct).toBeCloseTo(((76 - 72.55) / 72.55) * 100, 9)
    expect(e.maePct).toBeCloseTo(((70 - 72.55) / 72.55) * 100, 9)
    expect(e.mfeR).toBeCloseTo(3.45 / 2.75, 9)
    expect(e.maeR).toBeCloseTo(-2.55 / 2.75, 9)
  })
  it('mirrors for a short and never reports a favorable MAE', () => {
    const e = excursion('short', 80, 85, bars)!
    expect(e.mfePct).toBeCloseTo(((80 - 70) / 80) * 100, 9)
    expect(e.maePct).toBe(0)
  })
  it('returns null R without a stop and null without bars', () => {
    expect(excursion('long', 72.55, null, bars)!.mfeR).toBeNull()
    expect(excursion('long', 72.55, 69.8, [])).toBeNull()
  })
})

describe('openRiskPct', () => {
  it('sums loss-to-stop across positions as % of each account', () => {
    const r = openRiskPct([
      { direction: 'long', openQty: 85, avgCost: 98_500, stop: 94_100, account: 30_000_000 },
      { direction: 'long', openQty: 96, avgCost: 72.4, stop: 69.8, account: 20_000 },
      { direction: 'long', openQty: 10, avgCost: 100, stop: 105, account: 10_000 }, // stop above cost → no risk
      { direction: 'short', openQty: 100, avgCost: 50, stop: 52, account: 20_000 },
      { direction: 'long', openQty: 5, avgCost: 10, stop: null, account: 1000 },
      { direction: 'long', openQty: 0, avgCost: 10, stop: 9, account: 1000 },
    ])
    expect(r.pct).toBeCloseTo(1.24667 + 1.248 + 1, 4)
    expect(r.withoutStop).toBe(1)
  })
})
