import { buildAnaTrade, type AnaTrade } from '../../core/analysis'
import type { Bar } from '../../core/risk'
import { cacheSymbolOf } from '../../data/barBackfill'
import type { LocalRepo } from '../../data/repo'
import { readSetting, SETTING_KEYS } from '../../data/settings'
import { loadAllTrades, type TradeBundle } from '../../data/trades'
import type { Tag } from '../../data/types'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { FX_SYMBOL } from '../calendar/useCalendarData'

export interface AnalysisBase {
  /** Closed trades only, ready for the metrics. */
  trades: AnaTrade[]
  bundles: Map<string, TradeBundle>
  /** Every bundle (open ones too) — for the bar backfill and reconciliation. */
  allBundles: TradeBundle[]
  tags: Tag[]
  accountKR: number | null
  accountUS: number | null
  usdkrw: Record<string, number>
}

async function loadBase(repo: LocalRepo): Promise<AnalysisBase> {
  const [bundles, cache, tags, accountKR, accountUS] = await Promise.all([
    loadAllTrades(repo),
    repo.list('MarketCache'),
    repo.list('Tags'),
    readSetting<number | null>(repo, SETTING_KEYS.accountSize('KR'), null),
    readSetting<number | null>(repo, SETTING_KEYS.accountSize('US'), null),
  ])
  const usdkrw: Record<string, number> = {}
  const bars = new Map<string, Bar[]>()
  for (const b of cache) {
    if (b.symbol === FX_SYMBOL && typeof b.close === 'number') usdkrw[b.date] = b.close
    const list = bars.get(b.symbol) ?? []
    list.push(b)
    bars.set(b.symbol, list)
  }
  const trades: AnaTrade[] = []
  for (const t of bundles) {
    const a = buildAnaTrade({
      id: t.position.id,
      market: t.position.market,
      direction: t.position.direction,
      setup: t.position.setup,
      regime: t.position.regime,
      grade: t.review?.grade,
      noPlan: t.position.no_plan,
      checklist: (t.review?.checklist ?? null) as Record<string, boolean> | null,
      tags: t.tags.map((x) => ({ tagId: x.tag_id, phase: x.phase })),
      fills: t.fills,
      oneR: t.summary.oneR,
      originalStop: t.position.original_stop,
      planEntry: t.plan?.plan_entry,
      planQty: t.plan?.plan_qty,
      stopMoves: t.stops.map((s) => ({ oldStop: s.old_stop, newStop: s.new_stop })),
      bars: bars.get(cacheSymbolOf(t)) ?? [],
      usdkrw,
    })
    if (a) trades.push(a)
  }
  return { trades, bundles: new Map(bundles.map((b) => [b.position.id, b])), allBundles: bundles, tags, accountKR, accountUS, usdkrw }
}

/** Rebuilt only when local data changes; filters work on this in memory. */
export function useAnalysisBase(): AnalysisBase | undefined {
  return useRepoQuery(loadBase, [])
}
