import { describe, expect, it } from 'vitest'
import type { PnlFill } from '../../src/core/pnl'
import { autoChecks, BUILTIN_CHECKS as B, deriveStatus, summarizeTrade, type TradeInput } from '../../src/core/trade'

const fill = (id: string, ts: string, side: 'buy' | 'sell', price: number, qty: number, stage?: number): PnlFill => ({ id, ts, side, price, qty, pyramid_stage: stage })

// The CRDO example from the design canvas: 81 + 49 bought, all sold at 72.05.
const crdo: TradeInput = {
  direction: 'long',
  originalStop: 69.8,
  plan: { plan_entry: 72.4, plan_qty: 162, risk_amount: 421 },
  fills: [fill('a', '2026-10-02T13:41:00Z', 'buy', 72.55, 81, 1), fill('b', '2026-10-05T14:05:00Z', 'buy', 74.1, 49, 2), fill('c', '2026-10-07T13:58:00Z', 'sell', 72.05, 130)],
}

describe('summarizeTrade', () => {
  it('computes P&L, R against the planned risk, and plan deviations', () => {
    const s = summarizeTrade(crdo)
    const avg = (72.55 * 81 + 74.1 * 49) / 130
    expect(s.pnl.realizedNet).toBeCloseTo((72.05 - avg) * 130, 9)
    expect(s.oneR).toBe(421)
    expect(s.r).toBeCloseTo(s.pnl.realizedNet / 421, 12)
    expect(s.entryDeviationPct).toBeCloseTo(((72.55 - 72.4) / 72.4) * 100, 9)
    expect(s.qtyDeviationPct).toBeCloseTo(((130 - 162) / 162) * 100, 9)
  })
  it('has no R before any exit and no deviations without a plan', () => {
    const s = summarizeTrade({ ...crdo, plan: null, fills: crdo.fills.slice(0, 1) })
    expect(s.r).toBeNull()
    expect(s.entryDeviationPct).toBeNull()
    expect(s.qtyDeviationPct).toBeNull()
    expect(s.oneR).toBeCloseTo(81 * 2.75, 9)
  })
})

describe('autoChecks', () => {
  it('passes a trade that followed its plan', () => {
    expect(autoChecks(crdo)).toEqual({ [B.entry]: true, [B.size]: true, [B.stop]: true })
  })
  it('fails chasing more than 1% above plan, oversizing, and exiting well below the stop', () => {
    const chased: TradeInput = {
      ...crdo,
      fills: [fill('a', '2026-10-02', 'buy', 73.2, 170), fill('b', '2026-10-03', 'sell', 69.0, 170)],
    }
    expect(autoChecks(chased)).toEqual({ [B.entry]: false, [B.size]: false, [B.stop]: false })
  })
  it('allows a small slip past the stop', () => {
    const slipped: TradeInput = { ...crdo, fills: [fill('a', '2026-10-02', 'buy', 72.4, 100), fill('b', '2026-10-03', 'sell', 69.6, 100)] }
    expect(autoChecks(slipped)[B.stop]).toBe(true)
  })
  it('mirrors the rules for shorts', () => {
    const short: TradeInput = {
      direction: 'short',
      originalStop: 52,
      plan: { plan_entry: 50, plan_qty: 100 },
      fills: [fill('a', '2026-10-02', 'sell', 49.6, 100), fill('b', '2026-10-03', 'buy', 52.1, 100)],
    }
    expect(autoChecks(short)).toEqual({ [B.entry]: true, [B.size]: true, [B.stop]: true })
    const shortChase = { ...short, fills: [fill('a', '2026-10-02', 'sell', 49.0, 100)] }
    expect(autoChecks(shortChase)[B.entry]).toBe(false)
  })
  it('fails plan checks without a plan and leaves undecidable ones null', () => {
    expect(autoChecks({ direction: 'long', originalStop: null, plan: null, fills: [fill('a', '2026-10-02', 'buy', 10, 1)] })).toEqual({
      [B.entry]: false,
      [B.size]: false,
      [B.stop]: null,
    })
    expect(autoChecks({ ...crdo, fills: [] })).toEqual({ [B.entry]: null, [B.size]: null, [B.stop]: null })
  })
})

describe('deriveStatus', () => {
  it('follows the fills', () => {
    expect(deriveStatus(0, 0, false)).toBe('planned')
    expect(deriveStatus(10, 4, false)).toBe('open')
    expect(deriveStatus(10, 0, false)).toBe('review_pending')
    expect(deriveStatus(10, 0, true)).toBe('done')
  })
})
