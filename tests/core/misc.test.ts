import { describe, expect, it } from 'vitest'
import { defaultFees } from '../../src/core/fees'
import { rateOn, toKrw } from '../../src/core/fx'
import { gradeExecution } from '../../src/core/grade'
import { adrPct, atr, atrStop, dayExtremeStop, swingStop } from '../../src/core/stops'

describe('gradeExecution', () => {
  const rules = (passed: number, total: number) => Array.from({ length: total }, (_, i) => i < passed)
  it('maps the pass ratio to A–D', () => {
    expect(gradeExecution(rules(5, 5), false).grade).toBe('A')
    expect(gradeExecution(rules(4, 5), false).grade).toBe('B') // exactly 80%
    expect(gradeExecution(rules(3, 5), false).grade).toBe('C') // exactly 60%
    expect(gradeExecution(rules(2, 5), false).grade).toBe('D')
  })
  it('caps a no-plan entry at C, but never raises a D', () => {
    expect(gradeExecution(rules(5, 5), true)).toMatchObject({ grade: 'C', capped: true })
    expect(gradeExecution(rules(1, 5), true)).toMatchObject({ grade: 'D', capped: false })
  })
  it('accepts a named checklist and custom bands', () => {
    expect(gradeExecution({ 손절: true, 사이즈: true, 진입가: false }, false, { A: 1, B: 0.6, C: 0.3 }).grade).toBe('B')
  })
  it('has no grade for an empty checklist', () => {
    expect(gradeExecution([], false)).toMatchObject({ grade: null, ratio: null })
  })
})

describe('defaultFees', () => {
  it('charges commission both ways and KR tax on sells only, truncating won', () => {
    const r = { feePct: 0.015, sellTaxPct: 0.18 }
    expect(defaultFees('KR', 'buy', 98_500, 85, r)).toEqual({ fee: 1255, tax: null })
    expect(defaultFees('KR', 'sell', 98_500, 85, r)).toEqual({ fee: 1255, tax: 15070 })
  })
  it('rounds US to cents and never charges US tax', () => {
    expect(defaultFees('US', 'sell', 72.05, 130, { feePct: 0.25, sellTaxPct: 0.18 })).toEqual({ fee: 23.42, tax: null })
  })
  it('returns nothing without rates or value', () => {
    expect(defaultFees('KR', 'sell', 100, 1, { feePct: null, sellTaxPct: null })).toEqual({ fee: null, tax: null })
    expect(defaultFees('KR', 'buy', 0, 1, { feePct: 1, sellTaxPct: 1 })).toEqual({ fee: null, tax: null })
  })
})

describe('fx', () => {
  const rates = { '2026-10-02': 1380, '2026-10-05': 1390 }
  it('uses the same day, else the latest earlier day within a week', () => {
    expect(rateOn('2026-10-05', rates)).toBe(1390)
    expect(rateOn('2026-10-04', rates)).toBe(1380) // weekend
    expect(rateOn('2026-10-20', rates)).toBeNull() // too far
    expect(rateOn('2026-10-01', rates)).toBeNull() // nothing earlier
  })
  it('converts USD and passes KRW through', () => {
    expect(toKrw(-84.6, 'USD', '2026-10-05', rates)).toBeCloseTo(-117_594, 6)
    expect(toKrw(1000, 'KRW', '2026-10-05', {})).toBe(1000)
    expect(toKrw(1, 'USD', '2026-12-01', rates)).toBeNull()
  })
})

describe('stop helpers', () => {
  const bars = [
    { date: '1', high: 102, low: 98, close: 100 },
    { date: '2', high: 106, low: 99, close: 105 },
    { date: '3', high: 107, low: 101, close: 102 },
    { date: '4', high: 104, low: 100, close: 103 },
  ]
  it('computes ATR as the mean true range', () => {
    // TR: max(7, 6, 1)=7 · max(6, 2, 4)=6 · max(4, 2, 2)=4 → mean 17/3
    expect(atr(bars)).toBeCloseTo(17 / 3, 9)
    expect(atr(bars, 2)).toBe(5)
    expect(atr(bars.slice(0, 1))).toBeNull()
  })
  it('places an ATR stop below a long entry and above a short one', () => {
    expect(atrStop('long', 103, bars, 1.5, 2)).toBe(95.5)
    expect(atrStop('short', 103, bars, 1, 2)).toBe(108)
    expect(atrStop('long', 103, [])).toBeNull()
  })
  it('finds the day low/high and the swing low/high', () => {
    expect(dayExtremeStop('long', bars)).toBe(100)
    expect(dayExtremeStop('short', bars)).toBe(104)
    expect(swingStop('long', bars, 3)).toBe(99)
    expect(swingStop('short', bars, 2)).toBe(107)
    expect(dayExtremeStop('long', [])).toBeNull()
    expect(swingStop('long', [])).toBeNull()
  })
  it('computes ADR% and skips incomplete bars', () => {
    const v = adrPct([...bars, { date: '5', high: null, low: 1, close: 1 }])!
    const expected = ((102 / 98 - 1 + 106 / 99 - 1 + 107 / 101 - 1 + 104 / 100 - 1) / 4) * 100
    expect(v).toBeCloseTo(expected, 9)
    expect(adrPct([])).toBeNull()
  })
})
