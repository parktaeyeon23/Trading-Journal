import { useState } from 'react'
import { gradeExecution, type GradeBands } from '../../core/grade'
import { autoChecks, BUILTIN_CHECK_LABELS, BUILTIN_CHECKS } from '../../core/trade'
import { exitChartCount } from '../../data/charts'
import { useData } from '../../data/dataStore'
import { readSetting, SETTING_KEYS } from '../../data/settings'
import { rulesForSetup, saveReview, type TradeBundle } from '../../data/trades'
import type { Tag } from '../../data/types'
import { GradeBadge } from '../../ui/TradeBits'
import { useRepoQuery } from '../../ui/useRepoQuery'


type Phase = 'entry' | 'hold' | 'exit'
const PHASES: { v: Phase; label: string }[] = [
  { v: 'entry', label: '진입 시' },
  { v: 'hold', label: '보유 중' },
  { v: 'exit', label: '청산 시' },
]

export function ReviewForm({ trade }: { trade: TradeBundle }) {
  const repo = useData((s) => s.repo)
  const uploads = useData((s) => s.uploads)
  const pending = useRepoQuery(async () => (uploads ? uploads.list(trade.position.id) : []), [uploads, trade.position.id])
  const data = useRepoQuery(
    async (r) => ({
      rules: rulesForSetup(await r.list('Rules'), trade.position.setup),
      tags: await r.list('Tags'),
      bands: await readSetting<GradeBands>(r, SETTING_KEYS.gradeBands, { A: 1, B: 0.8, C: 0.6 }),
    }),
    [trade.position.setup],
  )

  const auto = autoChecks({ direction: trade.position.direction, originalStop: trade.position.original_stop, plan: trade.plan, fills: trade.fills })
  const saved = (trade.review?.checklist ?? null) as Record<string, boolean> | null
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    if (saved) return { ...saved }
    const init: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(auto)) if (v !== null) init[k] = v
    return init
  })
  // Emotion tags always carry a phase; mistake tags never do.
  const [mistakes, setMistakes] = useState<Set<string>>(() => new Set(trade.tags.filter((t) => !t.phase).map((t) => t.tag_id)))
  const [emotions, setEmotions] = useState<Set<string>>(() => new Set(trade.tags.filter((t) => t.phase).map((t) => `${t.tag_id}|${t.phase}`)))
  const [phase, setPhase] = useState<Phase>('entry')
  const [good, setGood] = useState(trade.review?.good ?? '')
  const [improve, setImprove] = useState(trade.review?.improve ?? '')
  const [nextRule, setNextRule] = useState(trade.review?.next_rule ?? '')
  const [promote, setPromote] = useState(!!trade.review?.promoted_rule)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  if (!data) return null
  const items: { id: string; label: string; auto: boolean | null }[] = [
    ...Object.values(BUILTIN_CHECKS).map((id) => ({ id, label: BUILTIN_CHECK_LABELS[id], auto: auto[id] })),
    ...data.rules.map((r) => ({ id: r.id, label: r.text, auto: null })),
  ]
  const answered = Object.fromEntries(items.filter((i) => i.id in checks).map((i) => [i.id, checks[i.id]]))
  const allAnswered = items.every((i) => i.id in checks)
  // A review needs at least one exit-slot chart (uploaded, linked or waiting to upload).
  const exitMissing = exitChartCount(trade.charts, pending ?? []) === 0
  const canSave = allAnswered && !exitMissing
  const result = gradeExecution(answered, !!trade.position.no_plan, data.bands)
  const mistakeTags = data.tags.filter((t) => t.family === 'mistake')
  const emotionTags = data.tags.filter((t) => t.family === 'emotion')

  async function save() {
    if (!repo || !canSave) return
    await saveReview(repo, trade.position.id, {
      checklist: answered,
      grade: result.grade,
      good: good.trim() || null,
      improve: improve.trim() || null,
      next_rule: nextRule.trim() || null,
      promoted_rule: promote && !!nextRule.trim(),
      mistakeTagIds: [...mistakes],
      emotionTags: [...emotions].map((k) => {
        const [tagId, ph] = k.split('|')
        return { tagId, phase: ph as Phase }
      }),
    })
    setSavedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
  }

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }

  return (
    <div className="stack">
      <p className="banner">결정의 질 ≠ 결과 — 계획대로 손절한 트레이드는 손실이어도 좋은 트레이드다.</p>

      <fieldset className="checklist">
        <legend className="field-label">규칙 체크리스트 (필수)</legend>
        {items.map((i) => (
          <div key={i.id} className="check-row">
            <span className="check-label">
              {i.label}
              {i.auto !== null && <span className="chip chip-auto">자동 {i.auto ? '통과' : '미통과'}</span>}
            </span>
            <div className="seg seg-small" role="group" aria-label={i.label}>
              <button type="button" aria-pressed={checks[i.id] === true} onClick={() => setChecks({ ...checks, [i.id]: true })}>
                지킴
              </button>
              <button type="button" aria-pressed={checks[i.id] === false} onClick={() => setChecks({ ...checks, [i.id]: false })}>
                어김
              </button>
            </div>
          </div>
        ))}
      </fieldset>

      <div className="grade-line">
        <GradeBadge grade={allAnswered ? result.grade : null} size="large" />
        <div>
          <div className="field-label">실행 등급 (자동)</div>
          <div className="help" style={{ margin: 0 }}>
            {allAnswered ? `규칙 ${result.passed}/${result.total} 준수` : `${items.length - Object.keys(answered).length}개 항목을 더 체크하세요`}
            {result.capped && ' · 무계획 진입이라 최대 C'}
          </div>
        </div>
      </div>

      <TagPicker label="실수" tags={mistakeTags} isOn={(t) => mistakes.has(t.id)} onToggle={(t) => toggle(mistakes, t.id, setMistakes)} />

      <div className="field">
        <div className="row">
          <span className="field-label">감정</span>
          <div className="seg seg-small push-right" role="group" aria-label="감정 단계">
            {PHASES.map((p) => (
              <button key={p.v} type="button" aria-pressed={phase === p.v} onClick={() => setPhase(p.v)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <TagPicker tags={emotionTags} isOn={(t) => emotions.has(`${t.id}|${phase}`)} onToggle={(t) => toggle(emotions, `${t.id}|${phase}`, setEmotions)} />
      </div>

      <div className="field-pair">
        <label className="field">
          <span className="field-label">잘한 점</span>
          <textarea className="input textarea" rows={3} value={good} onChange={(e) => setGood(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">개선점</span>
          <textarea className="input textarea" rows={3} value={improve} onChange={(e) => setImprove(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">다음 행동 규칙</span>
        <input className="input" value={nextRule} onChange={(e) => setNextRule(e.target.value)} placeholder="2차 진입 직후 손절 올리지 않기" />
      </label>
      <div className="row wrap">
        <label className="row">
          <input type="checkbox" checked={promote} onChange={(e) => setPromote(e.target.checked)} disabled={!nextRule.trim()} />
          "하지 말아야 할 것"으로 승격
        </label>
        <button type="button" className="btn btn-primary push-right" onClick={() => void save()} disabled={!canSave}>
          복기 저장
        </button>
      </div>
      {exitMissing && (
        <p className="help" style={{ margin: 0, textAlign: 'right' }}>
          차트북에 ③ 청산 차트를 올리면 저장할 수 있습니다.
        </p>
      )}
      {savedAt && (
        <p className="notice notice-good" role="status">
          {savedAt} 저장됨
        </p>
      )}
    </div>
  )
}

function TagPicker({ label, tags, isOn, onToggle }: { label?: string; tags: Tag[]; isOn: (t: Tag) => boolean; onToggle: (t: Tag) => void }) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="row wrap">
        {tags.map((t) => (
          <button key={t.id} type="button" className="pill" aria-pressed={isOn(t)} onClick={() => onToggle(t)}>
            {t.name}
          </button>
        ))}
        {!tags.length && <span className="help">설정 → 태그에서 추가하세요.</span>}
      </div>
    </div>
  )
}
