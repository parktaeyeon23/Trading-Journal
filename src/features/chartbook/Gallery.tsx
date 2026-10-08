import { useState } from 'react'
import type { TradeBundle } from '../../data/trades'
import { hrefFor } from '../../ui/routes'
import { GradeBadge, PnlText } from '../../ui/TradeBits'
import { currencyOf } from '../../ui/tradeText'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { coverImage } from './chartItems'
import { FallbackImg } from './FallbackImg'
import { tradeDate } from '../../core/calendar'
import { exitTime, filterGallery, NO_FILTERS, type GalleryFilters, type PeriodFilter, type ResultFilter } from './gallery'

const RESULTS: { v: ResultFilter; label: string }[] = [
  { v: 'all', label: '전체' },
  { v: 'win', label: '수익' },
  { v: 'loss', label: '손실' },
]
const PERIODS: { v: PeriodFilter; label: string }[] = [
  { v: 'all', label: '전체 기간' },
  { v: '30d', label: '최근 30일' },
  { v: '90d', label: '최근 90일' },
  { v: 'ytd', label: '올해' },
]
const GRADES = ['A', 'B', 'C', 'D'] as const

/** Closed trades as chart cards, filterable, with a win/loss side-by-side mode. */
export function Gallery({ trades }: { trades: TradeBundle[] }) {
  const mistakeTags = useRepoQuery(async (r) => (await r.list('Tags')).filter((t) => t.family === 'mistake'), []) ?? []
  const [f, setF] = useState<GalleryFilters>(NO_FILTERS)
  const [compare, setCompare] = useState(false)
  const [now] = useState(() => new Date())
  const set = (patch: Partial<GalleryFilters>) => setF((x) => ({ ...x, ...patch }))

  const setups = [...new Set(trades.map((t) => t.position.setup).filter((s): s is string => !!s))].sort()
  const shown = filterGallery(trades, compare ? { ...f, result: 'all' } : f, now)
  const wins = shown.filter((t) => t.summary.pnl.realizedNet > 0)
  const losses = shown.filter((t) => t.summary.pnl.realizedNet < 0)

  return (
    <div className="stack">
      <div className="gallery-filters">
        <select className="input input-small" value={f.setup ?? ''} onChange={(e) => set({ setup: e.target.value || null })} aria-label="셋업">
          <option value="">모든 셋업</option>
          {setups.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="input input-small" value={f.mistakeTagId ?? ''} onChange={(e) => set({ mistakeTagId: e.target.value || null })} aria-label="실수">
          <option value="">실수 전체</option>
          {mistakeTags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="input input-small" value={f.grade ?? ''} onChange={(e) => set({ grade: (e.target.value || null) as GalleryFilters['grade'] })} aria-label="실행 등급">
          <option value="">등급 전체</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}등급
            </option>
          ))}
        </select>
        <select className="input input-small" value={f.period} onChange={(e) => set({ period: e.target.value as PeriodFilter })} aria-label="기간">
          {PERIODS.map((p) => (
            <option key={p.v} value={p.v}>
              {p.label}
            </option>
          ))}
        </select>
        {!compare && (
          <div className="seg seg-small" role="group" aria-label="결과">
            {RESULTS.map((r) => (
              <button key={r.v} type="button" aria-pressed={f.result === r.v} onClick={() => set({ result: r.v })}>
                {r.label}
              </button>
            ))}
          </div>
        )}
        <label className="row">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          수익·손실 나란히
        </label>
      </div>

      {compare ? (
        <div className="gallery-compare">
          <GalleryColumn title="수익" tone="profit" list={wins} />
          <GalleryColumn title="손실" tone="loss" list={losses} />
        </div>
      ) : shown.length ? (
        <div className="gallery-grid">
          {shown.map((t) => (
            <GalleryCard key={t.position.id} t={t} />
          ))}
        </div>
      ) : (
        <p className="empty">조건에 맞는 청산 트레이드가 없습니다.</p>
      )}
    </div>
  )
}

function GalleryColumn({ title, tone, list }: { title: string; tone: 'profit' | 'loss'; list: TradeBundle[] }) {
  return (
    <section className="stack-tight" aria-label={title}>
      <h2 className="list-title">
        <span className={tone}>{title}</span> <span className="faint">{list.length}</span>
      </h2>
      {list.length ? (
        <div className="gallery-grid gallery-grid-narrow">
          {list.map((t) => (
            <GalleryCard key={t.position.id} t={t} />
          ))}
        </div>
      ) : (
        <p className="help">없음</p>
      )}
    </section>
  )
}

const PAGE = 60

/** A grid of trade cards with their cover chart (used by drill-downs elsewhere), 60 at a time. */
export function TradeCards({ trades }: { trades: TradeBundle[] }) {
  const [shown, setShown] = useState(PAGE)
  if (!trades.length) return <p className="help">트레이드가 없습니다.</p>
  return (
    <div className="stack">
      <div className="gallery-grid gallery-grid-narrow">
        {trades.slice(0, shown).map((t) => (
          <GalleryCard key={t.position.id} t={t} />
        ))}
      </div>
      {trades.length > shown && (
        <button type="button" className="btn btn-secondary" onClick={() => setShown((n) => n + PAGE)}>
          더 보기 ({trades.length - shown})
        </button>
      )}
    </div>
  )
}

function GalleryCard({ t }: { t: TradeBundle }) {
  const p = t.position
  const cover = coverImage(t)
  const at = exitTime(t)
  return (
    <a className="gallery-card" href={hrefFor('trades', p.id)}>
      <div className="gallery-img">{cover ? <FallbackImg srcs={cover} alt={`${p.ticker} 차트`} /> : <span className="img-missing">차트 없음</span>}</div>
      <div className="gallery-meta">
        <div className="row tight">
          <b>{p.ticker}</b>
          <span className="push-right">
            <GradeBadge grade={t.review?.grade} />
          </span>
        </div>
        <div className="row tight small">
          <span className="faint">
            {at ? tradeDate(at, p.market).slice(2).replace(/-/g, '.') : ''}
            {p.setup ? ` · ${p.setup}` : ''}
          </span>
          <PnlText value={t.summary.r} kind="r" className="push-right strong" />
        </div>
        <PnlText value={t.summary.pnl.realizedNet} kind="money" currency={currencyOf(p.market)} className="small" />
      </div>
    </a>
  )
}
