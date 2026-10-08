import { useMemo } from 'react'
import { dailyBuckets, tradeEvents, type CalEvent, type DayBucket, type UnitContext } from '../../core/calendar'
import type { LocalRepo } from '../../data/repo'
import { readSetting, SETTING_KEYS } from '../../data/settings'
import { loadAllTrades, type TradeBundle } from '../../data/trades'
import type { Tag } from '../../data/types'
import { useFilters } from '../../ui/filterStore'
import { useRepoQuery } from '../../ui/useRepoQuery'

export const FX_SYMBOL = 'IDX:USDKRW'

export interface CalendarBase {
  trades: TradeBundle[]
  ctx: UnitContext
  /** Dates (YYYY-MM-DD) that have a daily note with text. */
  noteDates: Set<string>
  tags: Tag[]
}

async function loadBase(repo: LocalRepo): Promise<CalendarBase> {
  const [trades, bars, notes, tags, accountKR, accountUS] = await Promise.all([
    loadAllTrades(repo),
    repo.list('MarketCache'),
    repo.list('DailyNotes'),
    repo.list('Tags'),
    readSetting<number | null>(repo, SETTING_KEYS.accountSize('KR'), null),
    readSetting<number | null>(repo, SETTING_KEYS.accountSize('US'), null),
  ])
  const usdkrw: Record<string, number> = {}
  for (const b of bars) if (b.symbol === FX_SYMBOL && typeof b.close === 'number') usdkrw[b.date] = b.close
  return {
    trades,
    ctx: { usdkrw, accountKR, accountUS },
    noteDates: new Set(notes.filter((n) => (n.premarket ?? '').trim() || (n.postmarket ?? '').trim()).map((n) => n.date)),
    tags,
  }
}

export interface CalendarModel extends CalendarBase {
  /** Trades after the market/setup/tag filters. */
  shown: TradeBundle[]
  byId: Map<string, TradeBundle>
  events: CalEvent[]
  buckets: Map<string, DayBucket>
}

/**
 * Everything the calendar draws, recomputed only when data or a filter
 * changes — moving between months reuses it, which keeps paging instant.
 */
export function useCalendarModel(): CalendarModel | undefined {
  const base = useRepoQuery(loadBase, [])
  const { market, setup, tagIds, grade, result, basis, unit } = useFilters()

  const shown = useMemo(
    () =>
      (base?.trades ?? []).filter(
        (t) =>
          (market === 'ALL' || t.position.market === market) &&
          (!setup || t.position.setup === setup) &&
          tagIds.every((id) => t.tags.some((x) => x.tag_id === id)) &&
          (!grade || t.review?.grade === grade) &&
          (!result || (result === 'win' ? t.summary.pnl.realizedNet > 0 : result === 'loss' ? t.summary.pnl.realizedNet < 0 : t.summary.pnl.realizedNet === 0)),
      ),
    [base, market, setup, tagIds, grade, result],
  )
  const events = useMemo(
    () =>
      shown.flatMap((t) =>
        tradeEvents({ id: t.position.id, market: t.position.market, direction: t.position.direction, fills: t.fills, oneR: t.summary.oneR }, basis),
      ),
    [shown, basis],
  )
  const buckets = useMemo(() => (base ? dailyBuckets(events, unit, base.ctx) : new Map<string, DayBucket>()), [events, unit, base])
  const byId = useMemo(() => new Map(shown.map((t) => [t.position.id, t])), [shown])

  if (!base) return undefined
  return { ...base, shown, byId, events, buckets }
}
