import { useState } from 'react'
import { addDays, weekStart } from '../../core/calendar'
import { formatR } from '../../core/format'
import { readWeeklyReview } from '../../data/notes'
import { hrefFor } from '../../ui/routes'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { useRoute } from '../../ui/useRoute'
import { longDate, md, todayKst, toneClass } from '../calendar/calText'
import { DailyNoteEditor } from './DailyNoteEditor'
import { loadWeekBase, weekNumbers } from './weekly'
import { WeeklyReviewView } from './WeeklyReviewView'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const WEEKS_SHOWN = 8
const NOTES_PAGE = 30

export function NotesScreen() {
  const { param } = useRoute()
  if (param && DATE.test(param)) return <DailyNoteEditor date={param} />
  if (param?.startsWith('week-') && DATE.test(param.slice(5))) return <WeeklyReviewView weekStart={weekStart(param.slice(5))} />
  return <NotesHome />
}

function NotesHome() {
  const today = todayKst()
  const thisWeek = weekStart(today)
  const [shown, setShown] = useState(NOTES_PAGE)
  const data = useRepoQuery(async (r) => {
    const notes = (await r.list('DailyNotes')).filter((n) => (n.premarket ?? '').trim() || (n.postmarket ?? '').trim()).sort((a, b) => (a.date < b.date ? 1 : -1))
    const base = await loadWeekBase(r)
    const weeks = []
    for (let i = 0; i < WEEKS_SHOWN; i++) {
      const start = addDays(thisWeek, -7 * i)
      const review = await readWeeklyReview(r, start)
      weeks.push({ start, nums: weekNumbers(base, start), written: review.answers.some((a) => a.a.trim()) })
    }
    return { notes, weeks }
  }, [thisWeek])

  return (
    <div className="stack">
      <div className="row wrap">
        <h1 className="page-title">노트</h1>
        <a className="btn btn-primary push-right" href={hrefFor('notes', today)}>
          오늘 노트
        </a>
      </div>

      <section className="card stack-tight" aria-labelledby="weeks-title">
        <h2 id="weeks-title" className="section-title">
          주간 리뷰
        </h2>
        {data?.weeks.map((w) => (
          <a key={w.start} className="note-row" href={hrefFor('notes', `week-${w.start}`)}>
            <span>
              <b>
                {md(w.start)} – {md(addDays(w.start, 6))}
              </b>
              {w.start === thisWeek && <span className="chip chip-auto">이번 주</span>}
            </span>
            <span className="small faint">{w.nums.trades ? `${w.nums.trades}건` : '거래 없음'}</span>
            {w.nums.trades > 0 && <span className={`num small ${toneClass(w.nums.r)}`}>{formatR(w.nums.r)}</span>}
            <span className={`chip push-right ${w.written ? 'chip-done' : ''}`}>{w.written ? '작성함' : '미작성'}</span>
          </a>
        ))}
      </section>

      <section className="card stack-tight" aria-labelledby="daily-title">
        <h2 id="daily-title" className="section-title">
          일간 노트
        </h2>
        {data && !data.notes.length && (
          <p className="help" style={{ margin: 0 }}>
            아직 노트가 없습니다. "오늘 노트"로 장전 계획부터 써 보세요.
          </p>
        )}
        {data?.notes.slice(0, shown).map((n) => (
          <a key={n.id} className="note-row" href={hrefFor('notes', n.date)}>
            <b className="note-date">{longDate(n.date)}</b>
            <span className="note-snippet faint">{(n.premarket || n.postmarket || '').split('\n')[0]}</span>
          </a>
        ))}
        {data && data.notes.length > shown && (
          <button type="button" className="btn btn-secondary" onClick={() => setShown((s) => s + NOTES_PAGE)}>
            더 보기 ({data.notes.length - shown})
          </button>
        )}
      </section>
    </div>
  )
}
