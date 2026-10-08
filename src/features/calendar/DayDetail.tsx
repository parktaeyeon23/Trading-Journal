import { useEffect } from 'react'
import { dayChange, eventValue, type CalEvent, type CalUnit, type DayBucket, type UnitContext } from '../../core/calendar'
import { formatSignedPct } from '../../core/format'
import { useData } from '../../data/dataStore'
import type { TradeBundle } from '../../data/trades'
import { ChartIcon } from '../../ui/icons'
import { hrefFor } from '../../ui/routes'
import { GradeBadge, PnlText } from '../../ui/TradeBits'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { coverImage } from '../chartbook/chartItems'
import { FallbackImg } from '../chartbook/FallbackImg'
import { full, longDate, toneClass } from './calText'
import { requestSeries, retrySeries, useIndexFetchStates } from './indexFetch'

const INDICES = [
  { key: 'KOSPI', label: 'KOSPI' },
  { key: 'KOSDAQ', label: 'KOSDAQ' },
  { key: 'SPX', label: 'S&P 500' },
  { key: 'NASDAQ', label: 'NASDAQ' },
] as const


interface DayDetailProps {
  date: string
  bucket: DayBucket | undefined
  events: CalEvent[]
  byId: Map<string, TradeBundle>
  unit: CalUnit
  ctx: UnitContext
}

export function DayDetail({ date, bucket, events, byId, unit, ctx }: DayDetailProps) {
  const getQuote = useData((s) => s.getQuote)
  const configured = useData((s) => !!s.config)
  const data = useRepoQuery(
    async (r) => {
      const [bars, notes] = await Promise.all([r.list('MarketCache'), r.list('DailyNotes')])
      const moves = INDICES.map((ix) => ({ ...ix, move: dayChange(bars.filter((b) => b.symbol === `IDX:${ix.key}`), date) }))
      return { moves, note: notes.find((n) => n.date === date) ?? null }
    },
    [date],
  )

  const fetches = useIndexFetchStates()

  // Fill a missing index day from the backend (once per series per session). Weekends have no bars.
  useEffect(() => {
    if (!data || !configured) return
    for (const m of data.moves) if (!m.move) requestSeries(m.key, getQuote)
  }, [data, configured, getQuote])

  const missing = data ? data.moves.filter((m) => !m.move).map((m) => m.key) : []
  const failures = [...new Set(missing.map((k) => fetches.get(k)).flatMap((f) => (f?.state === 'failed' ? [f.message] : [])))]
  const loading = missing.some((k) => fetches.get(k)?.state === 'loading')
  const indexNote = !data
    ? null
    : !configured && missing.length
      ? '설정에서 백엔드를 연결하면 지수를 불러옵니다.'
      : loading
        ? '지수를 불러오는 중…'
        : missing.length === INDICES.length && !failures.length
          ? '이날 지수 일봉이 없습니다 — 주말·휴장일이거나, 장 마감 전이거나, GAS에서 installMarketTrigger를 실행하기 전 기간입니다.'
          : null

  const dayEvents = events.filter((e) => e.date === date)
  return (
    <div className="stack day-detail">
      <div className="row">
        <h2 className="section-title">{longDate(date)}</h2>
        {bucket && bucket.trades > 0 && <span className={`num strong push-right ${toneClass(bucket.value)}`}>{full(bucket.value, unit)}</span>}
      </div>

      {data && (
        <div className="index-grid">
          {data.moves.map((m) => (
            <div key={m.key} className="index-chip">
              <span>{m.label}</span>
              {m.move?.changePct != null ? <span className={`num ${toneClass(m.move.changePct)}`}>{formatSignedPct(m.move.changePct, 1)}</span> : <span className="num faint">—</span>}
            </div>
          ))}
        </div>
      )}
      {failures.map((msg) => (
        <div key={msg} className="notice notice-bad row wrap" role="alert">
          <span>{msg}</span>
          <button type="button" className="btn btn-secondary btn-small push-right" onClick={() => retrySeries(missing, getQuote)}>
            다시 시도
          </button>
        </div>
      ))}
      {indexNote && (
        <p className="help" style={{ margin: 0 }}>
          {indexNote}
        </p>
      )}

      {dayEvents.length ? (
        <div className="stack-tight">
          {dayEvents.map((e) => {
            const t = byId.get(e.tradeId)
            if (!t) return null
            const p = t.position
            const cover = coverImage(t)
            const v = eventValue(e, unit, ctx)
            const checklist = (t.review?.checklist ?? null) as Record<string, boolean> | null
            const rules = checklist ? Object.values(checklist) : null
            return (
              <a key={e.tradeId} className="day-trade" href={hrefFor('trades', p.id)}>
                <span className="day-thumb">{cover ? <FallbackImg srcs={cover} alt="" /> : <ChartIcon />}</span>
                <span className="day-trade-main">
                  <b>{p.ticker}</b>{' '}
                  <span className="small faint">
                    {p.market}
                    {p.setup ? ` · ${p.setup}` : ''}
                  </span>
                  <span className="small faint block">{rules ? `규칙 ${rules.filter(Boolean).length}/${rules.length}` : p.status === 'review_pending' ? '복기 전' : p.status === 'open' ? '일부 청산 · 보유 중' : ''}</span>
                </span>
                <span className="day-trade-side">
                  <GradeBadge grade={t.review?.grade} />
                  <PnlText value={e.r} kind="r" className="small" />
                  {unit !== 'R' && <span className={`num small ${v === null ? 'faint' : toneClass(v)}`}>{v === null ? '환산 불가' : full(v, unit)}</span>}
                </span>
              </a>
            )
          })}
        </div>
      ) : (
        <p className="help" style={{ margin: 0 }}>
          이날 청산된 트레이드가 없습니다.
        </p>
      )}

      <div className="day-note-box">
        <div className="row">
          <span className="field-label">일간 노트</span>
          <a className="push-right small" href={hrefFor('notes', date)}>
            {data?.note ? '열기' : '쓰기'} ›
          </a>
        </div>
        {data?.note?.premarket && <p className="para">장전 · {data.note.premarket}</p>}
        {data?.note?.postmarket && <p className="para">장후 · {data.note.postmarket}</p>}
        {!data?.note?.premarket && !data?.note?.postmarket && <p className="help" style={{ margin: 0 }}>노트가 없습니다.</p>}
      </div>
    </div>
  )
}
