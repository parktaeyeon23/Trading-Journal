import { useState } from 'react'
import { useData } from '../../data/dataStore'
import { DONT_RULES } from '../../data/trades'
import type { Tag } from '../../data/types'
import { useRepoQuery } from '../../ui/useRepoQuery'

const FAMILIES: { v: Tag['family']; label: string; help: string }[] = [
  { v: 'setup', label: '셋업', help: '계획의 셋업 목록. 이름이 셋업별 체크리스트 규칙과 연결됩니다.' },
  { v: 'mistake', label: '실수', help: '복기에서 고르는 실수. 분석 탭에서 실수별 비용으로 집계됩니다.' },
  { v: 'emotion', label: '감정', help: '진입·보유·청산 단계별 감정.' },
  { v: 'reason', label: '근거', help: '계획에서 고르는 진입 근거. 분석 탭에서 근거별 성과로 집계됩니다.' },
]

export function TagsCard() {
  const repo = useData((s) => s.repo)
  const tags = useRepoQuery((r) => r.list('Tags'), []) ?? []
  const [family, setFamily] = useState<Tag['family']>('setup')
  const [name, setName] = useState('')
  const list = tags.filter((t) => t.family === family).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const meta = FAMILIES.find((f) => f.v === family)!

  async function add() {
    const n = name.trim()
    if (!repo || !n || list.some((t) => t.name === n)) return
    await repo.put('Tags', { family, name: n })
    setName('')
  }

  return (
    <section className="card stack" aria-labelledby="tags-title">
      <div className="row wrap">
        <h2 id="tags-title" className="section-title">
          태그
        </h2>
        <div className="seg seg-small push-right" role="group" aria-label="태그 종류">
          {FAMILIES.map((f) => (
            <button key={f.v} type="button" aria-pressed={family === f.v} onClick={() => setFamily(f.v)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="help" style={{ margin: 0 }}>
        {meta.help}
      </p>
      <ul className="edit-list">
        {list.map((t) => (
          <EditableRow key={t.id} value={t.name} onRename={(v) => repo?.put('Tags', { id: t.id, name: v })} onDelete={() => repo?.remove('Tags', t.id)} confirmText={`"${t.name}" 태그를 삭제할까요? 지난 복기에 붙은 기록은 남습니다.`} />
        ))}
      </ul>
      <div className="input-group">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder={`새 ${meta.label} 태그`} aria-label={`새 ${meta.label} 태그`} />
        <button type="button" className="btn btn-secondary" onClick={() => void add()} disabled={!name.trim()}>
          추가
        </button>
      </div>
    </section>
  )
}

export function RulesCard() {
  const repo = useData((s) => s.repo)
  const data = useRepoQuery(async (r) => ({ rules: await r.list('Rules'), setups: (await r.list('Tags')).filter((t) => t.family === 'setup').map((t) => t.name) }), [])
  const [setup, setSetup] = useState<string>('')
  const [text, setText] = useState('')
  if (!data) return null
  const options = [...data.setups.sort((a, b) => a.localeCompare(b, 'ko')), DONT_RULES]
  const current = options.includes(setup) ? setup : options[0]
  const list = data.rules.filter((r) => r.setup === current)

  async function add() {
    const t = text.trim()
    if (!repo || !t) return
    await repo.put('Rules', { setup: current, text: t, active: true })
    setText('')
  }

  return (
    <section className="card stack" aria-labelledby="rules-title">
      <div className="row wrap">
        <h2 id="rules-title" className="section-title">
          규칙
        </h2>
        <select className="input push-right compact-select" value={current} onChange={(e) => setSetup(e.target.value)} aria-label="규칙 묶음">
          {options.map((o) => (
            <option key={o} value={o}>
              {o === DONT_RULES ? '하지 말아야 할 것' : `${o} 체크리스트`}
            </option>
          ))}
        </select>
      </div>
      <p className="help" style={{ margin: 0 }}>
        {current === DONT_RULES
          ? '복기의 "다음 행동 규칙"에서 승격한 항목입니다. 노트의 장전 체크에 표시됩니다.'
          : `"${current}" 셋업 트레이드를 복기할 때 공통 3개 항목(진입가·사이즈·손절)에 더해 체크합니다. 끈 규칙은 새 복기에 나오지 않습니다.`}
      </p>
      <ul className="edit-list">
        {list.map((r) => (
          <EditableRow
            key={r.id}
            value={r.text}
            active={r.active !== false}
            onToggle={() => repo?.put('Rules', { id: r.id, active: r.active === false })}
            onRename={(v) => repo?.put('Rules', { id: r.id, text: v })}
            onDelete={() => repo?.remove('Rules', r.id)}
            confirmText="이 규칙을 삭제할까요?"
          />
        ))}
        {!list.length && <li className="help">아직 없습니다.</li>}
      </ul>
      <div className="input-group">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="새 규칙" aria-label="새 규칙" />
        <button type="button" className="btn btn-secondary" onClick={() => void add()} disabled={!text.trim()}>
          추가
        </button>
      </div>
    </section>
  )
}

function EditableRow(props: {
  value: string
  active?: boolean
  onToggle?: () => unknown
  onRename: (v: string) => unknown
  onDelete: () => unknown
  confirmText: string
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(props.value)
  const commit = () => {
    const t = v.trim()
    if (t && t !== props.value) props.onRename(t)
    setEditing(false)
  }
  return (
    <li className={props.active === false ? 'inactive' : ''}>
      {props.onToggle && <input type="checkbox" checked={props.active !== false} onChange={() => props.onToggle?.()} aria-label="사용" />}
      {editing ? (
        <input className="input" value={v} autoFocus onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      ) : (
        <button type="button" className="link-btn" onClick={() => setEditing(true)} title="눌러서 이름 바꾸기">
          {props.value}
        </button>
      )}
      <button type="button" className="icon-btn small-icon push-right" aria-label="삭제" onClick={() => window.confirm(props.confirmText) && props.onDelete()}>
        ✕
      </button>
    </li>
  )
}
