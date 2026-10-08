import { addDays, eventValue, type CalEvent, type CalUnit, type DayBucket, type UnitContext } from '../../core/calendar'
import type { TradeBundle } from '../../data/trades'
import { ChartIcon, PencilIcon } from '../../ui/icons'
import { hrefFor } from '../../ui/routes'
import { GradeBadge, PnlText } from '../../ui/TradeBits'
import { coverImage } from '../chartbook/chartItems'
import { FallbackImg } from '../chartbook/FallbackImg'
import { full, longDate, toneClass } from './calText'

interface WeekViewProps {
  start: string
  days: number
  buckets: Map<string, DayBucket>
  events: CalEvent[]
  byId: Map<string, TradeBundle>
  unit: CalUnit
  ctx: UnitContext
  noteDates: Set<string>
  today: string
  onSelect: (date: string) => void
}

/** One row per day with that day's trades as cards, chart thumbnails included. */
export function WeekView(p: WeekViewProps) {
  const dates = Array.from({ length: p.days }, (_, i) => addDays(p.start, i))
  return (
    <div className="stack">
      {dates.map((date) => {
        const b = p.buckets.get(date)
        const evs = p.events.filter((e) => e.date === date)
        return (
          <section key={date} className="stack-tight week-day" aria-label={longDate(date)}>
            <div className="row">
              <button type="button" className="day-link" onClick={() => p.onSelect(date)}>
                <b className={p.today === date ? 'today-text' : ''}>{longDate(date)}</b>
              </button>
              {p.noteDates.has(date) && (
                <a href={hrefFor('notes', date)} className="icon-link" aria-label="일간 노트">
                  <PencilIcon size={14} />
                </a>
              )}
              {b && b.trades > 0 ? <span className={`num strong push-right ${toneClass(b.value)}`}>{full(b.value, p.unit)}</span> : <span className="faint small push-right">거래 없음</span>}
            </div>
            {evs.length > 0 && (
              <div className="week-cards">
                {evs.map((e) => {
                  const t = p.byId.get(e.tradeId)
                  if (!t) return null
                  const cover = coverImage(t)
                  const v = eventValue(e, p.unit, p.ctx)
                  return (
                    <a key={e.tradeId} className="week-card" href={hrefFor('trades', t.position.id)}>
                      <span className="week-card-img">{cover ? <FallbackImg srcs={cover} alt={`${t.position.ticker} 차트`} /> : <ChartIcon size={20} />}</span>
                      <span className="week-card-meta">
                        <span className="row tight">
                          <b>{t.position.ticker}</b>
                          <span className="push-right">
                            <GradeBadge grade={t.review?.grade} />
                          </span>
                        </span>
                        <span className="small faint">
                          {t.position.market}
                          {t.position.setup ? ` · ${t.position.setup}` : ''}
                        </span>
                        <span className="row tight small">
                          <PnlText value={e.r} kind="r" />
                          {p.unit !== 'R' && <span className={`num push-right ${v === null ? 'faint' : toneClass(v)}`}>{v === null ? '—' : full(v, p.unit)}</span>}
                        </span>
                      </span>
                    </a>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
