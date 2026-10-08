/**
 * Read-side helpers that combine several entities. They read through LocalRepo
 * and do the math with /src/core.
 */
import { positionPnl } from '../core/pnl'
import type { OpenRiskItem } from '../core/risk'
import type { Bar } from '../core/risk'
import type { LocalRepo } from './repo'
import type { Market } from './types'

/** Current stop of a position: the latest stop move, else the original stop. */
export async function currentStop(repo: LocalRepo, positionId: string, originalStop: number | null | undefined): Promise<number | null> {
  const moves = await repo.listByPosition('StopHistory', positionId)
  if (!moves.length) return originalStop ?? null
  return [...moves].sort((a, b) => (a.ts < b.ts ? 1 : -1))[0].new_stop
}

/** Open positions as inputs for core.openRiskPct. */
export async function openRiskItems(repo: LocalRepo, accounts: Record<Market, number>): Promise<OpenRiskItem[]> {
  const open = (await repo.list('Positions')).filter((p) => p.status === 'open')
  const items: OpenRiskItem[] = []
  for (const p of open) {
    const pnl = positionPnl(p.direction, await repo.listByPosition('Fills', p.id))
    items.push({
      direction: p.direction,
      openQty: pnl.openQty,
      avgCost: pnl.avgCost,
      stop: await currentStop(repo, p.id, p.original_stop),
      account: accounts[p.market] ?? 0,
    })
  }
  return items
}

/** Daily bars cached for a symbol (MarketCache symbol like "KR:042700"), oldest first. */
export async function cachedBars(repo: LocalRepo, cacheSymbol: string): Promise<Bar[]> {
  const rows = (await repo.list('MarketCache')).filter((r) => r.symbol === cacheSymbol)
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1)).map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close }))
}
