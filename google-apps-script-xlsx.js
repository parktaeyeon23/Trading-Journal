// =============================================================
//  Park's Trading Journal — SMS → Sheets + Feedback Sync
//  (전체 코드 — 기존 GAS 스크립트를 이것으로 교체)
// =============================================================

const SHEET_ID            = '1stAP-xtW-kjf0mQpfkxPzkdM0H-UXnTqJ3IVAUa4bRk';
const SHEET_NAME          = 'Trades';        // 매매일지 시트명 (기존)
const FEEDBACK_SHEET_NAME = 'Feedback';      // ⭐ 새로 만들 시트 (헤더: ID | feedback | updatedAt)
const INDEXCACHE_SHEET_NAME = 'IndexCache';  // ⭐ (Step 3) 지수 일별 캐시: date | indexCode | close | changePct
const SECRET              = 'park-trading-journal-xxxx'; // 폰/PWA와 동일
const TZ                  = 'Asia/Seoul';

// ===== Trades 시트 컬럼 스키마 (포지션 단위, v2) =====
// 기존 컬럼은 순서·이름 유지(headerMap이 이름 기반이라 순서 무관하나, 마이그레이션 안전을 위해
// 새 컬럼은 뒤에 append). 헤더가 없거나 부족하면 ensureTradesHeader()가 보강한다.
const TRADE_COLUMNS = [
  'ID', '날짜', '시장', '티커', '평균진입가', '평균청산가', '손절가', '총수량', '손익', '대표근거', '메모',
  '매수내역', '청산내역',
  // --- v2 신규 ---
  '종목명', '방향', '상태', '평균청산수량', 'R배수', '진입태그', '청산근거', '청산태그',
  '진입일', '청산일', '지수', '피드백', '소스', '생성일시', '수정일시'
];


// ---------- Entry: POST ----------
function doPost(e) {
  try {
    const secret = e.parameter.secret;
    if (secret !== SECRET) return out({ ok: false, error: 'unauthorized' });

    const action = e.parameter.action;
    if (action === 'saveFeedback') return handleSaveFeedback(e);
    if (action === 'loadFeedback') return handleLoadFeedback(e);
    if (action === 'saveImage')    return handleSaveImage(e);  // ⭐ v2(FR-4): 차트 이미지 Drive 업로드
    if (action === 'save')         return handleSave(e);   // ⭐ v2: 포지션 배열 저장 (PWA cloudUpload)
    if (action === 'load')         return handleLoad(e);   // ⭐ v2: 포지션 배열 로드 (JSONP fallback)

    // 기본: SMS 처리
    return handleSMS(e);
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}


// ---------- Entry: GET (JSONP 지원, PWA가 피드백 로드용으로 호출) ----------
function doGet(e) {
  try {
    if (e.parameter.action === 'loadFeedback') return handleLoadFeedback(e);
    if (e.parameter.action === 'load')         return handleLoad(e);       // ⭐ v2: PWA cloudDownload (JSONP)
    if (e.parameter.action === 'getIndices')   return handleGetIndices(e);  // ⭐ FR-5: 거래일 지수 (JSONP)
    return out({ ok: true, message: 'GAS reachable', time: new Date().toISOString() });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}


// ---------- SMS handler ----------
function handleSMS(e) {
  const smsBody = e.postData.contents || '';
  const receivedAt = new Date(); // 서버 시간 = 당일 보장

  const fill = parseFill(smsBody, receivedAt);
  if (!fill) return out({ ok: false, error: 'parse_failed', sms: smsBody });
  if (isDuplicate(fill)) return out({ ok: true, dedup: true });

  const sheet = ensureTradesHeader(SpreadsheetApp.openById(SHEET_ID)); // v2 신규 컬럼 보강
  const result = applyFill(sheet, fill);
  markProcessed(fill);
  return out({ ok: true, ...result });
}


// ---------- Feedback handlers ----------
// 피드백 셀(JSON)을 부분 병합(read-modify-write). text/followedPlan 과 imageRefs 가
// 서로 다른 요청(saveFeedback vs saveImage)에서 와도 덮어쓰지 않도록 키 단위 merge + Lock.
function mergeFeedback_(id, partial) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { /* 잠금 실패해도 진행 */ }
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(FEEDBACK_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) { rowIdx = i; break; }
    }
    let existing = {};
    if (rowIdx >= 0) { try { existing = JSON.parse(data[rowIdx][1]) || {}; } catch (e) { existing = {}; } }
    const merged = Object.assign({}, existing, partial);
    const now = new Date();
    if (rowIdx >= 0) sheet.getRange(rowIdx + 1, 2, 1, 2).setValues([[JSON.stringify(merged), now]]);
    else sheet.appendRow([String(id), JSON.stringify(merged), now]);
    return merged;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function handleSaveFeedback(e) {
  const id = String(e.parameter.id || '');
  const feedback = e.parameter.feedback || '';
  if (!id || !feedback) return out({ ok: false, error: 'missing_params' });
  let parsed;
  try { parsed = JSON.parse(feedback); } catch (err) { return out({ ok: false, error: 'bad_json' }); }
  mergeFeedback_(id, parsed);   // imageRefs 등 기존 키 보존
  return out({ ok: true, id });
}

// 차트 이미지(base64 data URL)를 Drive에 업로드하고 fileId를 Feedback 시트 imageRefs에 병합.
// 표시는 PWA가 https://drive.google.com/thumbnail?id=<fileId> 로 처리(공개 링크 뷰어).
function handleSaveImage(e) {
  const id = String(e.parameter.id || '');
  const dataUrl = e.parameter.image || '';
  if (!id || !dataUrl) return out({ ok: false, error: 'missing_params' });
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return out({ ok: false, error: 'bad_image' });
  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], id + '_' + Date.now() + '.jpg');
    const file = ensureChartFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); // 썸네일 공개 표시용
    const fileId = file.getId();
    mergeFeedback_(id, { imageRefs: [fileId] });  // text/followedPlan 보존
    return out({ ok: true, id, fileId });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

