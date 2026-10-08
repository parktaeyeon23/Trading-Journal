import { useState } from 'react'
import { addDays } from '../../core/calendar'
import { useData } from '../../data/dataStore'
import { readDailyNote, saveDailyNote } from '../../data/notes'
import { DONT_RULES } from '../../data/trades'
import { hrefFor } from '../../ui/routes'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { longDate, todayKst } from '../calendar/calText'

export function DailyNoteEditor({ date }: { date: string }) {
  const data = useRepoQuery(
    async (r) => ({
      date,
      note: await readDailyNote(r, date),
      donts: (await r.list('Rules')).filter((x) => x.setup === DONT_RULES && x.active !== false),
    }),
    [date],
  )
  // The previous day's result lingers until this day's read lands; wait for the right one.
  if (!data || data.date !== date) return <p className="empty">불러오는 중…</p>
  // Keyed by date (and first load) so moving to another day starts from that day's text.
  return <Editor key={date} date={date} initial={data.note} donts={data.donts.map((d) => ({ id: d.id, text: d.text }))} />
}

function Editor({ date, initial, donts }: { date: string; initial: { premarket?: string | null; postmarket?: string | null } | null; donts: { id: string; text: string }[] }) {
  const repo = useData((s) => s.repo)
  const [pre, setPre] = useState(initial?.premarket ?? '')
  const [post, setPost] = useState(initial?.postmarket ?? '')
  const [savedPre, setSavedPre] = useState(initial?.premarket ?? '')
  const [savedPost, setSavedPost] = useState(initial?.postmarket ?? '')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const dirty = pre !== savedPre || post !== savedPost

  async function save() {
    if (!repo || !dirty) return
    await saveDailyNote(repo, date, { premarket: pre.trim() ? pre : null, postmarket: post.trim() ? post : null })
    setSavedPre(pre)
    setSavedPost(post)
    setSavedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
  }

  const today = todayKst()
  return (
    <div className="stack">
      <a href={hrefFor('notes')} className="back-link">
        ‹ 노트
      </a>
      <div className="row tight">
        <a className="icon-btn bordered" href={hrefFor('notes', addDays(date, -1))} aria-label="전날" onClick={() => void save()}>
          ‹
        </a>
        <h1 className="page-title cal-title">{longDate(date)}</h1>
        <a className="icon-btn bordered" href={hrefFor('notes', addDays(date, 1))} aria-label="다음날" onClick={() => void save()}>
          ›
        </a>
        {date !== today && (
          <a className="btn btn-secondary btn-small" href={hrefFor('notes', today)} onClick={() => void save()}>
            오늘
          </a>
        )}
      </div>

      <section className="card stack" aria-labelledby="dont-title">
        <h2 id="dont-title" className="section-title">
          하지 말아야 할 것
        </h2>
        {donts.length ? (
          <ul className="dont-list">
            {donts.map((d) => (
              <li key={d.id}>{d.text}</li>
            ))}
          </ul>
        ) : (
          <p className="help" style={{ margin: 0 }}>
            아직 없습니다. 복기에서 "다음 행동 규칙"을 승격하거나 설정 → 규칙에서 추가하세요.
          </p>
        )}
      </section>

      <section className="card stack">
        <label className="field">
          <span className="field-label">장전 계획</span>
          <textarea
            className="input textarea"
            rows={5}
            value={pre}
            onChange={(e) => setPre(e.target.value)}
            onBlur={() => void save()}
            placeholder={'관심종목: \n국면 판단: 추세장 / 전환 / 횡보\n오늘 할 것·안 할 것:'}
          />
        </label>
        <label className="field">
          <span className="field-label">장후 소감</span>
          <textarea className="input textarea" rows={5} value={post} onChange={(e) => setPost(e.target.value)} onBlur={() => void save()} placeholder="계획대로 했나, 감정은 어땠나" />
        </label>
        <div className="row">
          {savedAt && !dirty && (
            <span className="help" role="status" style={{ margin: 0 }}>
              {savedAt} 저장됨
            </span>
          )}
          {dirty && (
            <span className="help" style={{ margin: 0 }}>
              저장 안 됨
            </span>
          )}
          <button type="button" className="btn btn-primary push-right" onClick={() => void save()} disabled={!dirty}>
            저장
          </button>
        </div>
      </section>
    </div>
  )
}
