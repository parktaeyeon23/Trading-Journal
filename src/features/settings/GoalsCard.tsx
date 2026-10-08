import { useState } from 'react'
import { parseAmount } from '../../core/format'
import type { Goals } from '../../core/goals'
import { useData } from '../../data/dataStore'
import { readGoals, writeGoals } from '../../data/goals'
import { useRepoQuery } from '../../ui/useRepoQuery'

/** Monthly R goal and daily / weekly loss limits (all in R). */
export function GoalsCard() {
  const goals = useRepoQuery((r) => readGoals(r), [])
  if (!goals) return null
  return <Form key={JSON.stringify(goals)} initial={goals} />
}

type Text = Record<keyof Goals, string>
const toText = (g: Goals): Text => ({ monthlyR: g.monthlyR?.toString() ?? '', dailyLossR: g.dailyLossR?.toString() ?? '', weeklyLossR: g.weeklyLossR?.toString() ?? '' })

function Form({ initial }: { initial: Goals }) {
  const repo = useData((s) => s.repo)
  const [v, setV] = useState<Text>(toText(initial))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const dirty = JSON.stringify(v) !== JSON.stringify(toText(initial))

  async function save() {
    if (!repo) return
    const num = (s: string) => (s.trim() === '' ? null : parseAmount(s.replace(/[R−-]/gi, '')))
    const g: Goals = { monthlyR: num(v.monthlyR), dailyLossR: num(v.dailyLossR), weeklyLossR: num(v.weeklyLossR) }
    if (Object.values(g).some((x) => x !== null && !(x > 0))) return setMsg({ ok: false, text: '0보다 큰 숫자만 넣으세요. 비우면 끕니다.' })
    if (g.dailyLossR && g.weeklyLossR && g.dailyLossR > g.weeklyLossR) return setMsg({ ok: false, text: '주 한도는 일 한도보다 크거나 같아야 합니다.' })
    await writeGoals(repo, g)
    setMsg({ ok: true, text: '저장했습니다.' })
  }

  const field = (k: keyof Goals, label: string, prefix: string, hint: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="input-affix">
        <span className="affix">{prefix}</span>
        <input className="input num" inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} placeholder={hint} />
        <span className="affix">R</span>
      </span>
    </label>
  )

  return (
    <section className="card stack" aria-labelledby="goals-title">
      <div>
        <h2 id="goals-title" className="section-title">
          목표·손실 한도
        </h2>
        <p className="help">
          한도는 청산으로 확정된 손익(R)만 셉니다. 한도의 80%에서 노란 배너, 도달하면 "오늘 매매 중단" 빨간 배너가 뜹니다. 비우면 끕니다.
        </p>
      </div>
      <div className="field-pair">
        {field('monthlyR', '월 목표', '+', '10')}
        {field('dailyLossR', '일 손실 한도', '−', '3')}
        {field('weeklyLossR', '주 손실 한도', '−', '6')}
      </div>
      <div className="row">
        {msg && (
          <span className={msg.ok ? 'help' : 'notice notice-bad'} role="status" style={{ margin: 0 }}>
            {msg.text}
          </span>
        )}
        <button type="button" className="btn btn-primary push-right" onClick={() => void save()} disabled={!dirty}>
          저장
        </button>
      </div>
    </section>
  )
}
