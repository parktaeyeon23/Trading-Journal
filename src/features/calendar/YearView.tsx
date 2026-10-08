import { monthWeeks, summarizePeriod, type CalEvent, type CalUnit, type DayBucket, type UnitContext } from '../../core/calendar'
import { compact, heatStyle, md, toneClass } from './calText'

interface YearViewProps {
  year: number
  buckets: Map<string, DayBucket>
  events: CalEvent[]
  unit: CalUnit
  ctx: UnitContext
  showWeekends: boolean
  maxAbs: number
  onMonth: (month: number) => void
}

/** Twelve month tiles, each with its total and a contribution-style mini heat map. */
export function YearView(p: YearViewProps) {
  const rows = p.showWeekends ? 7 : 5
  return (
    <div className="year-grid">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const mm = `${p.year}-${String(m).padStart(2, '0')}`
        const s = summarizePeriod(p.events, p.unit, p.ctx, `${mm}-01`, `${mm}-31`)
        const weeks = monthWeeks(p.year, m)
        return (
          <button key={m} type="button" className="year-month" onClick={() => p.onMonth(m)} aria-label={`${m}월 ${s.tradingDays ? compact(s.total, p.unit) : '거래 없음'}`}>
            <span className="row tight">
              <b>{m}월</b>
              <span className={`num push-right ${s.tradingDays ? toneClass(s.total) : 'faint'}`}>{s.tradingDays ? compact(s.total, p.unit) : '—'}</span>
            </span>
            <span className="mini-heat" style={{ gridTemplateRows: `repeat(${rows}, 1fr)`, gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }} aria-hidden="true">
              {weeks.flatMap((w, wi) =>
                w.slice(0, rows).map((d, di) => {
                  const b = d.inMonth ? p.buckets.get(d.date) : undefined
                  return (
                    <i
                      key={d.date}
                      className={`mini-cell${d.inMonth ? '' : ' out'}`}
                      style={{ gridColumn: wi + 1, gridRow: di + 1, ...(b && b.trades ? heatStyle(b.value, p.maxAbs) : {}) }}
                      title={b && b.trades ? `${md(d.date)} ${compact(b.value, p.unit)}` : undefined}
                    />
                  )
                }),
              )}
            </span>
            <span className="small faint">{s.tradingDays ? `${s.tradingDays}일 · 승률 ${s.winRate === null ? '—' : Math.round(s.winRate * 100) + '%'}` : ' '}</span>
          </button>
        )
      })}
    </div>
  )
}
