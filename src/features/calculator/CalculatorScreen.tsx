import { useEffect, useMemo, useState } from 'react'
import { formatMoney, formatPct, formatPrice, parseAmount, type Currency } from '../../core/format'
import { PYRAMID_PRESETS, splitStages } from '../../core/pyramid'
import { openRiskPct, type Bar } from '../../core/risk'
import { DEFAULT_MAX_POSITION_PCT, sizePosition, type Direction, type SizingError } from '../../core/sizing'
import { adrPct, atrStop, dayExtremeStop, swingStop } from '../../core/stops'
import { BackendError } from '../../data/backend'
import { useData } from '../../data/dataStore'
import { cachedBars, openRiskItems } from '../../data/queries'
import { readSetting, SETTING_KEYS, writeSetting } from '../../data/settings'
import type { Market } from '../../data/types'
import { hrefFor } from '../../ui/routes'

type QuoteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; name: string | null; price: number | null; asOf: string | null; bars: Bar[]; note?: string }
  | { kind: 'error'; message: string }

interface HistoryItem {
  at: string
  market: Market
  symbol: string
  direction: Direction
  account: number
  rptPct: number
  entry: number
  stop: number
  qty: number
}

const META_HISTORY = 'calcHistory'
const HISTORY_MAX = 20
const NO_BARS: Bar[] = []
const nowIso = () => new Date().toISOString()

const SIZING_ERROR: Record<SizingError, string> = {
  not_positive: '계좌·RPT·진입가·손절가를 모두 0보다 큰 숫자로 넣으세요.',
  stop_equals_entry: '손절가가 진입가와 같습니다.',
  stop_wrong_side: '손절가가 진입가의 반대편에 있어야 합니다 (롱은 아래, 숏은 위).',
}

const QUOTE_ERROR: Record<string, string> = {
  not_setup: '설정에서 백엔드를 연결해야 가격을 불러올 수 있습니다. 진입가는 직접 넣어도 됩니다.',
  quote_not_found: '시세를 찾지 못했습니다. KR은 6자리 종목코드로 입력하세요.',
  quote_failed: '시세 서버가 응답하지 않습니다. 진입가를 직접 넣으세요.',
  network: '네트워크에 연결할 수 없습니다. 진입가를 직접 넣으세요.',
}

