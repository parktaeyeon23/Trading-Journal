import { beforeEach, describe, expect, it } from 'vitest'
import { loadGas, type FakeGas } from './fakeGas'

const SECRET = 's'
let gas: FakeGas
const api = (req: Record<string, unknown>) => gas.call('handleRequest', { secret: SECRET, ...req })
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/'

/** A 200 Yahoo chart response (status, body) with daily bars at 00:00 exchange time. */
function chart(symbol: string, gmtoffset: number, days: [string, number, number, number, number | null][], extra: Record<string, unknown> = {}): [number, string] {
  return [200, JSON.stringify({
    chart: {
      result: [
        {
          meta: { symbol, gmtoffset, currency: gmtoffset === 32400 ? 'KRW' : 'USD', ...extra },
          timestamp: days.map(([d]) => Date.parse(d + 'T00:00:00Z') / 1000 - gmtoffset),
          indicators: { quote: [{ open: days.map((x) => x[1]), high: days.map((x) => x[2]), low: days.map((x) => x[3]), close: days.map((x) => x[4]) }] },
        },
      ],
    },
  })]
}

beforeEach(() => {
  gas = loadGas()
  gas.call('setupSheets')
  gas.props.set('API_SECRET', SECRET)
})

describe('getQuote', () => {
  it('finds a KOSDAQ code after KOSPI misses, with exchange-local dates', () => {
    gas.http.routes.set(
      YAHOO + '042700.KQ',
      chart('042700.KQ', 32400, [
        ['2026-10-06', 97000, 99000, 96500, 98000],
        ['2026-10-07', 98000, 99500, 97000, 98500],
      ], { longName: 'Hanmi Semiconductor', regularMarketPrice: 98600 }),
    )
    const r = api({ action: 'getQuote', symbol: '042700', market: 'KR' })
    expect(gas.http.requests.map((u) => u.split('?')[0])).toEqual([YAHOO + '042700.KS', YAHOO + '042700.KQ'])
    expect(r).toMatchObject({ ok: true, symbol: '042700.KQ', cacheSymbol: 'KR:042700', currency: 'KRW', price: 98600, asOf: '2026-10-07', name: 'Hanmi Semiconductor' })
    expect(r.bars).toEqual([
      { date: '2026-10-06', open: 97000, high: 99000, low: 96500, close: 98000 },
      { date: '2026-10-07', open: 98000, high: 99500, low: 97000, close: 98500 },
    ])
  })

  it('looks up US tickers as-is, skips empty bars, and falls back to the last close', () => {
    gas.http.routes.set(YAHOO + 'CRDO', chart('CRDO', -14400, [
      ['2026-10-06', 72, 74, 71, 73.123456],
      ['2026-10-07', 73, 74, 70, null],
    ]))
    const r = api({ action: 'getQuote', symbol: 'crdo', market: 'US' })
    expect(r).toMatchObject({ ok: true, price: 73.1235, asOf: '2026-10-06' })
    expect(r.bars).toHaveLength(1)
  })

  it('caches bars in MarketCache once, and syncs them to devices', () => {
    gas.http.routes.set(YAHOO + 'CRDO', chart('CRDO', -14400, [['2026-10-06', 72, 74, 71, 73]]))
    api({ action: 'getQuote', symbol: 'CRDO', market: 'US' })
    const first = api({ action: 'pullAll' })
    api({ action: 'getQuote', symbol: 'CRDO', market: 'US' }) // same bar again
    const rows = api({ action: 'pullAll' }).data.MarketCache
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'US:CRDO|2026-10-06', symbol: 'US:CRDO', close: 73 })
    // Unchanged bar was not rewritten, so it does not re-sync.
    expect(api({ action: 'pullAll', since: first.serverTime }).data.MarketCache).toHaveLength(0)
  })

  it('updates a cached bar when the source revises it', () => {
    gas.http.routes.set(YAHOO + 'CRDO', chart('CRDO', -14400, [['2026-10-06', 72, 74, 71, 73]]))
    api({ action: 'getQuote', symbol: 'CRDO', market: 'US' })
    gas.http.routes.set(YAHOO + 'CRDO', chart('CRDO', -14400, [['2026-10-06', 72, 75, 71, 74.5]]))
    api({ action: 'getQuote', symbol: 'CRDO', market: 'US' })
    expect(api({ action: 'pullAll' }).data.MarketCache[0]).toMatchObject({ high: 75, close: 74.5 })
  })

  it('reports unknown symbols, bad KR input, outages and bad requests distinctly', () => {
    expect(api({ action: 'getQuote', symbol: 'NOPE', market: 'US' }).error.code).toBe('quote_not_found')
    const kr = api({ action: 'getQuote', symbol: '한미반도체', market: 'KR' })
    expect(kr.error.code).toBe('quote_not_found')
    expect(kr.error.message).toMatch(/6자리/)
    gas.http.failNetwork = true
    expect(api({ action: 'getQuote', symbol: 'CRDO', market: 'US' }).error.code).toBe('quote_failed')
    gas.http.failNetwork = false
    gas.http.routes.set(YAHOO + 'CRDO', [429, 'Too Many Requests'])
    expect(api({ action: 'getQuote', symbol: 'CRDO', market: 'US' }).error.code).toBe('quote_failed')
    expect(api({ action: 'getQuote', symbol: '', market: 'US' }).error.code).toBe('bad_request')
    expect(api({ action: 'getQuote', symbol: 'CRDO', market: 'JP' }).error.code).toBe('bad_request')
  })
})

describe('index and FX series', () => {
  it('serves the fixed index/FX keys through getQuote and caches them as IDX:<key>', () => {
    gas.http.routes.set(YAHOO + '%5EKS11', chart('^KS11', 32400, [['2026-10-07', 2600, 2620, 2590, 2610]]))
    const r = api({ action: 'getQuote', symbol: 'kospi', market: 'IDX' })
    expect(r).toMatchObject({ ok: true, cacheSymbol: 'IDX:KOSPI', asOf: '2026-10-07' })
    expect(api({ action: 'pullAll' }).data.MarketCache[0]).toMatchObject({ id: 'IDX:KOSPI|2026-10-07', close: 2610 })
    expect(api({ action: 'getQuote', symbol: 'NIKKEI', market: 'IDX' }).error.code).toBe('quote_not_found')
  })

  it('refreshes every series, keeps going past a failing one, and installs one morning trigger', () => {
    gas.http.routes.set(YAHOO + 'KRW%3DX', chart('KRW=X', 3600, [['2026-10-06', 1400, 1412, 1398, 1410]]))
    for (const s of ['%5EKS11', '%5EKQ11', '%5EGSPC']) gas.http.routes.set(YAHOO + s, chart(s, -14400, [['2026-10-06', 1, 1, 1, 1]]))
    // NASDAQ has no route → 404 → not found
    const res = gas.call('refreshMarketSeries', '1y')
    expect(res.done).toEqual(['KOSPI', 'KOSDAQ', 'SPX', 'USDKRW'])
    expect(res.failed[0]).toMatch(/^NASDAQ/)
    expect(gas.http.requests.every((u) => u.includes('range=1y'))).toBe(true)
    const fx = api({ action: 'pullAll' }).data.MarketCache.find((b: { symbol: string }) => b.symbol === 'IDX:USDKRW')
    expect(fx).toMatchObject({ date: '2026-10-06', close: 1410 })

    gas.call('installMarketTrigger')
    gas.call('installMarketTrigger')
    expect(gas.triggers).toEqual([{ handler: 'refreshMarketSeries', hour: 7, minute: 30 }])
  })
})

