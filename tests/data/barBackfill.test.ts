import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { BackendError } from '../../src/data/backend'
import { backfillBars, holdWindow, pendingWindows } from '../../src/data/barBackfill'
import { openAppDb } from '../../src/data/db'
import { LocalRepo } from '../../src/data/repo'
import { addFill, createPlannedTrade, loadAllTrades } from '../../src/data/trades'

let repo: LocalRepo
let n = 0
beforeEach(async () => {
  repo = new LocalRepo(await openAppDb(`bars-${++n}`))
})

async function closed(ticker: string, market: 'KR' | 'US', inTs: string, outTs: string) {
  const p = await createPlannedTrade(repo, { position: { ticker, market, direction: 'long', original_stop: 9 }, plan: {} })
  await addFill(repo, p.id, { ts: inTs, side: 'buy', price: 10, qty: 1 })
  await addFill(repo, p.id, { ts: outTs, side: 'sell', price: 11, qty: 1 })
  return p
}

describe('bar backfill', () => {
  it('plans one window per uncovered symbol, on market-local dates', async () => {
    await closed('crdo', 'US', '2026-09-01T15:00:00.000Z', '2026-09-09T01:00:00.000Z') // exit 9/8 New York
    await closed('042700', 'KR', '2026-09-01T01:00:00.000Z', '2026-09-03T01:00:00.000Z')
    const open = await createPlannedTrade(repo, { position: { ticker: 'OPEN', market: 'US', direction: 'long' }, plan: {} })
    const trades = await loadAllTrades(repo)
    expect(holdWindow(trades.find((t) => t.position.id === open.id)!)).toBeNull()
    for (const d of ['2026-09-01', '2026-09-03']) await repo.put('MarketCache', { id: `KR:042700|${d}`, symbol: 'KR:042700', date: d, close: 1 })
    expect(await pendingWindows(repo, trades)).toEqual([{ cacheSymbol: 'US:CRDO', from: '2026-09-01', to: '2026-09-08' }])
  })

  it('remembers tried windows for a week and stops on outages', async () => {
    await closed('CRDO', 'US', '2026-09-01T15:00:00.000Z', '2026-09-08T15:00:00.000Z')
    await closed('GONE', 'US', '2026-09-01T15:00:00.000Z', '2026-09-08T15:00:00.000Z')
    const trades = await loadAllTrades(repo)
    const calls: string[] = []
    const windows = await pendingWindows(repo, trades)
    const res = await backfillBars(repo, async (s) => {
      calls.push(s)
      if (s === 'GONE') throw new BackendError('quote_not_found', 'x')
    }, windows)
    expect(res).toEqual({ fetched: 1, notFound: 1, stopped: null })
    expect(calls).toEqual(['CRDO', 'GONE'])
    // Not asked again within a week (bars have not synced back yet either).
    expect(await pendingWindows(repo, trades)).toEqual([])
    expect(await pendingWindows(repo, trades, Date.now() + 8 * 86400000)).toHaveLength(2)

    const stop = await backfillBars(repo, async () => {
      throw new BackendError('network', 'offline')
    }, windows)
    expect(stop).toMatchObject({ fetched: 0, stopped: 'offline' })
  })
})
