import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { openAppDb } from '../../src/data/db'
import { addTradingViewChart } from '../../src/data/charts'
import { LocalRepo } from '../../src/data/repo'
import { addFill, createPlannedTrade, ensureDefaults, loadAllTrades, saveReview } from '../../src/data/trades'
import { coverImage } from '../../src/features/chartbook/chartItems'
import { exitTime, filterGallery, NO_FILTERS, periodStart } from '../../src/features/chartbook/gallery'

let repo: LocalRepo
let n = 0
beforeEach(async () => {
  repo = new LocalRepo(await openAppDb(`gallery-${++n}`))
  await ensureDefaults(repo)
})

async function trade(ticker: string, setup: string, exitDay: string, exitPrice: number) {
  const p = await createPlannedTrade(repo, {
    position: { ticker, market: 'US', direction: 'long', setup, original_stop: 90 },
    plan: { plan_entry: 100, plan_qty: 10 },
  })
  await addFill(repo, p.id, { ts: '2025-12-01T14:00:00.000Z', side: 'buy', price: 100, qty: 10 })
  await addFill(repo, p.id, { ts: `${exitDay}T14:00:00.000Z`, side: 'sell', price: exitPrice, qty: 10 })
  return p
}

describe('gallery', () => {
  it('filters closed trades by setup, result, grade, mistake and period, newest exit first', async () => {
    const win = await trade('WIN', 'VCP 돌파', '2026-10-05', 120)
    const loss = await trade('LOSS', '눌림', '2026-09-10', 90)
    await trade('OLD', 'VCP 돌파', '2025-12-20', 110)
    // still open
    const open = await createPlannedTrade(repo, { position: { ticker: 'OPEN', market: 'US', direction: 'long', original_stop: 9 }, plan: {} })
    await addFill(repo, open.id, { ts: '2026-10-01T14:00:00.000Z', side: 'buy', price: 10, qty: 1 })
    await saveReview(repo, loss.id, { checklist: { a: false }, grade: 'D', good: null, improve: null, next_rule: null, promoted_rule: false, mistakeTagIds: ['tag-mistake-chase'], emotionTags: [] })
    await addTradingViewChart(repo, win.id, 'setup', 'https://www.tradingview.com/x/Set1/')
    await addTradingViewChart(repo, win.id, 'exit', 'https://www.tradingview.com/x/Ext1/')

    const all = await loadAllTrades(repo)
    const now = new Date('2026-10-08T03:00:00.000Z')
    const tickers = (f: Partial<typeof NO_FILTERS>) => filterGallery(all, { ...NO_FILTERS, ...f }, now).map((t) => t.position.ticker)

    expect(tickers({})).toEqual(['WIN', 'LOSS', 'OLD'])
    expect(tickers({ result: 'win' })).toEqual(['WIN', 'OLD'])
    expect(tickers({ result: 'loss' })).toEqual(['LOSS'])
    expect(tickers({ setup: 'VCP 돌파' })).toEqual(['WIN', 'OLD'])
    expect(tickers({ grade: 'D' })).toEqual(['LOSS'])
    expect(tickers({ mistakeTagId: 'tag-mistake-chase' })).toEqual(['LOSS'])
    expect(tickers({ period: '30d' })).toEqual(['WIN', 'LOSS'])
    expect(tickers({ period: 'ytd' })).toEqual(['WIN', 'LOSS'])

    const w = all.find((t) => t.position.id === win.id)!
    expect(coverImage(w)).toEqual(['https://s3.tradingview.com/snapshots/e/Ext1.png'])
    expect(coverImage(all.find((t) => t.position.id === loss.id)!)).toBeNull()
    expect(exitTime(all.find((t) => t.position.id === open.id)!)).toBeNull()
  })

  it('computes period starts', () => {
    const now = new Date('2026-10-08T03:00:00.000Z')
    expect(periodStart('all', now)).toBeNull()
    expect(periodStart('30d', now)).toBe('2026-09-08T03:00:00.000Z')
  })
})
