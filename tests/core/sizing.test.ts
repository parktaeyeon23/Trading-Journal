import { describe, expect, it } from 'vitest'
import { sizePosition, type SizingInput } from '../../src/core/sizing'

const ok = (input: SizingInput) => {
  const out = sizePosition(input)
  if (!out.ok) throw new Error(out.error)
  return out.result
}

/**
 * Cases checked against the Darren Trading calculator's formula
 * (qty = floor(account × RPT% ÷ |entry − stop|), position % = RPT% ÷ stop %).
 */
describe('sizePosition — Darren calculator cases', () => {
  it('KR long 3천만 · 1.25% · 98,500 / 94,100 → 85주, over the 25% cap', () => {
    const r = ok({ direction: 'long', account: 30_000_000, rptPct: 1.25, entry: 98_500, stop: 94_100 })
    expect(r.qty).toBe(85)
    expect(r.stopPct).toBeCloseTo(4.467, 3)
    expect(r.positionPct).toBeCloseTo(27.98, 2)
    expect(r.positionSize).toBe(8_372_500)
    expect(r.riskAmount).toBe(374_000)
    expect(r.accountRiskPct).toBeCloseTo(1.2467, 4)
    expect(r.capped).toMatchObject({ qty: 76, positionSize: 7_486_000, riskAmount: 334_400 })
    expect(r.capped!.accountRiskPct).toBeCloseTo(1.1147, 4)
  })

  it('US long $20,000 · 1.25% · 72.40 / 69.80 → 96 shares', () => {
    const r = ok({ direction: 'long', account: 20_000, rptPct: 1.25, entry: 72.4, stop: 69.8 })
    expect(r.qty).toBe(96)
    expect(r.positionSize).toBeCloseTo(6950.4, 6)
    expect(r.riskAmount).toBeCloseTo(249.6, 6)
    expect(r.stopPct).toBeCloseTo(3.5912, 4)
    expect(r.capped?.qty).toBe(69)
  })

  it('US short $20,000 · 1% · 50 / 52 → 100 shares, exactly at the cap (not capped)', () => {
    const r = ok({ direction: 'short', account: 20_000, rptPct: 1, entry: 50, stop: 52 })
    expect(r.qty).toBe(100)
    expect(r.positionSize).toBe(5000)
    expect(r.capped).toBeNull()
  })

  it('KR 1천만 · 2.5% · 10,000 / 9,000 → 250주, 10% stop = 25% position', () => {
    const r = ok({ direction: 'long', account: 10_000_000, rptPct: 2.5, entry: 10_000, stop: 9_000 })
    expect(r.qty).toBe(250)
    expect(r.stopPct).toBe(10)
    expect(r.positionPct).toBe(25)
    expect(r.capped).toBeNull()
  })

  it('does not lose a share to floating-point error (1.30 / 1.20 with a 10 budget → 100)', () => {
    // 1.3 − 1.2 is 0.10000000000000009 in floating point; a bare floor() would give 99.
    const r = ok({ direction: 'long', account: 1000, rptPct: 1, entry: 1.3, stop: 1.2 })
    expect(r.qty).toBe(100)
  })

  it('respects a custom cap', () => {
    const r = ok({ direction: 'long', account: 10_000_000, rptPct: 2.5, entry: 10_000, stop: 9_000, maxPositionPct: 20 })
    expect(r.capped?.qty).toBe(200)
  })
})

describe('sizePosition — input errors', () => {
  const base: SizingInput = { direction: 'long', account: 1000, rptPct: 1, entry: 10, stop: 9 }
  it('rejects non-positive numbers', () => {
    expect(sizePosition({ ...base, account: 0 })).toEqual({ ok: false, error: 'not_positive' })
    expect(sizePosition({ ...base, stop: -1 })).toEqual({ ok: false, error: 'not_positive' })
    expect(sizePosition({ ...base, rptPct: NaN })).toEqual({ ok: false, error: 'not_positive' })
  })
  it('rejects a stop on the wrong side or at entry', () => {
    expect(sizePosition({ ...base, stop: 11 })).toEqual({ ok: false, error: 'stop_wrong_side' })
    expect(sizePosition({ ...base, direction: 'short', stop: 9 })).toEqual({ ok: false, error: 'stop_wrong_side' })
    expect(sizePosition({ ...base, stop: 10 })).toEqual({ ok: false, error: 'stop_equals_entry' })
  })
  it('returns zero shares when one share already exceeds the budget', () => {
    const r = sizePosition({ ...base, account: 100, rptPct: 0.5, entry: 100, stop: 90 })
    expect(r).toMatchObject({ ok: true, result: { qty: 0, riskAmount: 0 } })
  })
})
