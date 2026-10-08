import { useMemo, useState } from 'react'
import { addDays, equityCurve, monthWeeks, summarizePeriod, weekStart } from '../../core/calendar'
import { formatR } from '../../core/format'
import { useFilters, type MarketFilter } from '../../ui/filterStore'
import { navigate } from '../../ui/routes'
import { Sheet } from '../../ui/Sheet'
import { useMedia } from '../../ui/useMedia'
import { useRoute } from '../../ui/useRoute'
import { full, longDate, md, todayKst, toneClass, UNITS } from './calText'
import { DayDetail } from './DayDetail'
import { EquityChart } from './EquityChart'
import { MonthGrid } from './MonthGrid'
import { useCalendarModel } from './useCalendarData'
import { WeekView } from './WeekView'
import { YearView } from './YearView'

type View = 'week' | 'month' | 'year'
const VIEWS: { v: View; label: string }[] = [
  { v: 'week', label: '주' },
  { v: 'month', label: '월' },
  { v: 'year', label: '연' },
]
const MARKETS: { v: MarketFilter; label: string }[] = [
  { v: 'ALL', label: '전체' },
  { v: 'KR', label: 'KR' },
  { v: 'US', label: 'US' },
]
const FAMILY_LABEL = { setup: '셋업 태그', mistake: '실수', emotion: '감정', regime: '국면' } as const

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function CalendarScreen() {
  const route = useRoute()
  const today = todayKst()
  const initial = route.param && /^\d{4}-\d{2}$/.test(route.param) ? `${route.param}-01` : today
  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState(initial)
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const filters = useFilters()
  const { unit, market, basis, showWeekends, setup, tagId, set } = filters
  const model = useCalendarModel()
  const wide = useMedia('(min-width: 1180px)')

  const y = Number(anchor.slice(0, 4))
  const m = Number(anchor.slice(5, 7))
  const mm = anchor.slice(0, 7)
  const range = useMemo(() => {
    if (view === 'week') {
      const s = weekStart(anchor)
      return { from: s, to: addDays(s, 6) }
    }
    if (view === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` }
    return { from: `${mm}-01`, to: `${mm}-${String(lastDayOf(y, m)).padStart(2, '0')}` }
  }, [view, anchor, y, m, mm])

  const weeks = useMemo(() => monthWeeks(y, m), [y, m])
  const summary = useMemo(() => (model ? summarizePeriod(model.events, unit, model.ctx, range.from, range.to) : null), [model, unit, range])
  const curve = useMemo(() => (model ? equityCurve(model.buckets, range.from, range.to) : []), [model, range])
  const maxAbs = useMemo(() => {
    if (!model) return 0
    let mx = 0
    for (const b of model.buckets.values()) if (b.date >= range.from && b.date <= range.to) mx = Math.max(mx, Math.abs(b.value))
    return mx
  }, [model, range])

  if (!model || !summary) return <p className="empty">불러오는 중…</p>

  const step = (d: number) => {
    setSelected(null)
    if (view === 'week') setAnchor(addDays(anchor, 7 * d))
    else if (view === 'year') setAnchor(`${y + d}-${anchor.slice(5, 7)}-01`)
    else {
      const t = new Date(Date.UTC(y, m - 1 + d, 1))
      setAnchor(t.toISOString().slice(0, 10))
    }
  }
  const title = view === 'year' ? `${y}년` : view === 'week' ? `${md(range.from)} – ${md(range.to)}` : `${y}년 ${m}월`
  const setups = [...new Set(model.trades.map((t) => t.position.setup).filter((s): s is string => !!s))].sort()
  const select = (d: string) => setSelected(selected === d ? null : d)
  const openWeek = (start: string) => navigate('notes', `week-${start}`)
  const missingNote =
    summary.missing > 0
      ? unit === 'R'
        ? `손절가·계획 리스크가 없어 R을 못 구한 청산 ${summary.missing}건은 합계에서 뺐습니다.`
        : unit === 'PCT'
          ? `계좌 규모가 설정되지 않은 시장의 청산 ${summary.missing}건은 합계에서 뺐습니다. 설정에서 계좌 규모를 넣으세요.`
          : `환율(USD/KRW)이 없는 날의 청산 ${summary.missing}건은 환산 합계에서 뺐습니다. GAS에서 installMarketTrigger를 한 번 실행하면 채워집니다.`
      : null

  const detail = selected ? <DayDetail date={selected} bucket={model.buckets.get(selected)} events={model.events} byId={model.byId} unit={unit} ctx={model.ctx} /> : null

  return (
    <div className="stack calendar">
      <div className="cal-toolbar">
        <div className="row tight">
          <button type="button" className="icon-btn bordered" aria-label="이전" onClick={() => step(-1)}>
            ‹
          </button>
          <h1 className="page-title cal-title">{title}</h1>
          <button type="button" className="icon-btn bordered" aria-label="다음" onClick={() => step(1)}>
            ›
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAnchor(today)}>
            오늘
          </button>
        </div>
        <div className="seg seg-small" role="group" aria-label="보기">
          {VIEWS.map((x) => (
            <button
              key={x.v}
              type="button"
              aria-pressed={view === x.v}
              onClick={() => {
                setView(x.v)
                setSelected(null)
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="row wrap tight push-right">
          <div className="seg seg-small" role="group" aria-label="단위">
            {UNITS.map((u) => (
              <button key={u.v} type="button" aria-pressed={unit === u.v} onClick={() => set({ unit: u.v })}>
                {u.label}
              </button>
            ))}
          </div>
          <div className="seg seg-small" role="group" aria-label="시장">
            {MARKETS.map((x) => (
              <button key={x.v} type="button" aria-pressed={market === x.v} onClick={() => set({ market: x.v })}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <details className="cal-more">
        <summary>
          필터·표시
          {(setup || tagId || basis === 'entry') && <span className="chip chip-auto">적용 중</span>}
        </summary>
        <div className="row wrap">
          <div className="seg seg-small" role="group" aria-label="기준일">
            <button type="button" aria-pressed={basis === 'exit'} onClick={() => set({ basis: 'exit' })}>
              청산일 기준
            </button>
            <button type="button" aria-pressed={basis === 'entry'} onClick={() => set({ basis: 'entry' })}>
              진입일 기준
            </button>
          </div>
          <select className="input input-small" value={setup ?? ''} onChange={(e) => set({ setup: e.target.value || null })} aria-label="셋업">
            <option value="">모든 셋업</option>
            {setups.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select className="input input-small" value={tagId ?? ''} onChange={(e) => set({ tagId: e.target.value || null })} aria-label="태그">
            <option value="">모든 태그</option>
            {(['mistake', 'emotion', 'setup', 'regime'] as const).map((f) => {
              const tags = model.tags.filter((t) => t.family === f)
              return tags.length ? (
                <optgroup key={f} label={FAMILY_LABEL[f]}>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ) : null
            })}
          </select>
          <label className="row tight">
            <input type="checkbox" checked={showWeekends} onChange={(e) => set({ showWeekends: e.target.checked })} />
            주말 표시
          </label>
        </div>
      </details>

      <button
        type="button"
        className="summary-bar"
        onClick={() => navigate('analysis', view === 'year' ? String(y) : mm)}
        aria-label={`${title} 요약 — 분석에서 보기`}
      >
        <span className="stat">
          <span className="field-label">실현손익</span>
          <span className={`num stat-v ${toneClass(summary.total)}`}>{summary.total === 0 && summary.missing > 0 ? '—' : full(summary.total, unit)}</span>
        </span>
        <span className="stat">
          <span className="field-label">R 합계</span>
          <span className={`num stat-v ${toneClass(summary.rSum)}`}>{formatR(summary.rSum)}</span>
        </span>
        <span className="stat">
          <span className="field-label">승률 · 손익비</span>
          <span className="num stat-v">
            {summary.winRate === null ? '—' : `${Math.round(summary.winRate * 100)}%`} · {summary.payoff === null ? '—' : summary.payoff.toFixed(1)}
          </span>
        </span>
        <span className="stat">
          <span className="field-label">거래일 · 트레이드</span>
          <span className="num stat-v">
            {summary.tradingDays}일 · {summary.wins + summary.losses}건
          </span>
        </span>
        <span className="stat">
          <span className="field-label">최고 · 최악의 날</span>
          <span className="stat-days">
            {summary.best ? (
              <>
                {md(summary.best.date)} <span className="num profit">{full(summary.best.value, unit)}</span>
              </>
            ) : (
              '—'
            )}
            <br />
            {summary.worst ? (
              <>
                {md(summary.worst.date)} <span className="num loss">{full(summary.worst.value, unit)}</span>
              </>
            ) : (
              '—'
            )}
          </span>
        </span>
        <span className="summary-link">분석 ›</span>
      </button>
      {missingNote && (
        <p className="notice notice-warn" role="status">
          {missingNote}
        </p>
      )}

      <div className={`cal-main${wide && view === 'month' ? ' with-aside' : ''}`}>
        <section className="card cal-body">
          {view === 'month' && (
            <>
              <MonthGrid
                weeks={weeks}
                buckets={model.buckets}
                unit={unit}
                showWeekends={showWeekends}
                noteDates={model.noteDates}
                maxAbs={maxAbs}
                today={today}
                selected={selected}
                highlight={hover}
                onSelect={select}
                onHover={setHover}
                onWeek={openWeek}
              />
              <div className="cal-legend">
                <span>
                  <i className="legend-swatch profit-bg" /> 수익
                </span>
                <span>
                  <i className="legend-swatch loss-bg" /> 손실
                </span>
                <span>진할수록 그 달 최대 손익에 가까움 · {basis === 'exit' ? '청산일' : '진입일'} 기준 · US는 미국 거래일</span>
              </div>
            </>
          )}
          {view === 'week' && (
            <WeekView
              start={range.from}
              days={showWeekends ? 7 : 5}
              buckets={model.buckets}
              events={model.events}
              byId={model.byId}
              unit={unit}
              ctx={model.ctx}
              noteDates={model.noteDates}
              today={today}
              onSelect={select}
            />
          )}
          {view === 'year' && (
            <YearView
              year={y}
              buckets={model.buckets}
              events={model.events}
              unit={unit}
              ctx={model.ctx}
              showWeekends={showWeekends}
              maxAbs={maxAbs}
              onMonth={(month) => {
                setAnchor(`${y}-${String(month).padStart(2, '0')}-01`)
                setView('month')
              }}
            />
          )}
          {view === 'week' && (
            <button type="button" className="btn btn-secondary" onClick={() => openWeek(range.from)}>
              이 주의 주간 리뷰 ›
            </button>
          )}
        </section>
        {wide && view === 'month' && <aside className="card cal-aside">{detail ?? <p className="help">날짜를 누르면 그날 트레이드·지수·노트가 여기에 보입니다.</p>}</aside>}
      </div>

      <EquityChart points={curve} unit={unit} title={`누적 손익 · ${title}`} highlight={hover ?? selected} onHover={setHover} />

      {selected && !(wide && view === 'month') && (
        <Sheet title={longDate(selected)} onClose={() => setSelected(null)}>
          {detail}
        </Sheet>
      )}
    </div>
  )
}
