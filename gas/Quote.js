/**
 * Daily quotes for the calculator. The data source lives behind one function,
 * fetchDailyBars_(), so swapping Yahoo for another source touches nothing else.
 *
 * Request:  { action: "getQuote", symbol: "042700" | "CRDO", market: "KR" | "US" }
 * Response: { ok, symbol, name, currency, price, asOf, bars: [{date, open, high, low, close}] }
 * Bars (last ~3 months) are also written to MarketCache so every device gets them by sync.
 */

var QUOTE_RANGE = '3mo'
var QUOTE_MAX_BARS = 70

function getQuote_(symbol, market) {
  if (typeof symbol !== 'string' || !symbol.trim()) throw apiError_('bad_request', 'symbol is required.')
  if (MARKETS.indexOf(market) < 0) throw apiError_('bad_request', 'market must be KR or US.')
  var candidates = yahooSymbols_(symbol.trim().toUpperCase(), market)
  var data = null
  for (var i = 0; i < candidates.length && !data; i++) data = fetchDailyBars_(candidates[i])
  if (!data) throw apiError_('quote_not_found', '시세를 찾지 못했습니다: ' + symbol + (market === 'KR' ? ' (KR은 6자리 종목코드로 입력)' : ''))

  var bars = data.bars.slice(-QUOTE_MAX_BARS)
  var cacheSymbol = market + ':' + symbol.trim().toUpperCase()
  withLock_(function () {
    cacheBars_(cacheSymbol, bars)
  })
  var last = bars[bars.length - 1]
  return {
    ok: true,
    symbol: data.symbol,
    cacheSymbol: cacheSymbol,
    name: data.name,
    currency: data.currency,
    price: data.price != null ? data.price : last ? last.close : null,
    asOf: last ? last.date : null,
    bars: bars,
  }
}

/** KR codes are tried on KOSPI (.KS) first, then KOSDAQ (.KQ). */
function yahooSymbols_(symbol, market) {
  if (market === 'US') return [symbol]
  if (/\.(KS|KQ)$/.test(symbol)) return [symbol]
  if (!/^[0-9A-Z]{6}$/.test(symbol)) return []
  return [symbol + '.KS', symbol + '.KQ']
}

/**
 * The only function that knows about the data source.
 * @return {{symbol, name, currency, price, bars: Array<{date, open, high, low, close}>} | null}
 *   null when the source has no such symbol; throws quote_failed when the source is unreachable.
 */
function fetchDailyBars_(yahooSymbol) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yahooSymbol) + '?range=' + QUOTE_RANGE + '&interval=1d'
  var res
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } })
  } catch (e) {
    throw apiError_('quote_failed', '시세 서버에 연결하지 못했습니다.')
  }
  var code = res.getResponseCode()
  if (code === 404) return null
  if (code !== 200) throw apiError_('quote_failed', '시세 서버 오류 (HTTP ' + code + ')')
  var body
  try {
    body = JSON.parse(res.getContentText())
  } catch (e) {
    throw apiError_('quote_failed', '시세 응답을 읽지 못했습니다.')
  }
  var result = body && body.chart && body.chart.result && body.chart.result[0]
  if (!result || !result.timestamp || !result.indicators || !result.indicators.quote) return null
  var q = result.indicators.quote[0]
  var meta = result.meta || {}
  var offsetSec = meta.gmtoffset || 0
  var bars = []
  result.timestamp.forEach(function (t, i) {
    if (q.close[i] == null) return
    bars.push({
      // Exchange-local calendar date of the bar.
      date: new Date((t + offsetSec) * 1000).toISOString().slice(0, 10),
      open: round_(q.open[i]),
      high: round_(q.high[i]),
      low: round_(q.low[i]),
      close: round_(q.close[i]),
    })
  })
  if (!bars.length) return null
  return {
    symbol: yahooSymbol,
    name: meta.longName || meta.shortName || null,
    currency: meta.currency || null,
    price: typeof meta.regularMarketPrice === 'number' ? round_(meta.regularMarketPrice) : null,
    bars: bars,
  }
}

function round_(v) {
  return typeof v === 'number' ? Math.round(v * 10000) / 10000 : null
}

/** Upserts bars into MarketCache with deterministic ids so repeated lookups never duplicate. */
function cacheBars_(cacheSymbol, bars) {
  var ss = getSpreadsheet_()
  var table = openTable_(ss, 'MarketCache')
  var now = nowIso_()
  var rows = bars.map(function (b) {
    return validateRow('MarketCache', {
      id: cacheSymbol + '|' + b.date,
      created_at: now,
      updated_at: now,
      symbol: cacheSymbol,
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }).row
  })
  var existing = {}
  Object.keys(table.index).forEach(function (id) {
    existing[id] = rowAt_(table, id)
  })
  // The server owns these rows, so it writes them directly instead of going
  // through last-write-wins: a revised bar must land even when two lookups
  // share a millisecond. Unchanged bars (same OHLC) are left alone so they do
  // not re-sync to every device.
  var plan = { inserts: [], updates: [], unchanged: [], conflicts: [] }
  rows.forEach(function (r) {
    var cur = existing[r.id]
    if (!cur) {
      r.synced_at = now
      plan.inserts.push(r)
    } else if (cur.open !== r.open || cur.high !== r.high || cur.low !== r.low || cur.close !== r.close) {
      var bumped = Math.max(Date.parse(now), Date.parse(cur.updated_at) + 1)
      r.created_at = cur.created_at
      r.updated_at = new Date(bumped).toISOString()
      r.synced_at = r.updated_at
      plan.updates.push(r)
    }
  })
  applyPlan_(table, plan)
}