const CHART_FOLDER_NAME = 'AlphaDeskJournalCharts';
function ensureChartFolder_() {
  const it = DriveApp.getFoldersByName(CHART_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CHART_FOLDER_NAME);
}

function handleLoadFeedback(e) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(FEEDBACK_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const result = {};
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '');
    const fb = data[i][1];
    const updatedAt = data[i][2];
    if (id && fb) {
      try {
        const parsed = JSON.parse(fb);
        result[id] = {
          feedback: parsed,
          updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : (updatedAt || null)
        };
      } catch (err) { /* malformed, skip */ }
    }
  }
  const payload = { success: true, data: result };
  const callback = e.parameter.callback;
  if (callback) {
    // JSONP
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(payload)})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return out(payload);
}


// =============================================================
//  v2: Position 배열 save / load  (PWA cloudUpload / cloudDownload)
//  - save: form+iframe POST (action=save, trades=JSON 문자열)
//  - load: JSONP GET   (action=load&callback=...)
//  Trades 시트에 포지션 1건 = 1행. entries/exits/indices/feedback 은 셀 내 JSON 문자열.
//  ID 기준 upsert(있으면 갱신, 없으면 추가)라 SMS가 만든 행과 충돌하지 않는다.
// =============================================================
function handleSave(e) {
  const raw = e.parameter.trades;
  if (!raw) return out({ ok: false, success: false, error: 'missing_trades' });

  let trades;
  try { trades = JSON.parse(raw); } catch (err) { return out({ ok: false, success: false, error: 'bad_json' }); }
  if (!Array.isArray(trades)) return out({ ok: false, success: false, error: 'not_array' });

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureTradesHeader(ss);
  const data = sheet.getDataRange().getValues();
  const H = headerMap(data[0]);

  // 기존 행 ID → row 인덱스(0-base, data 기준)
  const idRow = {};
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][H['ID']] || '');
    if (id) idRow[id] = i;
  }

  let created = 0, updated = 0;
  trades.forEach(t => {
    const rowArr = positionToRow(t, H, Object.keys(H).length);
    const id = String(t.id || '');
    if (id && idRow[id] !== undefined) {
      sheet.getRange(idRow[id] + 1, 1, 1, rowArr.length).setValues([rowArr]);
      updated++;
    } else {
      sheet.appendRow(rowArr);
      created++;
    }
  });

  return out({ ok: true, success: true, count: trades.length, created, updated });
}

function handleLoad(e) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  let result = [];
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    if (data.length > 1) {
      const H = headerMap(data[0]);
      for (let i = 1; i < data.length; i++) {
        if (!String(data[i][H['ID']] || '').trim()) continue;
        result.push(rowToPosition(data[i], H));
      }
    }
  }
  const payload = { success: true, data: result, lastSync: new Date().toISOString() };
  const callback = e.parameter.callback;
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(payload)})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return out(payload);
}

