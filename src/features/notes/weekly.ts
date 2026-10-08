import { addDays, tradeEvents, weeklyStats, type CalEvent, type UnitContext, type WeeklyStats } from '../../core/calendar'
import type { LocalRepo } from '../../data/repo'
import { readSetting, SETTING_KEYS } from '../../data/settings'
import { loadAllTrades, type TradeBundle } from '../../data/trades'
import type { Tag } from '../../data/types'
import { FX_SYMBOL } from '../calendar/useCalendarData'

export interface WeekNumbers extends WeeklyStats {
  mistakeNames: { name: string; count: number }[]
}

export interface WeekBase {
  trades: TradeBundle[]
  events: CalEvent[]
  ctx: UnitContext
  tags: Tag[]
}

/** Everything the weekly numbers need, read once (exit-day basis, all markets, calendar filters ignored). */
export async function loadWeekBase(repo: LocalRepo): Promise<WeekBase> {
  const [trades, bars, tags, accountKR, accountUS] = await Promise.all([
    loadAllTrades(repo),
    repo.list('MarketCache'),
    repo.list('Tags'),
    readSetting<number | null>(repo, SETTING_KEYS.accountSize('KR'), null),
    readSetting<number | null>(repo, SETTING_KEYS.accountSize('US'), null),
  ])
  const usdkrw: Record<string, number> = {}
  for (const b of bars) if (b.symbol === FX_SYMBOL && typeof b.close === 'number') usdkrw[b.date] = b.close
  const events = trades.flatMap((t) =>
    tradeEvents({ id: t.position.id, market: t.position.market, direction: t.position.direction, fills: t.fills, oneR: t.summary.oneR }, 'exit'),
  )
  return { trades, events, ctx: { usdkrw, accountKR, accountUS }, tags }
}

/** Results that closed Monday–Sunday of the week. */
export function weekNumbers(base: WeekBase, weekStart: string): WeekNumbers {
  const end = addDays(weekStart, 6)
  const events = base.events.filter((e) => e.date >= weekStart && e.date <= end)
  const ids = new Set(events.map((e) => e.tradeId))
  const week = base.trades.filter((t) => ids.has(t.position.id))
  const mistakeIds = new Set(base.tags.filter((t) => t.family === 'mistake').map((t) => t.id))
  const stats = weeklyStats({
    events,
    ctx: base.ctx,
    checklists: week.map((t) => (t.review?.checklist ?? null) as Record<string, boolean> | null).filter((c): c is Record<string, boolean> => !!c),
    mistakeTagIds: week.flatMap((t) => t.tags.filter((x) => !x.phase && mistakeIds.has(x.tag_id)).map((x) => x.tag_id)),
  })
  const name = new Map(base.tags.map((t) => [t.id, t.name]))
  return { ...stats, mistakeNames: stats.topMistakes.map((m) => ({ name: name.get(m.tagId) ?? m.tagId, count: m.count })) }
}
