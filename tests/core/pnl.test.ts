import { describe, expect, it } from 'vitest'
import { positionPnl, type PnlFill } from '../../src/core/pnl'

let n = 0
const f = (side: 'buy' | 'sell', price: number, qty: number, extra: Partial<PnlFill> = {}): PnlFill => ({
  id: 'f' + ++n,
  ts: `2026-10-0${Math.min(n, 9)}T00:00:00.000Z`,
  side,
  price,
  qty,
  ...extra,
})

describe('positionPnl — moving average', () => {
  it('matches the example the user picked: 10@100 + 10@120, sell 10@130 → +200', () => {
    n = 0
    const p = positionPnl('long', [f('buy', 100, 10), f('buy', 120, 10), f('sell', 130, 10)])
    expect(p.exits[0]).toMatchObject({ avgCost: 110, gross: 200 })
    expect(p).toMatchObject({ openQty: 10, avgCost: 110, realizedGross: 200 })
  })

  it('keeps the average across exits and re-averages on a later add', () => {
    n = 0
    const p = positionPnl('long', [f('buy', 100, 10), f('sell', 110, 5), f('buy', 130, 5), f('sell', 120, 10)])
    // after first sell: 5 @ 100; add 5 @ 130 → 10 @ 115; sell 10 @ 120 → +50
    expect(p.exits.map((e) => e.gross)).toEqual([50, 50])
    expect(p).toMatchObject({ openQty: 0, avgCost: 0, realizedGross: 100, entryQty: 15, exitQty: 15 })
    expect(p.avgEntry).toBeCloseTo((100 * 10 + 130 * 5) / 15, 9)
    expect(p.avgExit).toBeCloseTo((110 * 5 + 120 * 10) / 15, 9)
  })

  it('breaks timestamp ties by record order, so a same-minute buy/sell pair stays in order', () => {
    const same = '2026-10-08T08:31:00.000Z'
    const fills: PnlFill[] = [
      { id: 's', ts: same, created_at: '2026-10-08T08:31:20.000Z', side: 'sell', price: 120, qty: 10 },
      { id: 'b', ts: same, created_at: '2026-10-08T08:31:05.000Z', side: 'buy', price: 100, qty: 10 },
    ]
    const p = positionPnl('long', fills)
    expect(p).toMatchObject({ oversold: false, openQty: 0, realizedGross: 200 })
  })

  it('sorts fills by time before computing', () => {
    n = 0
    const fills = [f('buy', 100, 10), f('sell', 120, 10)]
    expect(positionPnl('long', [...fills].reverse()).realizedGross).toBe(200)
  })

  it('handles shorts: entries are sells, profit when price falls', () => {
    n = 0
    const p = positionPnl('short', [f('sell', 50, 100), f('buy', 47, 60), f('buy', 52, 40)])
    expect(p.exits.map((e) => e.gross)).toEqual([180, -80])
    expect(p.realizedGross).toBe(100)
    expect(p.openQty).toBe(0)
  })

  it('charges exit fees fully and entry fees pro rata to closed shares', () => {
    n = 0
    const p = positionPnl('long', [f('buy', 100, 10, { fee: 10 }), f('sell', 110, 4, { fee: 2, tax: 3 }), f('sell', 110, 6, { fee: 3 })])
    // exit 1: gross 40 − 5 − 10×4/10 = 31; exit 2: gross 60 − 3 − 6 = 51
    expect(p.exits.map((e) => e.net)).toEqual([31, 51])
    expect(p.realizedNet).toBe(82)
    expect(p.feesTotal).toBe(18)
    expect(p.realizedGross - p.feesTotal).toBe(82)
  })

  it('flags and caps an exit larger than the open position', () => {
    n = 0
    const p = positionPnl('long', [f('buy', 10, 5), f('sell', 12, 8)])
    expect(p.oversold).toBe(true)
    expect(p.exitQty).toBe(5)
    expect(p.realizedGross).toBe(10)
  })

  it('returns zeros for an empty position', () => {
    expect(positionPnl('long', [])).toMatchObject({ entryQty: 0, openQty: 0, avgEntry: 0, avgExit: 0, realizedNet: 0, exits: [] })
  })
})
