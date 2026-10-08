import { useState } from 'react'
import { formatPrice } from '../../core/format'
import { loadAllTrades, type TradeBundle } from '../../data/trades'
import { Gallery } from '../chartbook/Gallery'
import type { PositionStatus } from '../../data/types'
import { GradeBadge, PnlText } from '../../ui/TradeBits'
import { hrefFor } from '../../ui/routes'
import { currencyOf, shortDateTime } from '../../ui/tradeText'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { useRoute } from '../../ui/useRoute'
import { FillSheet } from './FillSheet'
import { PlanSheet } from './PlanSheet'
import { TradeDetail } from './TradeDetail'

const SECTIONS: { status: PositionStatus; title: string; empty?: string }[] = [
  { status: 'review_pending', title: '복기 대기' },
  { status: 'open', title: '보유 중' },
  { status: 'planned', title: '계획' },
  { status: 'done', title: '완료' },
]
const DONE_PAGE = 20
const VIEW_KEY = 'aj.trades.view'

type View = 'list' | 'gallery'
function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'gallery' ? 'gallery' : 'list'
  } catch {
    return 'list'
  }
}

export function TradesScreen() {
  const route = useRoute()
  if (route.param) return <TradeDetail id={route.param} />
  return <TradeList />
}

function TradeList() {
  const trades = useRepoQuery((r) => loadAllTrades(r), [])
  const [sheet, setSheet] = useState<null | 'plan' | 'fill'>(null)
  const [doneShown, setDoneShown] = useState(DONE_PAGE)
  const [view, setViewState] = useState<View>(savedView)
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }

  const byStatus = (s: PositionStatus) =>
    (trades ?? [])
      .filter((t) => t.position.status === s)
      .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1))

  return (
    <>
      <div className="row wrap">
        <h1 className="page-title">트레이드</h1>
        <div className="seg seg-small" role="group" aria-label="보기">
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            목록
          </button>
          <button type="button" aria-pressed={view === 'gallery'} onClick={() => setView('gallery')}>
            갤러리
          </button>
        </div>
        <div className="row wrap push-right">
          <button type="button" className="btn btn-secondary" onClick={() => setSheet('fill')}>
            체결부터 입력
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setSheet('plan')}>
            + 새 계획
          </button>
        </div>
      </div>

      {trades === undefined ? (
        <p className="empty">불러오는 중…</p>
      ) : trades.length === 0 ? (
        <section className="card stack">
          <p className="empty" style={{ margin: 0 }}>
            아직 트레이드가 없습니다. 계산기에서 "트레이드로 보내기"를 누르거나, 위의 "+ 새 계획"으로 시작하세요.
          </p>
        </section>
      ) : view === 'gallery' ? (
        <Gallery trades={trades} />
      ) : (
        SECTIONS.map(({ status, title }) => {
          const list = byStatus(status)
          if (!list.length) return null
          const shown = status === 'done' ? list.slice(0, doneShown) : list
          return (
            <section key={status} aria-labelledby={`sec-${status}`} className="stack-tight">
              <h2 id={`sec-${status}`} className="list-title">
                {title} <span className={status === 'review_pending' ? 'count-alert' : 'faint'}>{list.length}</span>
              </h2>
              <div className="trade-list">
                {shown.map((t) => (
                  <TradeCard key={t.position.id} t={t} />
                ))}
              </div>
              {status === 'done' && list.length > doneShown && (
                <button type="button" className="btn btn-secondary" onClick={() => setDoneShown((n) => n + DONE_PAGE)}>
                  더 보기 ({list.length - doneShown})
                </button>
              )}
            </section>
          )
        })
      )}

      {sheet === 'plan' && <PlanSheet onClose={() => setSheet(null)} />}
      {sheet === 'fill' && <FillSheet onClose={() => setSheet(null)} />}
    </>
  )
}

/** Newest activity first: last fill, else last edit. */
function sortKey(t: TradeBundle): string {
  return t.fills.at(-1)?.ts ?? t.position.updated_at
}

function TradeCard({ t }: { t: TradeBundle }) {
  const p = t.position
  const s = t.summary
  const currency = currencyOf(p.market)
  const checklist = (t.review?.checklist ?? null) as Record<string, boolean> | null
  const rules = checklist ? Object.values(checklist) : null
  const last = t.fills.at(-1)

  return (
    <a className="trade-card" href={hrefFor('trades', p.id)}>
      <div className="trade-card-main">
        <div className="row wrap tight">
          <b className="trade-card-ticker">{p.ticker}</b>
          <span className="faint small">
            {p.market} · {p.direction === 'long' ? '롱' : '숏'}
            {p.setup ? ` · ${p.setup}` : ''}
          </span>
          {p.no_plan && <span className="chip chip-bad">무계획</span>}
        </div>
        <div className="small faint">
          {p.status === 'planned' && t.plan
            ? `계획 ${t.plan.plan_entry ? formatPrice(t.plan.plan_entry, currency) : '—'} / 손절 ${p.original_stop ? formatPrice(p.original_stop, currency) : '—'} · ${t.plan.plan_qty ?? '—'}주`
            : p.status === 'open'
              ? `보유 ${s.pnl.openQty.toLocaleString()}주 @ ${formatPrice(s.pnl.avgCost, currency)} · 손절 ${t.currentStop ? formatPrice(t.currentStop, currency) : '—'}`
              : rules
                ? `규칙 ${rules.filter(Boolean).length}/${rules.length}${last ? ` · ${shortDateTime(last.ts)}` : ''}`
                : `복기 전${last ? ` · ${shortDateTime(last.ts)} 청산` : ''}`}
        </div>
      </div>
      <div className="trade-card-side">
        <GradeBadge grade={t.review?.grade} />
        {(p.status === 'review_pending' || p.status === 'done') && (
          <>
            <PnlText value={s.r} kind="r" className="strong" />
            <PnlText value={s.pnl.realizedNet} kind="money" currency={currency} className="small" />
          </>
        )}
      </div>
    </a>
  )
}
