/**
 * Month-end reconciliation against the broker's statement — pure.
 * The app side: realized P&L per market in the month and shares held at
 * month end, both on each market's own calendar.
 */
import { tradeDate, tradeEvents, type CalMarket } from './calendar'
import { positionPnl, type PnlFill } from './pnl'
import type { Direction } from './sizing'

export interface ReconTrade {
  id: string
  market: CalMarket
  ticker: string
  direction: Direction
  fills: PnlFill[]
}

export interface MonthBook {
  realized: Record<CalMarket, number>
  /** "KR:042700" → shares held at month end (long +, short −), only non-zero. */
  holdings: Record<string, number>
  /** Which positions make up each holding / market total, for jumping to fills. */
  holdingTrades: Record<string, string[]>
  realizedTrades: Record<CalMarket, string[]>
}

export const holdingKey = (market: CalMarket, ticker: string) => `${market}:${ticker.trim().toUpperCase()}`

/** @param month "YYYY-MM" */
export function monthBook(trades: ReconTrade[], month: string): MonthBook {
  const from = `${month}-01`
  const to = `${month}-31`
  const book: MonthBook = { realized: { KR: 0, US: 0 }, holdings: {}, holdingTrades: {}, realizedTrades: { KR: [], US: [] } }
  for (const t of trades) {
    for (const e of tradeEvents({ id: t.id, market: t.market, direction: t.direction, fills: t.fills, oneR: null }, 'exit')) {
      if (e.date < from || e.date > to) continue
      book.realized[t.market] += e.net
      if (!book.realizedTrades[t.market].includes(t.id)) book.realizedTrades[t.market].push(t.id)
    }
    const upToEnd = t.fills.filter((f) => tradeDate(f.ts, t.market) <= to)
    const held = positionPnl(t.direction, upToEnd).openQty
    if (held > 0) {
      const k = holdingKey(t.market, t.ticker)
      book.holdings[k] = (book.holdings[k] ?? 0) + (t.direction === 'long' ? held : -held)
      book.holdingTrades[k] = [...(book.holdingTrades[k] ?? []), t.id]
    }
  }
  for (const k of Object.keys(book.holdings)) if (book.holdings[k] === 0) delete book.holdings[k]
  return book
}

/** Money matches within half a unit of the smallest currency step (₩1 / $0.01). */
export function moneyMatches(app: number, broker: number, market: CalMarket): boolean {
  return Math.abs(app - broker) < (market === 'KR' ? 1 : 0.01)
}
