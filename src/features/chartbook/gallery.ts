import { entrySide } from '../../core/pnl'
import type { TradeBundle } from '../../data/trades'

export type ResultFilter = 'all' | 'win' | 'loss'
export type PeriodFilter = 'all' | '30d' | '90d' | 'ytd'

export interface GalleryFilters {
  setup: string | null
  result: ResultFilter
  mistakeTagId: string | null
  grade: 'A' | 'B' | 'C' | 'D' | null
  period: PeriodFilter
}

export const NO_FILTERS: GalleryFilters = { setup: null, result: 'all', mistakeTagId: null, grade: null, period: 'all' }

/** Last exit fill time of a closed trade (null while open). */
export function exitTime(t: TradeBundle): string | null {
  if (t.position.status !== 'review_pending' && t.position.status !== 'done') return null
  const out = entrySide(t.position.direction) === 'buy' ? 'sell' : 'buy'
  return t.fills.filter((f) => f.side === out).at(-1)?.ts ?? null
}

export function periodStart(period: PeriodFilter, now: Date): string | null {
  if (period === 'all') return null
  if (period === 'ytd') return new Date(now.getFullYear(), 0, 1).toISOString()
  return new Date(now.getTime() - (period === '30d' ? 30 : 90) * 86400000).toISOString()
}

/** Closed trades matching every filter, newest exit first. Win/loss is by realized net P&L. */
export function filterGallery(trades: TradeBundle[], f: GalleryFilters, now: Date): TradeBundle[] {
  const from = periodStart(f.period, now)
  return trades
    .map((t) => ({ t, at: exitTime(t) }))
    .filter(({ t, at }) => {
      if (!at) return false
      if (from && at < from) return false
      if (f.setup && t.position.setup !== f.setup) return false
      const net = t.summary.pnl.realizedNet
      if (f.result === 'win' && !(net > 0)) return false
      if (f.result === 'loss' && !(net < 0)) return false
      if (f.grade && t.review?.grade !== f.grade) return false
      if (f.mistakeTagId && !t.tags.some((x) => x.tag_id === f.mistakeTagId && !x.phase)) return false
      return true
    })
    .sort((a, b) => (a.at! < b.at! ? 1 : -1))
    .map(({ t }) => t)
}
