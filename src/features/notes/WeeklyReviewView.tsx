import { useState } from 'react'
import { addDays } from '../../core/calendar'
import { formatMoney, formatR } from '../../core/format'
import { useData } from '../../data/dataStore'
import { mergeQuestions, readWeeklyQuestions, readWeeklyReview, saveWeeklyReview, type WeeklyAnswer } from '../../data/notes'
import { hrefFor } from '../../ui/routes'
import { PnlText } from '../../ui/TradeBits'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { md, toneClass } from '../calendar/calText'
import { loadWeekBase, weekNumbers, type WeekNumbers } from './weekly'

export function WeeklyReviewView({ weekStart }: { weekStart: string }) {
  const data = useRepoQuery(
    async (r) => {
      const [base, review, template] = await Promise.all([loadWeekBase(r), readWeeklyReview(r, weekStart), readWeeklyQuestions(r)])
      const nums = weekNumbers(base, weekStart)
      return { weekStart, nums, answers: mergeQuestions(template, review.answers), saved: !!review.row }
    },
    [weekStart],
  )
  const end = addDays(weekStart, 6)
  return (
    <div className="stack">
      <a href={hrefFor('notes')} className="back-link">
        ‹ 노트
      </a>
      <div className="row tight">
        <a className="icon-btn bordered" href={hrefFor('notes', `week-${addDays(weekStart, -7)}`)} aria-label="지난주">
          ‹
        </a>
        <h1 className="page-title cal-title">
          주간 리뷰 {md(weekStart)} – {md(end)}
        </h1>
        <a className="icon-btn bordered" href={hrefFor('notes', `week-${addDays(weekStart, 7)}`)} aria-label="다음 주">
          ›
        </a>
      </div>
      {data && data.weekStart === weekStart ? (
        <>
          <Numbers n={data.nums} />
          <Answers key={weekStart} weekStart={weekStart} initial={data.answers} />
        </>
      ) : (
        <p className="empty">불러오는 중…</p>
      )}
    </div>
  )
}

function Numbers({ n }: { n: WeekNumbers }) {
  return (
    <section className="card stack" aria-labelledby="wk-auto">
      <div className="row">
        <h2 id="wk-auto" className="section-title">
          이번 주 숫자
        </h2>
        <span className="chip chip-auto">자동</span>
      </div>
      {n.trades === 0 ? (
        <p className="help" style={{ margin: 0 }}>
          이 주에 청산된 트레이드가 없습니다.
        </p>
      ) : (
        <dl className="tiles">
          <div className="tile">
            <dt>손익 (원화 환산)</dt>
            <dd className={`num ${toneClass(n.krw)}`}>{formatMoney(n.krw, 'KRW')}</dd>
          </div>
          <div className="tile">
            <dt>KR · US</dt>
            <dd className="num">
              <PnlText value={n.KR} kind="money" currency="KRW" /> · <PnlText value={n.US} kind="money" currency="USD" />
            </dd>
          </div>
          <div className="tile">
            <dt>R 합계 · 트레이드</dt>
            <dd className={`num ${toneClass(n.r)}`}>
              {formatR(n.r)} · {n.trades}건
            </dd>
          </div>
          <div className="tile">
            <dt>규칙 준수율</dt>
            <dd className="num">{n.adherence === null ? '복기 없음' : `${Math.round(n.adherence * 100)}%`}</dd>
          </div>
        </dl>
      )}
      {n.krwMissing > 0 && <p className="help">환율이 없는 날의 US 청산 {n.krwMissing}건은 원화 합계에서 뺐습니다.</p>}
      <div>
        <div className="field-label">최다 실수 Top 3</div>
        {n.mistakeNames.length ? (
          <ol className="mistake-list">
            {n.mistakeNames.map((m) => (
              <li key={m.name}>
                {m.name} <span className="faint num">{m.count}회</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="help" style={{ margin: 0 }}>
            태그된 실수가 없습니다.
          </p>
        )}
      </div>
    </section>
  )
}

function Answers({ weekStart, initial }: { weekStart: string; initial: WeeklyAnswer[] }) {
  const repo = useData((s) => s.repo)
  const [answers, setAnswers] = useState(initial)
  const [saved, setSaved] = useState(JSON.stringify(initial))
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const dirty = JSON.stringify(answers) !== saved

  async function save() {
    if (!repo || !dirty) return
    await saveWeeklyReview(repo, weekStart, answers)
    setSaved(JSON.stringify(answers))
    setSavedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
  }

  return (
    <section className="card stack" aria-label="주간 리뷰 답변">
      {answers.map((x, i) => (
        <label key={x.q} className="field">
          <span className="field-label">{x.q}</span>
          <textarea
            className="input textarea"
            rows={3}
            value={x.a}
            onChange={(e) => setAnswers(answers.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)))}
            onBlur={() => void save()}
          />
        </label>
      ))}
      <div className="row">
        {savedAt && !dirty && (
          <span className="help" role="status" style={{ margin: 0 }}>
            {savedAt} 저장됨
          </span>
        )}
        <a className="small" href={hrefFor('settings')}>
          질문 편집 (설정)
        </a>
        <button type="button" className="btn btn-primary push-right" onClick={() => void save()} disabled={!dirty}>
          저장
        </button>
      </div>
    </section>
  )
}
