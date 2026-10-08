import { useState } from 'react'
import { formatMoney, formatPct, formatPrice } from '../../core/format'
import { entrySide } from '../../core/pnl'
import { useData } from '../../data/dataStore'
import { loadTrade, removeFill } from '../../data/trades'
import { hrefFor } from '../../ui/routes'
import { GradeBadge, PnlText } from '../../ui/TradeBits'
import { currencyOf, shortDateTime, STATUS_LABEL } from '../../ui/tradeText'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { FillSheet } from './FillSheet'
import { PlanSheet } from './PlanSheet'
import { ReviewForm } from './ReviewForm'
import { StopSheet } from './StopSheet'

type Open = null | { kind: 'plan' } | { kind: 'fill'; side: 'buy' | 'sell' } | { kind: 'stop' }

export function TradeDetail({ id }: { id: string }) {
  const trade = useRepoQuery((r) => loadTrade(r, id), [id])
  const [open, setOpen] = useState<Open>(null)

  if (trade === undefined) return <p className="empty">불러오는 중…</p>
  if (trade === null)
    return (
      <>
        <a href={hrefFor('trades')} className="back-link">
          ‹ 트레이드 목록
        </a>
        <p className="empty">이 트레이드를 찾을 수 없습니다. 삭제됐거나 아직 동기화되지 않았을 수 있습니다.</p>
      </>
    )

  const { position: p, summary: s } = trade
  const currency = currencyOf(p.market)
  const closed = p.status === 'review_pending' || p.status === 'done'
  const inSide = entrySide(p.direction)
  const outSide = inSide === 'buy' ? 'sell' : 'buy'
  const close = () => setOpen(null)

  return (
    <>
      <a href={hrefFor('trades')} className="back-link">
        ‹ 트레이드 목록
      </a>

      <header className="card trade-head">
        <div>
          <div className="row wrap">
            <h1 className="trade-title">{p.ticker}</h1>
            <span className="chip">
              {p.market} · {p.direction === 'long' ? '롱' : '숏'}
            </span>
            {p.setup && <span className="chip">{p.setup}</span>}
            <span className={`chip chip-status-${p.status}`}>{STATUS_LABEL[p.status]}</span>
            {p.no_plan && <span className="chip chip-bad">무계획 진입</span>}
          </div>
          {p.ticker_name && <div className="help">{p.ticker_name}</div>}
        </div>
        <div className="trade-head-stats">
          {trade.review?.grade && (
            <div className="stat-box">
              <div className="field-label">실행 등급</div>
              <GradeBadge grade={trade.review.grade} size="large" />
            </div>
          )}
          <div className="stat-box">
            <div className="field-label">{closed ? '결과' : '실현'}</div>
            <PnlText value={s.r} kind="r" className="stat-big" />
            <PnlText value={s.pnl.exitQty ? s.pnl.realizedNet : null} kind="money" currency={currency} />
          </div>
        </div>
      </header>

      <div className="detail-grid">
        <div className="stack">
          <section className="card stack" aria-labelledby="plan-title">
            <div className="row">
              <h2 id="plan-title" className="section-title">
                계획
              </h2>
              <button type="button" className="btn btn-secondary btn-small push-right" onClick={() => setOpen({ kind: 'plan' })}>
                {trade.plan ? '편집' : '계획 추가'}
              </button>
            </div>
            {trade.plan ? (
              <>
                {trade.plan.thesis && (
                  <p className="para">
                    <span className="faint">진입 근거</span> · {trade.plan.thesis}
                  </p>
                )}
                {trade.plan.invalidation && (
                  <p className="para">
                    <span className="faint">무효화</span> · {trade.plan.invalidation}
                  </p>
                )}
                <dl className="tiles">
                  <Tile label="계획 진입" value={trade.plan.plan_entry ? formatPrice(trade.plan.plan_entry, currency) : '—'} />
                  <Tile label="원 손절" value={p.original_stop ? formatPrice(p.original_stop, currency) : '—'} />
                  <Tile label="계획 수량" value={trade.plan.plan_qty ? `${trade.plan.plan_qty.toLocaleString()}주` : '—'} />
                  <Tile label="RPT · 1R" value={`${trade.plan.rpt_pct ? formatPct(trade.plan.rpt_pct) : '—'} · ${s.oneR ? formatMoney(s.oneR, currency, false) : '—'}`} />
                </dl>
                {trade.plan.target_rule && <p className="help">목표·익절: {trade.plan.target_rule}</p>}
              </>
            ) : (
              <p className="help">계획 없이 시작한 트레이드입니다. 지금 계획을 적어도 무계획 진입 표시는 남습니다.</p>
            )}
          </section>

          <section className="card stack" aria-labelledby="fills-title">
            <div className="row wrap">
              <h2 id="fills-title" className="section-title">
                체결
              </h2>
              <button type="button" className="btn btn-secondary btn-small push-right accent-outline" onClick={() => setOpen({ kind: 'fill', side: inSide })}>
                + {inSide === 'buy' ? '매수' : '매도'}
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setOpen({ kind: 'fill', side: outSide })} disabled={s.pnl.openQty <= 0}>
                + {outSide === 'buy' ? '매수' : '매도'}
              </button>
            </div>
            {trade.fills.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>일시</th>
                      <th>구분</th>
                      <th className="r">가격</th>
                      <th className="r">수량</th>
                      <th>단계</th>
                      <th aria-label="삭제" />
                    </tr>
                  </thead>
                  <tbody>
                    {trade.fills.map((f) => (
                      <tr key={f.id}>
                        <td className="num">{shortDateTime(f.ts)}</td>
                        <td className={f.side === 'buy' ? 'profit' : 'loss'}>{f.side === 'buy' ? '매수' : '매도'}</td>
                        <td className="num r">{formatPrice(f.price, currency)}</td>
                        <td className="num r">{f.qty.toLocaleString()}</td>
                        <td>{f.side === inSide ? (f.pyramid_stage ? `${f.pyramid_stage}차` : '') : ''}</td>
                        <td className="r">
                          <DeleteFill tradeTicker={p.ticker} fillId={f.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="help">아직 체결이 없습니다. 진입하면 + {inSide === 'buy' ? '매수' : '매도'}로 기록하세요.</p>
            )}
            <div className="row wrap help">
              {s.pnl.openQty > 0 && (
                <span>
                  보유 <b className="num">{s.pnl.openQty.toLocaleString()}주</b> · 평균 <b className="num">{formatPrice(s.pnl.avgCost, currency)}</b>
                </span>
              )}
              {s.entryDeviationPct !== null && (
                <span>
                  진입가 괴리 <b className="num">{s.entryDeviationPct >= 0 ? '+' : ''}{formatPct(s.entryDeviationPct, 1)}</b>
                </span>
              )}
              {s.qtyDeviationPct !== null && (
                <span>
                  수량 괴리 <b className="num">{s.qtyDeviationPct >= 0 ? '+' : ''}{formatPct(s.qtyDeviationPct, 0)}</b>
                </span>
              )}
              {s.pnl.feesTotal > 0 && (
                <span>
                  비용 <b className="num">{formatMoney(s.pnl.feesTotal, currency, false)}</b>
                </span>
              )}
            </div>
          </section>

          <section className="card stack" aria-labelledby="stop-title">
            <div className="row">
              <h2 id="stop-title" className="section-title">
                손절
              </h2>
              <button type="button" className="btn btn-secondary btn-small push-right" onClick={() => setOpen({ kind: 'stop' })} disabled={closed}>
                손절 이동
              </button>
            </div>
            <p className="help" style={{ margin: 0 }}>
              지금 <b className="num">{trade.currentStop ? formatPrice(trade.currentStop, currency) : '—'}</b> · 원 손절{' '}
              <b className="num">{p.original_stop ? formatPrice(p.original_stop, currency) : '—'}</b> (R 기준)
            </p>
            {trade.stops.length > 0 && (
              <ul className="log">
                {trade.stops.map((m) => (
                  <li key={m.id}>
                    <span className="num faint">{shortDateTime(m.ts)}</span>
                    <span className="num">
                      {m.old_stop ? formatPrice(m.old_stop, currency) : '—'} → {formatPrice(m.new_stop, currency)}
                    </span>
                    {m.reason && <span className="log-detail">{m.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card stack" aria-labelledby="chart-title">
            <h2 id="chart-title" className="section-title">
              차트북
            </h2>
            <div className="slot-grid">
              {['① 셋업', '② 진입', '③ 청산 (필수)', '④ 사후 복기'].map((s) => (
                <div key={s} className="slot">
                  <span>{s}</span>
                </div>
              ))}
            </div>
            <p className="help">차트 업로드는 다음 단계(Step 6)에서 켜집니다.</p>
          </section>

          <section className="card stack" aria-labelledby="review-title">
            <h2 id="review-title" className="section-title">
              복기
            </h2>
            {closed ? <ReviewForm key={p.id} trade={trade} /> : <p className="help">전량 청산하면 복기를 쓸 수 있습니다.</p>}
          </section>
        </div>
      </div>

      {open?.kind === 'plan' && <PlanSheet trade={trade} onClose={close} />}
      {open?.kind === 'fill' && <FillSheet trade={trade} side={open.side} onClose={close} />}
      {open?.kind === 'stop' && <StopSheet trade={trade} onClose={close} />}
    </>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  )
}

function DeleteFill({ fillId, tradeTicker }: { fillId: string; tradeTicker: string }) {
  const repo = useData((s) => s.repo)
  return (
    <button
      type="button"
      className="icon-btn small-icon"
      aria-label="이 체결 삭제"
      onClick={() => {
        if (repo && window.confirm(`${tradeTicker} 체결 1건을 삭제할까요?`)) void removeFill(repo, fillId)
      }}
    >
      ✕
    </button>
  )
}
