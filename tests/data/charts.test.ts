import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addTradingViewChart, ChartLinkError, exitChartCount, nextFreeSort } from '../../src/data/charts'
import { openAppDb } from '../../src/data/db'
import { LocalRepo } from '../../src/data/repo'
import { createPlannedTrade, loadTrade } from '../../src/data/trades'

let repo: LocalRepo
let n = 0
beforeEach(async () => {
  repo = new LocalRepo(await openAppDb(`charts-${++n}`))
})

describe('chartbook data', () => {
  it('stores a TradingView snapshot as a file-less row, sorted into the trade by slot', async () => {
    const p = await createPlannedTrade(repo, { position: { ticker: 'CRDO', market: 'US', direction: 'long', original_stop: 69.8 }, plan: { plan_entry: 72.4 } })
    await addTradingViewChart(repo, p.id, 'free', 'https://www.tradingview.com/x/Zz1/', 0)
    await addTradingViewChart(repo, p.id, 'exit', 'https://www.tradingview.com/x/Ab2/')
    const t = (await loadTrade(repo, p.id))!
    expect(t.charts.map((c) => c.slot)).toEqual(['exit', 'free'])
    expect(t.charts[0].file_id).toBeNull()
    expect(t.charts[0].annotation).toEqual({ link: 'https://www.tradingview.com/x/Ab2/', image: 'https://s3.tradingview.com/snapshots/a/Ab2.png' })
    expect(await repo.hasPending('ChartImages', t.charts[0].id)).toBe(true)

    await repo.remove('ChartImages', t.charts[0].id)
    expect((await loadTrade(repo, p.id))!.charts.map((c) => c.slot)).toEqual(['free'])
  })

  it('refuses links that are not snapshots', async () => {
    const p = await createPlannedTrade(repo, { position: { ticker: 'CRDO', market: 'US', direction: 'long', original_stop: 69.8 }, plan: { plan_entry: 72.4 } })
    await expect(addTradingViewChart(repo, p.id, 'exit', 'https://www.tradingview.com/chart/abc/')).rejects.toBeInstanceOf(ChartLinkError)
  })

  it('counts exit charts including waiting uploads, and numbers free attachments', () => {
    expect(exitChartCount([{ slot: 'setup' }], [{ slot: 'exit', state: 'failed' }])).toBe(0)
    expect(exitChartCount([{ slot: 'exit' }], [{ slot: 'exit', state: 'waiting' }])).toBe(2)
    expect(nextFreeSort([], [])).toBe(0)
    expect(nextFreeSort([{ slot: 'free', sort: 3 }, { slot: 'exit', sort: 9 }], [{ slot: 'free', sort: 4 }])).toBe(5)
  })
})
