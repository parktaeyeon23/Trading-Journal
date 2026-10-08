/**
 * Fetches daily bars for closed trades' holding periods (MFE/MAE) through the
 * backend, which caches them in MarketCache; the next sync pull brings them
 * here. One request per symbol window, one at a time, and a window that was
 * tried recently is not asked for again (delisted tickers, data gaps).
 */
import { windowsToFetch, type FetchWindow, type HoldWindow } from '../core/bars'
import { tradeDate } from '../core/calendar'
import { compareFills, entrySide } from '../core/pnl'
import { BackendError } from './backend'
import type { LocalRepo } from './repo'
import type { TradeBundle } from './trades'

const META_TRIED = 'bars_tried'
export const RETRY_AFTER_DAYS = 7

export const cacheSymbolOf = (t: TradeBundle) => `${t.position.market}:${t.position.ticker.trim().toUpperCase()}`

/** Holding window of a closed trade on its market's calendar. */
export function holdWindow(t: TradeBundle): HoldWindow | null {
  const s = t.position.status
  if (s !== 'review_pending' && s !== 'done') return null
  const side = entrySide(t.position.direction)
  const fills = [...t.fills].sort(compareFills)
  const first = fills.find((f) => f.side === side)
  const last = fills.filter((f) => f.side !== side).at(-1)
  if (!first || !last) return null
  return { cacheSymbol: cacheSymbolOf(t), from: tradeDate(first.ts, t.position.market), to: tradeDate(last.ts, t.position.market) }
}

/** Cached bar dates per cacheSymbol. */
export async function cachedDates(repo: LocalRepo): Promise<Map<string, string[]>> {
  const have = new Map<string, string[]>()
  for (const b of await repo.list('MarketCache')) {
    const list = have.get(b.symbol) ?? []
    list.push(b.date)
    have.set(b.symbol, list)
  }
  return have
}

export async function pendingWindows(repo: LocalRepo, trades: TradeBundle[], now = Date.now()): Promise<FetchWindow[]> {
  const holds = trades.map(holdWindow).filter((h): h is HoldWindow => !!h)
  const tried = (await repo.getMeta<Record<string, number>>(META_TRIED)) ?? {}
  return windowsToFetch(holds, await cachedDates(repo)).filter((w) => !(now - (tried[keyOf(w)] ?? 0) < RETRY_AFTER_DAYS * 86400000))
}

const keyOf = (w: FetchWindow) => `${w.cacheSymbol}|${w.from}|${w.to}`

export interface BackfillResult {
  fetched: number
  notFound: number
  /** Stopped early: no backend, offline, or the backend is struggling. */
  stopped: string | null
}

export async function backfillBars(
  repo: LocalRepo,
  getBars: (symbol: string, market: 'KR' | 'US', from: string, to: string) => Promise<unknown>,
  windows: FetchWindow[],
  onProgress?: (done: number, total: number) => void,
  now: () => number = Date.now,
): Promise<BackfillResult> {
  const res: BackfillResult = { fetched: 0, notFound: 0, stopped: null }
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const [market, symbol] = w.cacheSymbol.split(':') as ['KR' | 'US', string]
    try {
      await getBars(symbol, market, w.from, w.to)
      res.fetched++
    } catch (e) {
      const be = e instanceof BackendError ? e : new BackendError('internal', String(e))
      if (be.code === 'quote_not_found' || be.code === 'bad_request') res.notFound++
      else {
        res.stopped = be.message
        return res
      }
    }
    const tried = (await repo.getMeta<Record<string, number>>(META_TRIED)) ?? {}
    tried[keyOf(w)] = now()
    await repo.setMeta(META_TRIED, tried)
    onProgress?.(i + 1, windows.length)
  }
  return res
}