// 포지션 객체 → 시트 행 배열 (TRADE_COLUMNS 순서, H로 인덱싱)
function positionToRow(t, H, numCols) {
  const row = new Array(numCols).fill('');
  const set = (key, val) => { if (H[key] !== undefined) row[H[key]] = val; };

  const entries = Array.isArray(t.entries) ? t.entries : [];
  const exits   = Array.isArray(t.exits)   ? t.exits   : [];

  set('ID',        t.id || '');
  set('날짜',      t.date || '');
  set('시장',      t.market || 'KR');
  set('티커',      t.ticker || '');
  set('평균진입가', numOr(t.entryPrice, t.avgEntryPrice));
  set('평균청산가', numOr(t.exitPrice, t.avgExitPrice));
  set('손절가',    numOr(t.stopPrice, t.stopLoss));
  set('총수량',    numOr(t.quantity, t.totalEntryQty));
  set('손익',      numOr(t.pnl, t.realizedPnL));
  set('대표근거',  t.entryReason || t.reason || '');
  set('메모',      t.memo || '');
  set('매수내역',  JSON.stringify(entries));
  set('청산내역',  JSON.stringify(exits));
  // v2 신규
  set('종목명',    t.name || '');
  set('방향',      t.side || 'long');
  set('상태',      t.status || '');
  set('평균청산수량', numOr(t.totalExitQty, 0));
  set('R배수',     (t.rMultiple === null || t.rMultiple === undefined) ? '' : t.rMultiple);
  set('진입태그',  JSON.stringify(Array.isArray(t.entryTags) ? t.entryTags : []));
  set('청산근거',  t.exitReason || '');
  set('청산태그',  JSON.stringify(Array.isArray(t.exitTags) ? t.exitTags : []));
  set('진입일',    t.entryDate || '');
  set('청산일',    t.exitDate || '');
  set('지수',      JSON.stringify(t.indices || {}));
  set('피드백',    JSON.stringify(t.feedback || {}));
  set('소스',      t.source || 'manual');
  set('생성일시',  t.createdAt || '');
  set('수정일시',  new Date().toISOString());
  return row;
}

// 시트 행 → 포지션 객체 (JSON 셀 파싱). 기존 단일매수 행도 entries로 복원.
function rowToPosition(rowData, H) {
  const get = (key, dflt) => (H[key] !== undefined ? rowData[H[key]] : dflt);
  const entries = safeParse(get('매수내역', '[]'));
  const exits   = safeParse(get('청산내역', '[]'));
  const entryPrice = Number(get('평균진입가', 0)) || 0;
  const quantity   = Number(get('총수량', 0)) || 0;

  // 매수내역이 비어있는 레거시 행은 단일 진입으로 복원
  const entriesNorm = entries.length > 0
    ? entries
    : (entryPrice > 0 && quantity > 0
        ? [{ date: isoDate(get('날짜', '')), price: entryPrice, quantity: quantity, memo: get('대표근거', '') || '' }]
        : []);

  return {
    id: get('ID', ''),
    date: get('날짜', ''),
    market: get('시장', 'KR') || 'KR',
    ticker: get('티커', '') || '',
    name: get('종목명', '') || '',
    side: get('방향', 'long') || 'long',
    status: get('상태', '') || '',
    entryPrice: entryPrice,
    exitPrice: Number(get('평균청산가', 0)) || 0,
    stopPrice: Number(get('손절가', 0)) || 0,
    stopLoss: Number(get('손절가', 0)) || 0,   // 하위호환 alias
    quantity: quantity,
    totalExitQty: Number(get('평균청산수량', 0)) || 0,
    pnl: Number(get('손익', 0)) || 0,
    rMultiple: get('R배수', '') === '' ? null : (Number(get('R배수', null))),
    entries: entriesNorm,
    exits: exits,
    entryReason: get('대표근거', '') || '',
    reason: get('대표근거', '') || '',         // 하위호환 alias
    entryTags: safeParse(get('진입태그', '[]')),
    exitReason: get('청산근거', '') || '',
    exitTags: safeParse(get('청산태그', '[]')),
    entryDate: get('진입일', '') || '',
    exitDate: get('청산일', '') || '',
    indices: safeParseObj(get('지수', '{}')),
    feedback: safeParseObj(get('피드백', '{}')),
    source: get('소스', 'manual') || 'manual',
    createdAt: get('생성일시', '') || '',
    updatedAt: get('수정일시', '') || ''
  };
}

// Trades 시트가 없으면 생성, 헤더가 없거나 신규 컬럼이 빠졌으면 보강(기존 데이터 보존)
function ensureTradesHeader(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, TRADE_COLUMNS.length).setValues([TRADE_COLUMNS]);
    return sheet;
  }
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(s => String(s).trim());
  const missing = TRADE_COLUMNS.filter(c => header.indexOf(c) === -1);
  if (header.every(h => h === '')) {
    // 헤더가 통째로 비어있음
    sheet.getRange(1, 1, 1, TRADE_COLUMNS.length).setValues([TRADE_COLUMNS]);
  } else if (missing.length > 0) {
    const startCol = header.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

// (Step 3) IndexCache 시트 보장: date | indexCode | close | changePct
function ensureIndexCacheSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(INDEXCACHE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(INDEXCACHE_SHEET_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([['date', 'indexCode', 'close', 'changePct']]);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 4).setValues([['date', 'indexCode', 'close', 'changePct']]);
  }
  return sheet;
}