export function CalculatorScreen() {
  const { repo, getQuote, version } = useData()
  const [market, setMarket] = useState<Market>('KR')
  const [symbol, setSymbol] = useState('')
  const [direction, setDirection] = useState<Direction>('long')
  const [accountText, setAccountText] = useState('')
  const [rptText, setRptText] = useState('1.25')
  const [entryText, setEntryText] = useState('')
  const [stopText, setStopText] = useState('')
  const [atrMult, setAtrMult] = useState('1.5')
  const [weightsKey, setWeightsKey] = useState('50/30/20')
  const [useCapped, setUseCapped] = useState(true)
  const [quote, setQuote] = useState<QuoteState>({ kind: 'idle' })
  const [limits, setLimits] = useState({ maxPositionPct: DEFAULT_MAX_POSITION_PCT, maxOpenRiskPct: 6 })
  const [accounts, setAccounts] = useState<Record<Market, number>>({ KR: 0, US: 0 })
  const [openRisk, setOpenRisk] = useState({ pct: 0, withoutStop: 0 })
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [sent, setSent] = useState<string | null>(null)

  const currency: Currency = market === 'KR' ? 'KRW' : 'USD'

  // Settings that seed the form. Account size follows the selected market.
  useEffect(() => {
    if (!repo) return
    let alive = true
    void (async () => {
      const [kr, us, rpt, maxPos, maxOpen, hist] = await Promise.all([
        readSetting<number | null>(repo, SETTING_KEYS.accountSize('KR'), null),
        readSetting<number | null>(repo, SETTING_KEYS.accountSize('US'), null),
        readSetting<number>(repo, SETTING_KEYS.defaultRptPct, 1.25),
        readSetting<number>(repo, SETTING_KEYS.maxPositionPct, DEFAULT_MAX_POSITION_PCT),
        readSetting<number>(repo, SETTING_KEYS.maxOpenRiskPct, 6),
        repo.getMeta<HistoryItem[]>(META_HISTORY),
      ])
      if (!alive) return
      setAccounts({ KR: kr ?? 0, US: us ?? 0 })
      setRptText((t) => (t === '1.25' ? String(rpt) : t))
      setLimits({ maxPositionPct: maxPos, maxOpenRiskPct: maxOpen })
      setHistory(hist ?? [])
    })()
    return () => {
      alive = false
    }
  }, [repo])

  // Open risk across current positions (re-read when data changes).
  useEffect(() => {
    if (!repo) return
    let alive = true
    void openRiskItems(repo, accounts).then((items) => alive && setOpenRisk(openRiskPct(items)))
    return () => {
      alive = false
    }
  }, [repo, version, accounts])

  const account = accountText === '' ? accounts[market] : parseAmount(accountText)
  const rptPct = parseAmount(rptText)
  const entry = parseAmount(entryText)
  const stop = parseAmount(stopText)
  const weights = PYRAMID_PRESETS[weightsKey]
  const bars = quote.kind === 'ok' ? quote.bars : NO_BARS
  const adr = useMemo(() => adrPct(bars), [bars])

  const outcome = useMemo(
    () => sizePosition({ direction, account, rptPct, entry, stop, maxPositionPct: limits.maxPositionPct }),
    [direction, account, rptPct, entry, stop, limits.maxPositionPct],
  )
  const filled = [account, rptPct, entry, stop].every((n) => Number.isFinite(n) && n !== 0)
  const result = outcome.ok ? outcome.result : null
  const chosen = result ? (result.capped && useCapped ? { ...result, ...result.capped } : result) : null
  const stages = chosen ? splitStages(chosen.qty, weights) : []
  const totalOpenRisk = openRisk.pct + (chosen?.accountRiskPct ?? 0)

  function switchMarket(m: Market) {
    if (m === market) return
    setMarket(m)
    setAccountText('')
    setQuote({ kind: 'idle' })
    setEntryText('')
    setStopText('')
  }

  async function loadQuote() {
    const sym = symbol.trim()
    if (!sym) return
    setQuote({ kind: 'loading' })
    try {
      const q = await getQuote(sym, market)
      setQuote({ kind: 'ok', name: q.name, price: q.price, asOf: q.asOf, bars: q.bars })
      if (q.price) setEntryText(formatPrice(q.price, currency))
    } catch (err) {
      // Offline or no backend: fall back to bars already synced to this device.
      const local = repo ? await cachedBars(repo, `${market}:${sym.toUpperCase()}`) : []
      const last = local.at(-1)
      if (last?.close) {
        setQuote({ kind: 'ok', name: null, price: last.close, asOf: last.date, bars: local, note: '연결이 안 돼서 이 기기에 저장된 마지막 시세를 썼습니다.' })
        setEntryText(formatPrice(last.close, currency))
        return
      }
      const code = err instanceof BackendError ? err.code : 'internal'
      setQuote({ kind: 'error', message: QUOTE_ERROR[code] ?? (err as Error).message })
    }
  }

  function applyStop(value: number | null) {
    if (value !== null && Number.isFinite(value)) setStopText(formatPrice(value, currency))
  }

  async function saveAccount() {
    if (!repo || accountText === '') return
    const v = parseAmount(accountText)
    if (!(v > 0) || v === accounts[market]) return
    await writeSetting(repo, SETTING_KEYS.accountSize(market), v)
    setAccounts((a) => ({ ...a, [market]: v }))
  }

  async function sendToTrade() {
    if (!repo || !result || !chosen || chosen.qty <= 0) return
    const ticker = symbol.trim().toUpperCase()
    const at = nowIso()
    const position = await repo.put('Positions', {
      ticker: ticker || '(미정)',
      ticker_name: quote.kind === 'ok' ? quote.name : null,
      market,
      direction,
      status: 'planned',
      original_stop: stop,
      no_plan: false,
    })
    await repo.put('Plans', {
      position_id: position.id,
      plan_entry: entry,
      plan_stop: stop,
      plan_qty: chosen.qty,
      rpt_pct: rptPct,
      risk_amount: chosen.riskAmount,
      pyramid_plan: { preset: weightsKey, weights, stages },
      calc_snapshot: {
        at,
        input: { market, symbol: ticker, direction, account, rptPct, entry, stop, maxPositionPct: limits.maxPositionPct },
        result,
        usedCapped: !!(result.capped && useCapped),
        quote: quote.kind === 'ok' ? { price: quote.price, asOf: quote.asOf } : null,
      },
    })
    const item: HistoryItem = { at, market, symbol: ticker, direction, account, rptPct, entry, stop, qty: chosen.qty }
    const next = [item, ...history].slice(0, HISTORY_MAX)
    setHistory(next)
    await repo.setMeta(META_HISTORY, next)
    setSent(`${ticker || '종목 미정'} ${chosen.qty.toLocaleString()}주 계획을 트레이드에 저장했습니다.`)
  }

  function recall(h: HistoryItem) {
    setMarket(h.market)
    setSymbol(h.symbol)
    setDirection(h.direction)
    setAccountText(String(h.account))
    setRptText(String(h.rptPct))
    const cur: Currency = h.market === 'KR' ? 'KRW' : 'USD'
    setEntryText(formatPrice(h.entry, cur))
    setStopText(formatPrice(h.stop, cur))
    setQuote({ kind: 'idle' })
    setSent(null)
  }

  const money = (n: number) => formatMoney(n, currency, false)

  return (
    <>
      <h1 className="page-title">사이징 계산기</h1>
      <div className="calc-grid">
        <section className="card stack" aria-label="입력">
          <div className="row wrap">
            <div className="seg" role="group" aria-label="마켓">
              {(['KR', 'US'] as Market[]).map((m) => (
                <button key={m} type="button" aria-pressed={market === m} onClick={() => switchMarket(m)}>
                  {m}
                </button>
              ))}
            </div>
            <div className="seg push-right" role="group" aria-label="방향">
              <button type="button" aria-pressed={direction === 'long'} onClick={() => setDirection('long')}>
                롱
              </button>
              <button type="button" aria-pressed={direction === 'short'} onClick={() => setDirection('short')}>
                숏
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="calc-symbol">
              심볼 {market === 'KR' ? '(6자리 종목코드)' : '(티커)'}
            </label>
            <div className="input-group">
              <input
                id="calc-symbol"
                className="input num"
                value={symbol}
                placeholder={market === 'KR' ? '042700' : 'CRDO'}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setSymbol(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadQuote()}
              />
              <button type="button" className="btn btn-secondary" onClick={() => void loadQuote()} disabled={!symbol.trim() || quote.kind === 'loading'}>
                {quote.kind === 'loading' ? '불러오는 중…' : '가격 불러오기'}
              </button>
            </div>
            {quote.kind === 'ok' && (
              <span className="help">
                {quote.name ?? symbol.toUpperCase()} · <span className="num">{quote.price !== null ? formatPrice(quote.price, currency) : '—'}</span> · {quote.asOf} 일봉
                {adr !== null && <> · ADR {formatPct(adr, 1)}</>}
                {quote.note && <> · {quote.note}</>}
              </span>
            )}
            {quote.kind === 'error' && <span className="field-error">{quote.message}</span>}
          </div>

          <div className="field-pair">
            <label className="field">
              <span className="field-label">계좌 규모 ({currency})</span>
              <input
                className="input num"
                inputMode="decimal"
                value={accountText === '' && accounts[market] ? formatPrice(accounts[market], currency) : accountText}
                placeholder={currency === 'KRW' ? '30,000,000' : '20,000'}
                onChange={(e) => setAccountText(e.target.value)}
                onBlur={() => void saveAccount()}
              />
            </label>
            <label className="field">
              <span className="field-label">RPT %</span>
              <input className="input num" inputMode="decimal" value={rptText} onChange={(e) => setRptText(e.target.value)} />
            </label>
          </div>
          <div className="row wrap" role="group" aria-label="RPT 프리셋">
            {['0.5', '1.25', '2.5'].map((p) => (
              <button key={p} type="button" className="pill" aria-pressed={rptText === p} onClick={() => setRptText(p)}>
                {p}%
              </button>
            ))}
          </div>

          <div className="field-pair">
            <label className="field">
              <span className="field-label">진입가</span>
              <input className="input num" inputMode="decimal" value={entryText} onChange={(e) => setEntryText(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">손절가</span>
              <input className="input num" inputMode="decimal" value={stopText} onChange={(e) => setStopText(e.target.value)} />
            </label>
          </div>
          <div className="row wrap" role="group" aria-label="손절가 보조">
            <span className="atr-mult">
              <button type="button" className="pill pill-dashed" disabled={!bars.length || !(entry > 0)} onClick={() => applyStop(atrStop(direction, entry, bars, parseAmount(atrMult)))}>
                ATR ×
              </button>
              <input className="input num mini" inputMode="decimal" aria-label="ATR 배수" value={atrMult} onChange={(e) => setAtrMult(e.target.value)} />
            </span>
            <button type="button" className="pill pill-dashed" disabled={!bars.length} onClick={() => applyStop(dayExtremeStop(direction, bars))}>
              {direction === 'long' ? '당일 저가' : '당일 고가'}
            </button>
            <button type="button" className="pill pill-dashed" disabled={!bars.length} onClick={() => applyStop(swingStop(direction, bars))}>
              {direction === 'long' ? '스윙 저점' : '스윙 고점'}
            </button>
          </div>
          {!bars.length && <p className="help">손절 보조 버튼은 가격을 불러오면 켜집니다.</p>}

          <label className="field">
            <span className="field-label">피라미딩 계획</span>
            <select className="input" value={weightsKey} onChange={(e) => setWeightsKey(e.target.value)}>
              {Object.keys(PYRAMID_PRESETS).map((k) => (
                <option key={k} value={k}>
                  {k === '100' ? '한 번에 (100%)' : `${k.split('/').length}단계 ${k}`}
                </option>
              ))}
            </select>
          </label>
        </section>

        <div className="stack">
          <section className="card stack result-card" aria-label="결과" aria-live="polite">
            {!filled ? (
              <p className="empty" style={{ margin: 0 }}>
                계좌 규모, RPT, 진입가, 손절가를 넣으면 수량이 계산됩니다.
              </p>
            ) : !outcome.ok ? (
              <p className="notice notice-bad">{SIZING_ERROR[outcome.error]}</p>
            ) : (
              chosen && (
                <>
                  <div className="result-head">
                    <div>
                      <div className="field-label">수량</div>
                      <div className="big-num num">{chosen.qty.toLocaleString()}주</div>
                    </div>
                    <div>
                      <div className="field-label">리스크 금액</div>
                      <div className="mid-num num">{money(chosen.riskAmount)}</div>
                    </div>
                  </div>
                  <dl className="metric-grid">
                    <div>
                      <dt>스탑 폭</dt>
                      <dd className="num">{formatPct(result!.stopPct)}</dd>
                    </div>
                    <div>
                      <dt>포지션 비중</dt>
                      <dd className={`num ${result!.capped ? 'warn-text' : ''}`}>{formatPct(result!.positionPct, 1)}</dd>
                    </div>
                    <div>
                      <dt>계좌 리스크</dt>
                      <dd className="num">{formatPct(chosen.accountRiskPct)}</dd>
                    </div>
                    <div>
                      <dt>포지션 사이즈</dt>
                      <dd className="num">{money(chosen.positionSize)}</dd>
                    </div>
                    <div>
                      <dt>{stages.length > 1 ? `피라미딩 (${stages.map((_, i) => i + 1).join('·')}차)` : '피라미딩'}</dt>
                      <dd className="num">{stages.length > 1 ? stages.join(' / ') : '한 번에'}</dd>
                    </div>
                    <div>
                      <dt>오픈 리스크 (이 진입 포함)</dt>
                      <dd className={`num ${totalOpenRisk > limits.maxOpenRiskPct ? 'warn-text' : ''}`}>{formatPct(totalOpenRisk, 1)}</dd>
                    </div>
                  </dl>

                  {result!.capped && (
                    <div className="warn">
                      <p style={{ margin: 0 }}>
                        포지션 비중 상한 {result!.capped.maxPositionPct}% 초과. 상한 적용 시 <b className="num">{result!.capped.qty.toLocaleString()}주</b> (실제 RPT {formatPct(result!.capped.accountRiskPct)})
                      </p>
                      <label className="row" style={{ marginTop: 8 }}>
                        <input type="checkbox" checked={useCapped} onChange={(e) => setUseCapped(e.target.checked)} />
                        상한 적용 수량 사용
                      </label>
                    </div>
                  )}
                  {adr !== null && result!.stopPct < adr && (
                    <p className="warn">
                      스탑 폭 {formatPct(result!.stopPct, 1)}이 ADR {formatPct(adr, 1)}보다 좁습니다. 일상적인 흔들림에 손절될 수 있습니다.
                    </p>
                  )}
                  {totalOpenRisk > limits.maxOpenRiskPct && (
                    <p className="warn">
                      진입하면 열린 포지션 전체 리스크가 {formatPct(totalOpenRisk, 1)}로 상한 {limits.maxOpenRiskPct}%를 넘습니다.
                    </p>
                  )}
                  {openRisk.withoutStop > 0 && <p className="help">손절가가 없는 보유 포지션 {openRisk.withoutStop}개는 오픈 리스크에 포함되지 않았습니다.</p>}
                  {chosen.qty === 0 && <p className="warn">1주 리스크가 RPT 예산보다 큽니다. 손절을 좁히거나 RPT를 높이세요.</p>}

                  <button type="button" className="btn btn-primary btn-block" onClick={() => void sendToTrade()} disabled={chosen.qty <= 0}>
                    트레이드로 보내기
                  </button>
                </>
              )
            )}
            {sent && (
              <p className="notice notice-good" role="status">
                {sent} <a href={hrefFor('trades')}>트레이드 보기</a>
              </p>
            )}
          </section>

          {/* Phone: keep the answer in view while editing inputs above. */}
          {filled && chosen && (
            <div className="calc-sticky" aria-hidden="true">
              <span>
                <span className="faint">수량</span> <b className="num">{chosen.qty.toLocaleString()}주</b>
              </span>
              <span>
                <span className="faint">리스크</span> <b className="num">{money(chosen.riskAmount)}</b>
              </span>
              {result?.capped && useCapped && <span className="chip">상한 적용</span>}
            </div>
          )}

          {history.length > 0 && (
            <section className="card stack" aria-labelledby="calc-history">
              <h2 id="calc-history" className="section-title">
                최근 계산
              </h2>
              <ul className="log">
                {history.map((h) => (
                  <li key={h.at}>
                    <span className="chip">{h.market}</span>
                    <b>{h.symbol || '종목 미정'}</b>
                    <span className="num faint">
                      {formatPrice(h.entry, h.market === 'KR' ? 'KRW' : 'USD')} / {formatPrice(h.stop, h.market === 'KR' ? 'KRW' : 'USD')} · {h.qty.toLocaleString()}주
                    </span>
                    <button type="button" className="btn btn-secondary btn-small push-right" onClick={() => recall(h)}>
                      불러오기
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
