import { useMemo, useState } from 'react'
import { formatMoney, parseAmount } from '../../core/format'
import { monthBook, moneyMatches, type MonthBook } from '../../core/reconcile'
import { useData } from '../../data/dataStore'
import { readSetting, writeSetting } from '../../data/settings'
import { loadAllTrades, type TradeBundle } from '../../data/trades'
import { hrefFor } from '../../ui/routes'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { todayKst } from '../calendar/calText'

const reconKey = (month: string) => `recon_${month}`

export interface ReconRecord {
  realized: { KR: string; US: string }
  holdings: Record<string, string>
  memo: string
  status: 'match' | 'mismatch'
  savedAt: string
}

/** Month-end check against the broker's statement: realized P&L per market and shares held. */
export function Reconcile({ month: initial }: { month: string | null }) {
  const [month, setMonth] = useState(initial && /^\d{4}-\d{2}$/.test(initial) ? initial : todayKst().slice(0, 7))
  const data = useRepoQuery(
    async (r) => ({ month, trades: await loadAllTrades(r), saved: await readSetting<ReconRecord | null>(r, reconKey(month), null) }),
    [month],
  )
  return (
    <div className="stack">
      <a href={hrefFor('analysis')} className="back-link">
        ‹ 분석
      </a>
      <div className="row wrap">
        <h1 className="page-title">월말 대조</h1>
        <input type="month" className="input input-small push-right" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="대조할 달" />
      </div>
      <p className="help" style={{ margin: 0 }}>
        증권사 앱의 그달 실현손익(수수료·세금 차감 후)과 말일 보유 수량을 옆 칸에 넣으세요. 다르면 체결 입력이 빠졌거나 잘못된 것입니다.
      </p>
      {data && data.month === month ? <Body key={month} month={month} trades={data.trades} saved={data.saved} /> : <p className="empty">불러오는 중…</p>}
    </div>
  )
}

