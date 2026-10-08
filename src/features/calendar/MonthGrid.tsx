import { formatR } from '../../core/format'
import { sumDays, type CalDay, type CalUnit, type DayBucket } from '../../core/calendar'
import { PencilIcon } from '../../ui/icons'
import { useMedia } from '../../ui/useMedia'
import { compact, heatStyle, md, toneClass, WEEKDAYS } from './calText'

interface MonthGridProps {
  weeks: CalDay[][]
  buckets: Map<string, DayBucket>
  unit: CalUnit
  showWeekends: boolean
  noteDates: Set<string>
  maxAbs: number
  today: string
  selected: string | null
  highlight: string | null
  onSelect: (date: string) => void
  onHover: (date: string | null) => void
  onWeek: (weekStart: string) => void
}

export function MonthGrid(p: MonthGridProps) {
  const narrow = useMedia('(max-width: 600px)')
  const cols = p.showWeekends ? 7 : 5
  const style = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr)) minmax(0, 1.1fr)` }
  return (
    <div className="month-grid" role="grid" aria-label="월 캘린더">
      <div className="month-row month-head" role="row" style={style}>
        {WEEKDAYS.slice(0, cols).map((d) => (
          <div key={d} role="columnheader" className="month-dow">
            {d}
          </div>
        ))}
        <div role="columnheader" className="month-dow month-dow-week">
          주간 합계
        </div>
      </div>
      {p.weeks.map((week) => {
        const days = week.slice(0, cols)
        const sum = sumDays(p.buckets, week.map((d) => d.date))
        return (
          <div key={week[0].date} className="month-row" role="row" style={style}>
            {days.map((d) => {
              const b = p.buckets.get(d.date)
              const has = !!b && b.trades > 0
              const classes = ['day-cell', d.inMonth ? '' : 'out', p.selected === d.date ? 'selected' : '', p.highlight === d.date ? 'hl' : '']
              return (
                <button
                  key={d.date}
                  type="button"
                  role="gridcell"
                  className={classes.filter(Boolean).join(' ')}
                  style={has && d.inMonth ? heatStyle(b.value, p.maxAbs) : undefined}
                  onClick={() => p.onSelect(d.date)}
                  onMouseEnter={() => p.onHover(d.date)}
                  onMouseLeave={() => p.onHover(null)}
                  aria-label={`${md(d.date)}${has ? ` ${compact(b.value, p.unit)}, ${b.trades}건` : ''}`}
                  aria-pressed={p.selected === d.date}
                >
                  <span className="day-top">
                    <span className={`day-num${p.today === d.date ? ' today' : ''}`}>{Number(d.date.slice(8))}</span>
                    {p.noteDates.has(d.date) && <PencilIcon size={12} className="day-note" aria-label="노트 있음" />}
                    {has && <span className="day-count">{b.trades}건</span>}
                  </span>
                  {has && (
                    <>
                      <span className="day-val num">{b.missing && !b.value ? '—' : compact(b.value, p.unit, narrow)}</span>
                      {p.unit !== 'R' && b.r !== 0 && <span className="day-r num">{formatR(b.r)}</span>}
                      <span className="day-dots" aria-hidden="true">
                        {Array.from({ length: Math.min(b.wins, 4) }, (_, i) => (
                          <i key={`w${i}`} className="dot win" />
                        ))}
                        {Array.from({ length: Math.min(b.losses, 4) }, (_, i) => (
                          <i key={`l${i}`} className="dot lose" />
                        ))}
                      </span>
                    </>
                  )}
                </button>
              )
            })}
            <button type="button" role="gridcell" className="week-cell" onClick={() => p.onWeek(week[0].date)} aria-label={`${md(week[0].date)} 주 주간 리뷰`}>
              <span className="week-label">
                {md(week[0].date)} – {md(week[cols - 1].date)}
              </span>
              {sum.trades > 0 ? (
                <>
                  <span className={`week-val num ${toneClass(sum.value)}`}>{compact(sum.value, p.unit, narrow)}</span>
                  {p.unit !== 'R' && <span className="day-r num faint">{formatR(sum.r)}</span>}
                </>
              ) : (
                <span className="week-val num faint">—</span>
              )}
              <span className="week-link">리뷰 ›</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