function numOr(a, b) {
  const na = Number(a);
  if (a !== '' && a !== null && a !== undefined && !isNaN(na)) return na;
  const nb = Number(b);
  return (b !== '' && b !== null && b !== undefined && !isNaN(nb)) ? nb : 0;
}
function safeParseObj(s) { if (!s) return {}; try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
function isoDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '');
}


// =============================================================
//  FR-5: 거래일 시장 지수 자동연동 (GAS 서버사이드, CORS 회피)
//  - 소스: Yahoo Finance chart API (단일 어댑터 fetchIndexQuote_ 로 격리)
//  - 캐시: IndexCache 시트 (date|indexCode|close|changePct), (date,code)당 1회만 외부 호출
//  - PWA: JSONP action=getIndices&market&entryDate&exitDate
// =============================================================

// 시장 → 지수 코드/심볼 매핑 (코드는 indices JSON 키, 심볼은 Yahoo 조회용)
const INDEX_MAP = {
  KR: [{ code: 'KOSPI',  symbol: '^KS11' }, { code: 'KOSDAQ', symbol: '^KQ11' }],
  US: [{ code: 'SP500',  symbol: '^GSPC' }, { code: 'NASDAQ', symbol: '^IXIC' }]
};

function handleGetIndices(e) {
  const market = (e.parameter.market || 'KR').toUpperCase();
  const entryDate = String(e.parameter.entryDate || '').slice(0, 10);
  const exitDate  = String(e.parameter.exitDate  || '').slice(0, 10);
  const codes = INDEX_MAP[market] || INDEX_MAP.KR;

  const result = { entry: {}, exit: {} };
  codes.forEach(({ code, symbol }) => {
    if (entryDate) {
      const q = getIndexCached_(entryDate, code, symbol);
      if (q) result.entry[code] = q;
    }
    if (exitDate) {
      const q = getIndexCached_(exitDate, code, symbol);
      if (q) result.exit[code] = q;
    }
  });

  const payload = { success: true, market: market, indices: result };
  const callback = e.parameter.callback;
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(payload)})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return out(payload);
}

// (date, code) 캐시 우선 조회 → 미스일 때만 외부 호출. 실패는 캐시하지 않음(재조회 가능).
function getIndexCached_(dateStr, code, symbol) {
  const sheet = ensureIndexCacheSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === dateStr && String(data[i][1]) === code) {
      const close = Number(data[i][2]);
      const changePct = data[i][3] === '' ? null : Number(data[i][3]);
      if (!isNaN(close)) return { close, changePct, code };
    }
  }
  // 캐시 미스 → 외부 호출
  const q = fetchIndexQuote_(symbol, dateStr);
  if (!q) return null;                     // 실패: 캐시 안 함
  sheet.appendRow([dateStr, code, q.close, (q.changePct === null ? '' : q.changePct)]);
  return { close: q.close, changePct: q.changePct, code };
}

// ===== 소스 어댑터 (교체 지점) =====================================
// Yahoo Finance chart API. 반환: {close, changePct} (대상일의 종가+전일대비%),
// 휴장일이면 대상일 이전 최근 거래일 종가 사용. 실패 시 null.
function fetchIndexQuote_(symbol, dateStr) {
  try {
    const target = new Date(dateStr + 'T12:00:00Z').getTime();
    const p1 = Math.floor(target / 1000) - 10 * 86400;   // 대상일 -10일
    const p2 = Math.floor(target / 1000) + 2 * 86400;    // 대상일 +2일
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
      + encodeURIComponent(symbol)
      + '?period1=' + p1 + '&period2=' + p2 + '&interval=1d';

    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlphaDeskJournal/1.0)' }
    });
    if (res.getResponseCode() !== 200) return null;

    const json = JSON.parse(res.getContentText());
    const r = json && json.chart && json.chart.result && json.chart.result[0];
    if (!r || !r.timestamp || !r.indicators || !r.indicators.quote) return null;

    const tz = (r.meta && r.meta.exchangeTimezoneName) || TZ;  // 종가 시각을 거래소 TZ로 해석
    const ts = r.timestamp;
    const closes = r.indicators.quote[0].close || [];

    // 거래일 시계열 {date, close} (null 종가 제외)
    const series = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c === null || c === undefined) continue;
      series.push({ date: Utilities.formatDate(new Date(ts[i] * 1000), tz, 'yyyy-MM-dd'), close: c });
    }
    if (series.length === 0) return null;

    // 대상일 이하의 마지막 거래일 인덱스
    let idx = -1;
    for (let i = 0; i < series.length; i++) {
      if (series[i].date <= dateStr) idx = i; else break;
    }
    if (idx === -1) idx = 0;  // 대상일이 시계열 시작보다 이르면 첫 거래일

    const close = series[idx].close;
    let prevClose = (idx > 0) ? series[idx - 1].close
      : (r.meta && r.meta.chartPreviousClose) || null;
    const changePct = (prevClose && prevClose !== 0)
      ? round2((close - prevClose) / prevClose * 100) : null;

    return { close: round2(close), changePct };
  } catch (err) {
    Logger.log('fetchIndexQuote_ error ' + symbol + ' ' + dateStr + ': ' + err);
    return null;
  }
}


