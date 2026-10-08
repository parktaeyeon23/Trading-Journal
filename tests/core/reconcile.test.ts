import { describe, expect, it } from 'vitest'
import { holdingKey, monthBook, moneyMatches, type ReconTrade } from '../../src/core/reconcile'

const f = (id: string, ts: string, side: 'buy' | 'sell', price: number, qty: number) => ({ id, ts, side, price, qty })

const trades: ReconTrade[] = [
  // KR: bought in Sept, half sold Sept 30, rest sold Oct 2
  { id: 'k1', market: 'KR', ticker: '042700', direction: 'long', fills: [f('a', '2026-09-28T01:00:00.000Z', 'buy', 100, 10), f('b', '2026-09-30T01:00:00.000Z', 'sell', 110, 5), f('c', '2026-10-02T01:00:00.000Z', 'sell', 90, 5)] },
  // US: sold 2026-10-01 01:00Z = Sept 30 in New York → September
  { id: 'u1', market: 'US', ticker: 'crdo', direction: 'long', fills: [f('d', '2026-09-29T15:00:00.000Z', 'buy', 70, 4), f('e', '2026-10-01T01:00:00.000Z', 'sell', 75, 4)] },
  // US: still held, two positions in the same ticker
  { id: 'u2', market: 'US', ticker: 'NVDA', direction: 'long', fills: [f('g', '2026-09-10T15:00:00.000Z', 'buy', 100, 3)] },
  { id: 'u3', market: 'US', ticker: 'NVDA', direction: 'long', fills: [f('h', '2026-09-20T15:00:00.000Z', 'buy', 100, 2), f('i', '2026-10-05T15:00:00.000Z', 'sell', 101, 2)] },
]

describe('monthBook', () => {
  it('sums realized P&L per market on market-local dates and holdings at month end', () => {
    const sep = monthBook(trades, '2026-09')
    expect(sep.realized).toEqual({ KR: 50, US: 20 })
    expect(sep.realizedTrades).toEqual({ KR: ['k1'], US: ['u1'] })
    expect(sep.holdings).toEqual({ 'KR:042700': 5, 'US:NVDA': 5 })
    expect(sep.holdingTrades['US:NVDA']).toEqual(['u2', 'u3'])

    const oct = monthBook(trades, '2026-10')
    expect(oct.realized).toEqual({ KR: -50, US: 2 })
    expect(oct.holdings).toEqual({ 'US:NVDA': 3 })
  })
  it('keys holdings consistently and compares money to the smallest step', () => {
    expect(holdingKey('US', ' crdo ')).toBe('US:CRDO')
    expect(moneyMatches(1000.4, 1000, 'KR')).toBe(true)
    expect(moneyMatches(1001, 1000, 'KR')).toBe(false)
    expect(moneyMatches(10.004, 10, 'US')).toBe(true)
    expect(moneyMatches(10.02, 10, 'US')).toBe(false)
  })
})
