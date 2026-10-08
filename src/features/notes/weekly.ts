import { buildAnaTrade, disciplineScore, type AnaTrade } from '../../core/analysis'
import { addDays, tradeEvents, weeklyStats, type CalEvent, type UnitContext, type WeeklyStats } from '../../core/calendar'
import type { LocalRepo } from '../../data/repo'
import { readSetting, SETTING_KEYS } from '../../data/settings'
import { loadAllTrades, type TradeBundle } from '../../data/trades'
import type { Tag } from '../../data/types'
import { FX_SYMBOL } from '../calendar/useCalendarData'

export interface WeekNumbers extends WeeklyStats {
  mistakeNames: { name: string; count: number }[]
  /** Best and worst position closed this week (by R, else by KRW). */
  best: { id: string; ticker: string; r: number | null; krw: number | null } | null
  worst: { id: string; ticker: string; r: number | null; krw: number | null } | null
  /** Discipline score (latest 20 reviewed trades) at the end of this and the 3 weeks before, oldest first. */
  disciplineTrend: { weekStart: string; score: number | null }[]
}

export interface WeekBase {
  trades: TradeBundle[]
  events: CalEvent[]
  ctx: UnitContext
  tags: Tag[]
  closed: AnaTrade[]
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
  const closed = trades
    .map((t) =>
      buildAnaTrade({
        id: t.position.id,
        market: t.position.market,
        direction: t.position.direction,
        checklist: (t.review?.checklist ?? null) as Record<string, boolean> | null,
        tags: [],
        fills: t.fills,
        oneR: t.summary.oneR,
        stopMoves: [],
        bars: [],
        usdkrw,
      }),
    )
    .filter((a): a is AnaTrade => !!a)
  return { trades, events, ctx: { usdkrw, accountKR, accountUS }, tags, closed }
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
  const ticker = new Map(base.trades.map((t) => [t.position.id, t.position.ticker]))
  const inWeek = base.closed.filter((t) => t.exitDate >= weekStart && t.exitDate <= end)
  // Rank by R when every trade has one, else by KRW (mixing the two would compare unlike units).
  const byR = inWeek.every((t) => t.r !== null)
  const score = (t: AnaTrade) => (byR ? t.r! : (t.netKrw ?? 0))
  const ranked = [...inWeek].sort((a, b) => score(b) - score(a))
  const pick = (t: AnaTrade | undefined) => (t ? { id: t.id, ticker: ticker.get(t.id) ?? '', r: t.r, krw: t.netKrw } : null)
  const disciplineTrend = [-3, -2, -1, 0].map((k) => {
    const ws = addDays(weekStart, 7 * k)
    const we = addDays(ws, 6)
    return { weekStart: ws, score: disciplineScore(base.closed.filter((t) => t.exitDate <= we)).score }
  })
  return {
    ...stats,
    mistakeNames: stats.topMistakes.map((m) => ({ name: name.get(m.tagId) ?? m.tagId, count: m.count })),
    best: pick(ranked[0]),
    worst: ranked.length > 1 ? pick(ranked[ranked.length - 1]) : null,
    disciplineTrend,
  }
}