// ---------- SMS Parsing (KR + US router) ----------
function parseFill(sms, receivedAt) {
  if (!sms) return null;
  // 해외주식 체결집계 형식 우선 매칭 (헤더에 '해외주식' 또는 '체결집계' 포함)
  if (/\[NH투자증권\].*해외주식|체결집계/.test(sms)) {
    return parseFillUS(sms, receivedAt);
  }
  // 국내 형식
  if (sms.includes('[NH투자]')) {
    return parseFillKR(sms, receivedAt);
  }
  return null;
}

function parseFillKR(sms, receivedAt) {
  const hdr = sms.match(/\[NH투자\]\s*(매수|매도)\s*(전량체결|부분체결)/);
  if (!hdr) return null;

  const side = hdr[1], fillType = hdr[2];
  const lines = sms.split('\n').map(l => l.trim()).filter(l => l);

  let symbol = null, qty = null, price = null, orderNo = null;
  for (const line of lines) {
    if (line === '[Web발신]' || line.startsWith('[NH투자]')) continue;
    let m;
    if      ((m = line.match(/^([\d,]+)\s*주$/)))  qty = parseInt(m[1].replace(/,/g, ''), 10);
    else if ((m = line.match(/^([\d,]+)\s*원$/)))  price = parseInt(m[1].replace(/,/g, ''), 10);
    else if ((m = line.match(/^주문\s*(\d+)$/)))   orderNo = m[1];
    else if (symbol === null)                       symbol = line;
  }
  if (!symbol || qty === null || price === null) return null;
  return { market: 'KR', side, fillType, symbol, qty, price, orderNo, filledAt: receivedAt };
}

function parseFillUS(sms, receivedAt) {
  // key : value 줄들 파싱
  const lines = sms.split('\n').map(l => l.trim()).filter(l => l);
  const kv = {};
  for (const line of lines) {
    const m = line.match(/^([^:]+?)\s*:\s*(.+)$/);
    if (m) kv[m[1].trim()] = m[2].trim();
  }

  const sideRaw = kv['매매구분'];
  const country = kv['거래국가'];
  const symbolRaw = kv['종목명'];
  const qtyRaw = kv['체결수량'] || kv['주문수량'];
  const priceRaw = kv['체결가격'];
  const dateRaw = kv['주문일자']; // '05월12일'

  if (country !== '미국') return null; // 일단 미국만 지원
  if (sideRaw !== '매수' && sideRaw !== '매도') return null;

  // 티커 추출: (CCUP US)... 또는 (AAPL US)...
  let symbol = null;
  const tickerMatch = symbolRaw && symbolRaw.match(/^\(([A-Z0-9.]+)\s+US\)/);
  if (tickerMatch) symbol = tickerMatch[1];
  if (!symbol) return null;

  const qty = qtyRaw ? parseInt(qtyRaw.replace(/[,주\s]/g, ''), 10) : NaN;
  const price = priceRaw ? parseFloat(priceRaw.replace(/,/g, '')) : NaN;
  if (!qty || !price || isNaN(qty) || isNaN(price)) return null;

  // 주문일자 파싱: '05월12일' → 현재 연도 사용
  let filledAt = receivedAt;
  const dateMatch = dateRaw && dateRaw.match(/(\d+)월\s*(\d+)일/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1]) - 1;
    const day = parseInt(dateMatch[2]);
    let year = receivedAt.getFullYear();
    // 12월 거래를 1월 초에 받는 경우 보정
    if (month === 11 && receivedAt.getMonth() === 0) year -= 1;
    filledAt = new Date(year, month, day,
      receivedAt.getHours(), receivedAt.getMinutes(), receivedAt.getSeconds());
  }

  return { market: 'US', side: sideRaw, symbol, qty, price, orderNo: null, filledAt };
}


