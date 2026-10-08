import { useState } from 'react'
import { addDays, weekStart } from '../../core/calendar'
import { formatR } from '../../core/format'
import { isWritten, parseWeeklyAnswers } from '../../data/notes'
import { hrefFor } from '../../ui/routes'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { useRoute } from '../../ui/useRoute'
import { longDate, md, todayKst, toneClass } from '../calendar/calText'
import { DailyNoteEditor } from './DailyNoteEditor'
import { notesInMonth, notesInWeek, rByDate, snippet, weekStartsOfMonth, yearMonths, type DayR, type NoteLike, type NotesView } from './noteList'
import { loadWeekBase, weekNumbers } from './weekly'
import { WeeklyReviewView } from './WeeklyReviewView'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function NotesScreen() {
  const { param } = useRoute()
  if (param && DATE.test(param)) return <DailyNoteEditor date={param} />
  if (param?.startsWith('week-') && DATE.test(param.slice(5))) return <WeeklyReviewView weekStart={weekStart(param.slice(5))} />
  return <NotesHome />
}

const VIEWS: { v: NotesView; label: string }[] = [
  { v: 'day', label: '일' },
  { v: 'week', label: '주' },
  { v: 'month', label: '월' },
]
const VIEW_KEY = 'aj.notes.view'

function savedView(): NotesView {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'day' || v === 'month' ? v : 'week'
  } catch {
    return 'week'
  }
}

