import { useState } from 'react'
import { useData } from '../../data/dataStore'
import { readWeeklyQuestions, writeWeeklyQuestions } from '../../data/notes'
import { useRepoQuery } from '../../ui/useRepoQuery'

/** The weekly review template. Answers keep their own question text, so editing never mislabels old reviews. */
export function WeeklyQuestionsCard() {
  const questions = useRepoQuery((r) => readWeeklyQuestions(r), [])
  if (!questions) return null
  return <Editor key={questions.join('\n')} initial={questions} />
}

function Editor({ initial }: { initial: string[] }) {
  const repo = useData((s) => s.repo)
  const [list, setList] = useState(initial)
  const dirty = list.join('\n') !== initial.join('\n')
  const save = () => repo && void writeWeeklyQuestions(repo, list)

  return (
    <section className="card stack" aria-labelledby="wq-title">
      <h2 id="wq-title" className="section-title">
        주간 리뷰 질문
      </h2>
      <p className="help" style={{ margin: 0 }}>
        숫자(손익·R·규칙 준수율·최다 실수)는 자동으로 채워지고, 아래 질문에 직접 답합니다.
      </p>
      {list.map((q, i) => (
        <div key={i} className="input-group">
          <input className="input" value={q} onChange={(e) => setList(list.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`질문 ${i + 1}`} />
          <button type="button" className="btn btn-secondary" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label={`질문 ${i + 1} 삭제`}>
            삭제
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn btn-secondary" onClick={() => setList([...list, ''])}>
          + 질문
        </button>
        <button type="button" className="btn btn-primary push-right" onClick={save} disabled={!dirty || !list.some((q) => q.trim())}>
          저장
        </button>
      </div>
    </section>
  )
}