// ---------- Sheet ops ----------
function applyFill(sheet, fill) {
  const data = sheet.getDataRange().getValues();
  const H = headerMap(data[0]);
  const market = fill.market || 'KR';
  const openIdx = findOpenPosition(data, H, fill.symbol, market);

  if (fill.side === '매수') {
    if (openIdx >= 0) {
      addBuyToRow(sheet, openIdx + 1, H, fill, data[openIdx]);
      return { action: 'append_buy', row: openIdx + 1 };
    }
    const row = createNewPositionRow(sheet, H, fill);
    return { action: 'new_position', row };
  } else { // 매도
    if (openIdx >= 0) {
      addSellToRow(sheet, openIdx + 1, H, fill, data[openIdx]);
      return { action: 'append_sell', row: openIdx + 1 };
    }
    flagOrphanSell(fill);
    return { action: 'orphan_sell', symbol: fill.symbol };
  }
}

function findOpenPosition(data, H, ticker, market) {
  const closedIds = getClosedTradeIds(); // ⭐ 피드백 입력된 거래 ID set
  for (let i = 1; i < data.length; i++) {  // 위→아래 (최신 우선)
    if (data[i][H['시장']] !== market) continue;
    if (data[i][H['티커']] !== ticker) continue;

    // ⭐ 피드백 있는 행은 종료된 거래로 간주, 스킵
    if (closedIds.has(String(data[i][H['ID']]))) continue;

    const buys  = safeParse(data[i][H['매수내역']]);
    const sells = safeParse(data[i][H['청산내역']]);
    if (sumQty(buys) > sumQty(sells)) return i;
  }
  return -1;
}

// Feedback 시트에서 피드백 입력된 ID 목록을 한 번만 읽어 캐시
let _closedIdsCache = null;
function getClosedTradeIds() {
  if (_closedIdsCache !== null) return _closedIdsCache;
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(FEEDBACK_SHEET_NAME);
    if (!sheet) { _closedIdsCache = new Set(); return _closedIdsCache; }
    const data = sheet.getDataRange().getValues();
    const ids = new Set();
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][0] || '');
      const fb = data[i][1];
      if (id && fb && String(fb).trim() !== '' && fb !== '{}') ids.add(id);
    }
    _closedIdsCache = ids;
  } catch (e) {
    _closedIdsCache = new Set();
  }
  return _closedIdsCache;
}

function addBuyToRow(sheet, rowNum, H, fill, row) {
  const buys = safeParse(row[H['매수내역']]);
  buys.push(toFillObj(fill));
  const totalQty = sumQty(buys);
  const avgPrice = buys.reduce((s, b) => s + b.quantity * b.price, 0) / totalQty;

  sheet.getRange(rowNum, H['매수내역'] + 1).setValue(JSON.stringify(buys));
  sheet.getRange(rowNum, H['총수량']   + 1).setValue(totalQty);
  sheet.getRange(rowNum, H['평균진입가'] + 1).setValue(round2(avgPrice));
  setIfPresent(sheet, rowNum, H, '상태', 'open');        // 추가매수=아직 보유
  setIfPresent(sheet, rowNum, H, '수정일시', new Date().toISOString());
}

function addSellToRow(sheet, rowNum, H, fill, row) {
  const sells = safeParse(row[H['청산내역']]);
  sells.push(toFillObj(fill));
  const totalExitQty = sumQty(sells);
  const avgPrice = sells.reduce((s, b) => s + b.quantity * b.price, 0) / totalExitQty;
  const totalEntryQty = sumQty(safeParse(row[H['매수내역']]));

  sheet.getRange(rowNum, H['청산내역'] + 1).setValue(JSON.stringify(sells));
  sheet.getRange(rowNum, H['평균청산가'] + 1).setValue(round2(avgPrice));
  setIfPresent(sheet, rowNum, H, '평균청산수량', totalExitQty);
  // 남은 수량 0 이하 → closed (PRD: 부분청산은 open 유지)
  setIfPresent(sheet, rowNum, H, '상태', totalExitQty >= totalEntryQty ? 'closed' : 'open');
  setIfPresent(sheet, rowNum, H, '청산일', Utilities.formatDate(fill.filledAt, TZ, 'yyyy-MM-dd'));
  setIfPresent(sheet, rowNum, H, '수정일시', new Date().toISOString());
  // 손익(realizedPnL)은 PWA가 sign 규칙으로 계산
}

// 신규 컬럼이 시트에 아직 없을 수도 있으므로 존재할 때만 기록
function setIfPresent(sheet, rowNum, H, key, val) {
  if (H[key] !== undefined) sheet.getRange(rowNum, H[key] + 1).setValue(val);
}