function NotesHome() {
  const today = todayKst()
  const thisWeek = weekStart(today)
  const [view, setViewState] = useState<NotesView>(savedView)
  const [anchor, setAnchor] = useState(today.slice(0, 7)) // 'YYYY-MM'
  const [open, setOpen] = useState<string | null>(thisWeek)
  const setView = (v: NotesView) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }

  const data = useRepoQuery(async (r) => {
    const [notes, reviews, base] = await Promise.all([r.list('DailyNotes'), r.list('WeeklyReviews'), loadWeekBase(r)])
    const parsed = new Map(reviews.map((w) => [w.week_start, parseWeeklyAnswers(w.answers)]))
    return { notes, parsed, base, days: rByDate(base.events) }
  }, [])

  const y = Number(anchor.slice(0, 4))
  const m = Number(anchor.slice(5, 7))
  const step = (d: number) => {
    if (view === 'month') setAnchor(`${y + d}-${anchor.slice(5)}`)
    else {
      const t = new Date(Date.UTC(y, m - 1 + d, 1))
      setAnchor(t.toISOString().slice(0, 7))
    }
  }
  const label = view === 'month' ? `${y}년` : `${y}년 ${m}월`

  return (
    <div className="stack">
      <div className="row wrap">
        <h1 className="page-title">노트</h1>
        <a className="btn btn-primary push-right" href={hrefFor('notes', today)}>
          오늘 노트
        </a>
      </div>

      <div className="cal-toolbar">
        <div className="seg seg-small" role="group" aria-label="보기">
          {VIEWS.map((x) => (
            <button key={x.v} type="button" aria-pressed={view === x.v} onClick={() => setView(x.v)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="row tight">
          <button type="button" className="icon-btn bordered" aria-label="이전" onClick={() => step(-1)}>
            ‹
          </button>
          <b className="period-label">{label}</b>
          <button type="button" className="icon-btn bordered" aria-label="다음" onClick={() => step(1)}>
            ›
          </button>
          {anchor !== today.slice(0, 7) && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setAnchor(today.slice(0, 7))}>
              이번 달
            </button>
          )}
        </div>
      </div>

      {!data ? (
        <p className="empty">불러오는 중…</p>
      ) : view === 'day' ? (
        <DayList notes={notesInMonth(data.notes, anchor)} days={data.days} today={today} />
      ) : view === 'week' ? (
        <section className="card stack-tight" aria-label={`${label} 주간`}>
          {weekStartsOfMonth(y, m)
            .filter((w) => w <= thisWeek)
            .map((w) => {
              const nums = weekNumbers(data.base, w)
              const review = data.parsed.get(w)
              const written = review ? isWritten(review) : false
              const inside = notesInWeek(data.notes, w)
              const isOpen = open === w
              return (
                <div key={w} className="week-group">
                  <button type="button" className="note-row week-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : w)}>
                    <span className="caret" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                    <b>
                      {md(w)} – {md(addDays(w, 6))}
                    </b>
                    {w === thisWeek && <span className="chip chip-auto">이번 주</span>}
                    <span className="small faint">{nums.trades ? `${nums.trades}건` : '거래 없음'}</span>
                    {nums.trades > 0 && <span className={`num small ${toneClass(nums.r)}`}>{formatR(nums.r)}</span>}
                    <span className="small faint">노트 {inside.length}</span>
                    <span className={`chip push-right ${written ? 'chip-done' : ''}`}>{written ? '리뷰 작성' : '리뷰 미작성'}</span>
                  </button>
                  {review?.memo.trim() && !isOpen && <p className="week-memo faint">{review.memo.trim().split('\n')[0]}</p>}
                  {isOpen && (
                    <div className="week-body">
                      {review?.memo.trim() && <p className="week-memo">{review.memo.trim()}</p>}
                      {inside.map((n) => (
                        <NoteLink key={n.date} note={n} days={data.days} />
                      ))}
                      {!inside.length && <p className="help">이 주에 쓴 일간 노트가 없습니다.</p>}
                      <a className="btn btn-secondary btn-small" href={hrefFor('notes', `week-${w}`)}>
                        {written ? '주간 리뷰 보기' : '주간 리뷰 쓰기'} ›
                      </a>
                    </div>
                  )}
                </div>
              )
            })}
        </section>
      ) : (
        <section className="card stack-tight" aria-label={`${y}년 월별`}>
          {yearMonths(y, data.notes, new Set([...data.parsed].filter(([, p]) => isWritten(p)).map(([w]) => w)), data.days)
            .filter((row) => row.key <= today.slice(0, 7))
            .map((row) => (
              <button
                key={row.key}
                type="button"
                className="note-row"
                onClick={() => {
                  setAnchor(row.key)
                  setView('week')
                }}
              >
                <b className="note-date">{row.month}월</b>
                <span className="small faint">{row.trades ? `${row.trades}건` : '거래 없음'}</span>
                {row.trades > 0 && <span className={`num small ${toneClass(row.r)}`}>{formatR(row.r)}</span>}
                <span className="small faint">노트 {row.noteDays}일</span>
                <span className="small faint push-right">
                  주간 리뷰 {row.reviewsWritten}/{row.weeks}
                </span>
              </button>
            ))}
        </section>
      )}
    </div>
  )
}

function DayList({ notes, days, today }: { notes: NoteLike[]; days: Map<string, DayR>; today: string }) {
  if (!notes.length) {
    return (
      <section className="card">
        <p className="help" style={{ margin: 0 }}>
          이 달에 쓴 일간 노트가 없습니다. <a href={hrefFor('notes', today)}>오늘 노트 쓰기</a>
        </p>
      </section>
    )
  }
  return (
    <section className="card stack-tight" aria-label="일간 노트">
      {notes.map((n) => (
        <NoteLink key={n.date} note={n} days={days} />
      ))}
    </section>
  )
}

function NoteLink({ note, days }: { note: NoteLike; days: Map<string, DayR> }) {
  const d = days.get(note.date)
  return (
    <a className="note-row" href={hrefFor('notes', note.date)}>
      <b className="note-date">{longDate(note.date)}</b>
      <span className="note-snippet faint">{snippet(note)}</span>
      {d && d.trades > 0 && <span className={`num small ${toneClass(d.r)}`}>{formatR(d.r)}</span>}
    </a>
  )
}
