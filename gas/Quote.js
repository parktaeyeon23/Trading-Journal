/**
 * Daily quotes for the calculator. The data source lives behind one function,
 * fetchDailyBars_(), so swapping Yahoo for another source touches nothing else.
 *
 * Request:  { action: "getQuote", symbol: "042700" | "CRDO" | "KOSPI", market: "KR" | "US" | "IDX" }
 *   IDX = index or FX series from MARKET_SERIES (KOSPI, KOSDAQ, SPX, NASDAQ, USDKRW).
 * Response: { ok, symbol, name, currency, price, asOf, bars: [{date, open, high, low, close}] }
 * Bars (last ~3 months) are also written to MarketCache so every device gets them by sync.
 */

var QUOTE_RANGE = '3mo'
var QUOTE_MAX_BARS = 70

/** Index and FX series the calendar uses. Key = app name (cached as IDX:<key>), value = Yahoo symbol. */
var MARKET_SERIES = { KOSPI: '^KS11', KOSDAQ: '^KQ11', SPX: '^GSPC', NASDAQ: '^IXIC', USDKRW: 'KRW=X' }
var QUOTE_MARKETS = ['KR', 'US', 'IDX']
var SERIES_HOUR = 7
var SERIES_MINUTE = 30

function getQuote_(symbol, market, range) {
  if (typeof symbol !== 'string' || !symbol.trim()) throw apiError_('bad_request', 'symbol is required.')
  if (QUOTE_MARKETS.indexOf(market) < 0) throw apiError_('bad_request', 'market must be KR, US or IDX.')
  var candidates = yahooSymbols_(symbol.trim().toUpperCase(), market)
  var data = null
  for (var i = 0; i < candidates.length && !data; i++) data = fetchDailyBars_(candidates[i], range || QUOTE_RANGE)
  if (!data) throw apiError_('quote_not_found', '시세를 찾지 못했습니다: ' + symbol + (market === 'KR' ? ' (KR은 6자리 종목코드로 입력)' : ''))

  var bars = range ? data.bars : data.bars.slice(-QUOTE_MAX_BARS)
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
  if (market === 'IDX') return MARKET_SERIES[symbol] ? [MARKET_SERIES[symbol]] : []
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
function fetchDailyBars_(yahooSymbol, range) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yahooSymbol) + '?range=' + (range || QUOTE_RANGE) + '&interval=1d'
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

/**
 * Trigger target: refreshes every MARKET_SERIES entry into MarketCache, so the
 * calendar has index moves and USD/KRW even on days the app was not opened.
 * One failing series does not stop the others.
 * @param {string=} range Yahoo range, e.g. '1y' for the first fill.
 */
function refreshMarketSeries(range) {
  var done = []
  var failed = []
  Object.keys(MARKET_SERIES).forEach(function (key) {
    try {
      getQuote_(key, 'IDX', typeof range === 'string' ? range : '1mo')
      done.push(key)
    } catch (e) {
      failed.push(key + ': ' + (e && e.message))
    }
  })
  Logger.log('시장 시세 갱신: ' + done.join(', ') + (failed.length ? ' / 실패: ' + failed.join('; ') : ''))
  return { done: done, failed: failed }
}

/**
 * Run once from the editor. Fills the last year of index/FX bars now, then
 * refreshes them every morning around 07:30 Asia/Seoul (after the US close).
 * Safe to run again: there is always exactly one such trigger.
 */
function installMarketTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshMarketSeries') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('refreshMarketSeries').timeBased().everyDays(1).atHour(SERIES_HOUR).nearMinute(SERIES_MINUTE).create()
  refreshMarketSeries('1y')
  Logger.log('매일 ' + SERIES_HOUR + '시 ' + SERIES_MINUTE + '분 무렵 지수·환율 갱신이 예약됐습니다.')
}