function createNewPositionRow(sheet, H, fill) {
  const numCols = Object.keys(H).length;
  const newRow = new Array(numCols).fill('');
  const nowIso = new Date().toISOString();
  const set = (key, val) => { if (H[key] !== undefined) newRow[H[key]] = val; };

  set('ID',        Date.now());
  set('날짜',      Utilities.formatDate(fill.filledAt, TZ, 'yyyy. M. d.'));
  set('시장',      fill.market || 'KR');
  set('티커',      fill.symbol);
  set('평균진입가', fill.price);
  set('평균청산가', 0);
  set('손절가',    '');
  set('총수량',    fill.qty);
  set('손익',      0);
  set('대표근거',  '');
  set('메모',      '');
  set('매수내역',  JSON.stringify([toFillObj(fill)]));
  set('청산내역',  '[]');
  // v2 신규: 포지션 스키마 메타데이터
  set('종목명',    fill.symbol);
  set('방향',      'long');                              // SMS는 일반 매수=롱 (인버스/숏은 수기 보정)
  set('상태',      'open');
  set('평균청산수량', 0);
  set('R배수',     '');
  set('진입태그',  '[]');
  set('청산근거',  '');
  set('청산태그',  '[]');
  set('진입일',    Utilities.formatDate(fill.filledAt, TZ, 'yyyy-MM-dd'));
  set('청산일',    '');
  set('지수',      '{}');
  set('피드백',    '{}');
  set('소스',      fill.market === 'US' ? 'sms-us' : 'sms-kr');
  set('생성일시',  nowIso);
  set('수정일시',  nowIso);

  sheet.insertRowBefore(2);                              // 헤더 바로 아래 삽입
  sheet.getRange(2, 1, 1, numCols).setValues([newRow]);
  return 2;
}

function flagOrphanSell(fill) {
  Logger.log('⚠️ orphan sell: ' + JSON.stringify(fill));
  // 필요 시 GmailApp.sendEmail로 알림 추가
}


