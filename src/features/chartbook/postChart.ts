import { tradeDate } from '../../core/calendar'
import { postChartDue } from '../../core/charts'
import { entrySide } from '../../core/pnl'
import type { TradeBundle } from '../../data/trades'

/** The trade's last exit day on its market's calendar (null while not fully closed). */
export function exitDayOf(t: TradeBundle): string | null {
  const s = t.position.status
  if (s !== 'review_pending' && s !== 'done') return null
  const side = entrySide(t.position.direction)
  const last = t.fills.filter((f) => f.side !== side).at(-1)
  return last ? tradeDate(last.ts, t.position.market) : null
}

/**
 * Trading days since the exit when the ④ post-trade chart is due and missing, else null.
 * `extraPost` counts post-slot images still waiting to upload.
 */
export function postChartDays(t: TradeBundle, today: string, extraPost = 0): number | null {
  return postChartDue(exitDayOf(t), today, extraPost > 0 || t.charts.some((c) => c.slot === 'post'))
}