function Body({ month, trades, saved }: { month: string; trades: TradeBundle[]; saved: ReconRecord | null }) {
  const repo = useData((s) => s.repo)
  const book: MonthBook = useMemo(
    () => monthBook(trades.map((t) => ({ id: t.position.id, market: t.position.market, ticker: t.position.ticker, direction: t.position.direction, fills: t.fills })), month),
    [trades, month],
  )
  const byId = new Map(trades.map((t) => [t.position.id, t]))
  const [realized, setRealized] = useState(saved?.realized ?? { KR: '', US: '' })
  const [holdings, setHoldings] = useState<Record<string, string>>(saved?.holdings ?? {})
  const [memo, setMemo] = useState(saved?.memo ?? '')
  const [savedAt, setSavedAt] = useState(saved?.savedAt ?? null)

  const realizedOk = (m: 'KR' | 'US') => {
    const v = parseAmount(realized[m])
    return realized[m].trim() === '' ? null : Number.isFinite(v) ? moneyMatches(book.realized[m], v, m) : false
  }
  // Rows: everything the app holds, plus anything typed for a ticker the app doesn't hold.
  const keys = [...new Set([...Object.keys(book.holdings), ...Object.keys(holdings).filter((k) => holdings[k].trim())])].sort()
  const holdingOk = (k: string) => {
    const t = (holdings[k] ?? '').trim()
    if (!t) return null
    return parseAmount(t) === (book.holdings[k] ?? 0)
  }
  const checks = [realizedOk('KR'), realizedOk('US'), ...keys.map(holdingOk)].filter((x) => x !== null)
  const status: 'match' | 'mismatch' | null = checks.length ? (checks.every(Boolean) ? 'match' : 'mismatch') : null

  async function save() {
    if (!repo || !status) return
    const at = new Date().toISOString()
    await writeSetting(repo, reconKey(month), { realized, holdings, memo, status, savedAt: at } satisfies ReconRecord)
    setSavedAt(at)
  }

  const links = (ids: string[]) =>
    ids.map((id) => {
      const t = byId.get(id)
      return t ? (
        <a key={id} className="small" href={hrefFor('trades', id)}>
          {t.position.ticker} 체결 ›
        </a>
      ) : null
    })

  return (
    <>
      <section className="card stack" aria-labelledby="recon-pnl">
        <h2 id="recon-pnl" className="section-title">
          실현손익
        </h2>
        <div className="table-wrap">
          <table className="table recon-table">
            <thead>
              <tr>
                <th>시장</th>
                <th className="r">앱 계산</th>
                <th>증권사</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(['KR', 'US'] as const).map((m) => {
                const ok = realizedOk(m)
                return (
                  <tr key={m} className={ok === false ? 'recon-bad' : ''}>
                    <td>{m}</td>
                    <td className="num r">{formatMoney(book.realized[m], m === 'KR' ? 'KRW' : 'USD')}</td>
                    <td>
                      <input className="input num input-small" inputMode="decimal" value={realized[m]} onChange={(e) => setRealized({ ...realized, [m]: e.target.value })} aria-label={`${m} 증권사 실현손익`} />
                    </td>
                    <td>
                      {ok === true && <span className="chip chip-done">일치</span>}
                      {ok === false && (
                        <span className="row wrap tight">
                          <span className="chip chip-bad">차이 {formatMoney(book.realized[m] - parseAmount(realized[m]), m === 'KR' ? 'KRW' : 'USD')}</span>
                          {links(book.realizedTrades[m])}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack" aria-labelledby="recon-hold">
        <h2 id="recon-hold" className="section-title">
          말일 보유 수량
        </h2>
        {keys.length ? (
          <div className="table-wrap">
            <table className="table recon-table">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="r">앱 계산</th>
                  <th>증권사</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const ok = holdingOk(k)
                  return (
                    <tr key={k} className={ok === false ? 'recon-bad' : ''}>
                      <td className="num">{k}</td>
                      <td className="num r">{(book.holdings[k] ?? 0).toLocaleString()}주</td>
                      <td>
                        <input className="input num input-small" inputMode="numeric" value={holdings[k] ?? ''} onChange={(e) => setHoldings({ ...holdings, [k]: e.target.value })} aria-label={`${k} 증권사 보유 수량`} />
                      </td>
                      <td>
                        {ok === true && <span className="chip chip-done">일치</span>}
                        {ok === false && (
                          <span className="row wrap tight">
                            <span className="chip chip-bad">차이</span>
                            {links(book.holdingTrades[k] ?? [])}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="help" style={{ margin: 0 }}>
            앱 기준 말일 보유 종목이 없습니다.
          </p>
        )}
        <AddHolding onAdd={(k) => setHoldings({ ...holdings, [k]: holdings[k] ?? '0' })} />
      </section>

      <section className="card stack">
        <label className="field">
          <span className="field-label">메모</span>
          <textarea className="input textarea" rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="차이 원인, 고친 체결" />
        </label>
        <div className="row">
          {status && <span className={`chip ${status === 'match' ? 'chip-done' : 'chip-bad'}`}>{status === 'match' ? '모두 일치' : '불일치 있음'}</span>}
          {savedAt && <span className="help">{new Date(savedAt).toLocaleString('ko-KR')} 저장</span>}
          <button type="button" className="btn btn-primary push-right" onClick={() => void save()} disabled={!status}>
            대조 결과 저장
          </button>
        </div>
      </section>
    </>
  )
}

/** A ticker the broker shows but the app doesn't (a missing buy). */
function AddHolding({ onAdd }: { onAdd: (key: string) => void }) {
  const [market, setMarket] = useState<'KR' | 'US'>('KR')
  const [ticker, setTicker] = useState('')
  return (
    <div className="row wrap tight">
      <span className="help" style={{ margin: 0 }}>
        증권사에만 있는 종목:
      </span>
      <select className="input input-small" value={market} onChange={(e) => setMarket(e.target.value as 'KR' | 'US')} aria-label="시장">
        <option value="KR">KR</option>
        <option value="US">US</option>
      </select>
      <input className="input input-small num" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder={market === 'KR' ? '005930' : 'NVDA'} aria-label="티커" />
      <button
        type="button"
        className="btn btn-secondary btn-small"
        disabled={!ticker.trim()}
        onClick={() => {
          onAdd(`${market}:${ticker.trim().toUpperCase()}`)
          setTicker('')
        }}
      >
        추가
      </button>
    </div>
  )
}