// ---------- Helpers ----------
function headerMap(row) {
  const m = {};
  row.forEach((name, i) => { m[String(name).trim()] = i; });
  return m;
}
function safeParse(s)  { if (!s) return []; try { return JSON.parse(s); } catch (e) { return []; } }
function sumQty(arr)   { return arr.reduce((s, f) => s + (Number(f.quantity) || 0), 0); }
function round2(n)     { return Math.round(n * 100) / 100; }
function out(obj)      { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function toFillObj(fill) {
  return {
    date: Utilities.formatDate(fill.filledAt, TZ, 'yyyy-MM-dd'),
    price: fill.price,
    quantity: fill.qty,
    memo: ''
  };
}


// ---------- Dedup (Script Properties) ----------
function getDedupKey(fill) {
  if (fill.orderNo) {
    // 국내: 주문번호 기반
    return `fill:KR:${fill.orderNo}:${fill.qty}:${fill.price}`;
  }
  // 해외: 주문번호 없음 → 날짜+티커+매매구분+수량+가격 조합
  const dateStr = Utilities.formatDate(fill.filledAt, TZ, 'yyyy-MM-dd');
  return `fill:${fill.market || 'XX'}:${dateStr}:${fill.symbol}:${fill.side}:${fill.qty}:${fill.price}`;
}
function isDuplicate(fill) {
  return PropertiesService.getScriptProperties().getProperty(getDedupKey(fill)) !== null;
}
function markProcessed(fill) {
  PropertiesService.getScriptProperties().setProperty(getDedupKey(fill), String(Date.now()));
}


// =============================================================
//  v2 마이그레이션: 기존 단일매수 행 → 포지션 스키마(entries 배열)
//  - 멱등(idempotent): 이미 변환된 행('소스' 채워짐)은 건너뜀 → 여러 번 실행해도 안전
//  - 백업: 실행 시점에 Trades 시트를 'Trades_backup_<타임스탬프>'로 1회 복제
//  - 검증: 변환 전/후 총수량·손익(롱 기준)이 일치하는지 로그로 확인
//  수동 1회 실행용. Apps Script 편집기에서 migrateToPositionSchema() 실행.
// =============================================================
function migrateToPositionSchema() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureTradesHeader(ss);              // 헤더(신규 컬럼) 먼저 보강
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('no rows to migrate'); return { migrated: 0, skipped: 0 }; }

  // 1) 백업 (변환 전 1회)
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss');
  sheet.copyTo(ss).setName(`${SHEET_NAME}_backup_${stamp}`);

  const H = headerMap(data[0]);
  let migrated = 0, skipped = 0, mismatch = 0;

  for (let i = 1; i < data.length; i++) {
    const rowNum = i + 1;
    const row = data[i];
    if (!String(row[H['ID']] || '').trim()) continue;

    // 멱등 가드: '소스'가 이미 채워진 행은 변환 완료로 간주하고 스킵
    if (H['소스'] !== undefined && String(row[H['소스']] || '').trim() !== '') { skipped++; continue; }

    // 변환 전 값(검증용)
    const beforeQty = Number(row[H['총수량']]) || 0;
    const beforePnl = Number(row[H['손익']]) || 0;

    // entries 복원: 매수내역이 있으면 그대로, 없으면 평균진입가/총수량으로 단일 진입 생성
    let entries = safeParse(row[H['매수내역']]);
    const entryPrice = Number(row[H['평균진입가']]) || 0;
    if (entries.length === 0 && entryPrice > 0 && beforeQty > 0) {
      entries = [{ date: isoDate(row[H['날짜']]), price: entryPrice, quantity: beforeQty, memo: row[H['대표근거']] || '' }];
    }
    const exits = safeParse(row[H['청산내역']]);

    const totalEntryQty = sumQty(entries);
    const totalExitQty  = sumQty(exits);
    const avgEntry = totalEntryQty > 0
      ? entries.reduce((s, b) => s + (Number(b.price) || 0) * (Number(b.quantity) || 0), 0) / totalEntryQty
      : entryPrice;
    // 롱 기준 재계산(기존 데이터는 모두 롱). 부호 규칙은 PWA positionMetrics와 동일.
    const recomputedPnl = exits.reduce((s, x) => s + ((Number(x.price) || 0) - avgEntry) * (Number(x.quantity) || 0), 0);
    const status = (totalExitQty > 0 && totalExitQty >= totalEntryQty) ? 'closed' : 'open';

    // 검증: 총수량/손익이 변환 전과 일치하는지 (반올림 허용)
    if (Math.abs(beforeQty - totalEntryQty) > 0.0001 || Math.abs(beforePnl - round2(recomputedPnl)) > 1) {
      mismatch++;
      Logger.log(`⚠️ mismatch row ${rowNum} id=${row[H['ID']]}: qty ${beforeQty}→${totalEntryQty}, pnl ${beforePnl}→${round2(recomputedPnl)}`);
    }

    const nowIso = new Date().toISOString();
    const lastExitDate = exits.length > 0 ? (exits[exits.length - 1].date || '') : '';
    const writes = {
      '매수내역': JSON.stringify(entries),
      '청산내역': JSON.stringify(exits),
      '총수량': totalEntryQty,
      '평균진입가': round2(avgEntry),
      '종목명': row[H['티커']] || '',
      '방향': 'long',
      '상태': status,
      '평균청산수량': totalExitQty,
      '진입태그': '[]',
      '청산태그': '[]',
      '진입일': entries.length > 0 ? (entries[0].date || isoDate(row[H['날짜']])) : isoDate(row[H['날짜']]),
      '청산일': lastExitDate,
      '지수': '{}',
      '피드백': '{}',
      '소스': 'manual',           // ← 멱등 마커. 비어있던 행만 여기서 채워짐
      '생성일시': nowIso,
      '수정일시': nowIso
    };
    Object.keys(writes).forEach(k => setIfPresent(sheet, rowNum, H, k, writes[k]));
    migrated++;
  }

  const summary = { migrated, skipped, mismatch, backup: `${SHEET_NAME}_backup_${stamp}` };
  Logger.log('migrateToPositionSchema: ' + JSON.stringify(summary));
  return summary;
}


// ---------- Manual utilities ----------
function clearDedupCache() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  Logger.log('Cleared dedup cache');
}

function testSell() {
  const sample =
    `[Web발신]
[NH투자] 매도 전량체결
삼성전자    
1주
266,500원
주문 0000647706`;
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const fill = parseFill(sample, new Date());
  Logger.log(JSON.stringify(fill, null, 2));
  Logger.log(JSON.stringify(applyFill(sheet, fill), null, 2));
}

function testUS() {
  const sample =
    `[Web발신]
[NH투자증권] 해외주식 체결집계 내역 안내 
주문일자 : 05월12일 
계좌명   : 박*연 
매매구분 : 매도 
거래국가 : 미국 
종목명   : (CCUP US)T-REX 2X LONG CRCL DAILY TARGET ETF 
주문수량 : 1,000주 
체결수량 : 1,000주 
거래통화 : USD 
체결가격 : 7.700`;
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const fill = parseFill(sample, new Date());
  Logger.log(JSON.stringify(fill, null, 2));
  Logger.log(JSON.stringify(applyFill(sheet, fill), null, 2));
}