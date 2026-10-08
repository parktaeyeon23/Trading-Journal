import { useState } from 'react'
import { formatR } from '../../core/format'
import { useRisk } from './risk'

/**
 * Top-of-app banner when today's or this week's realized loss reaches the
 * limit (red) or 80 % of it (amber). Closing it hides it until the app is
 * opened again.
 */
export function RiskBanner() {
  const risk = useRisk()
  const [hidden, setHidden] = useState<string | null>(null)
  if (!risk?.state.level || risk.state.level === 'ok') return null
  const { state, goals } = risk
  const stop = state.level === 'stop'
  const parts: string[] = []
  if (state.daily && state.daily !== 'ok') parts.push(`오늘 ${formatR(state.today.r)} / 한도 −${goals.dailyLossR}R`)
  if (state.weekly && state.weekly !== 'ok') parts.push(`이번 주 ${formatR(state.week.r)} / 한도 −${goals.weeklyLossR}R`)
  const key = `${state.level}|${parts.join()}`
  if (hidden === key) return null
  return (
    <div className={`risk-banner ${stop ? 'stop' : 'warn'}`} role={stop ? 'alert' : 'status'}>
      <div className="risk-text">
        <b>{stop ? (state.daily === 'stop' ? '오늘 매매 중단' : '이번 주 매매 중단') : '손실 한도에 가까워졌습니다'}</b>
        <span>
          {parts.join(' · ')}
          {stop ? ' — 손실 한도에 도달했습니다. 신규 진입을 멈추세요.' : ' — 신규 진입 전에 한 번 더 확인하세요.'}
        </span>
      </div>
      <button type="button" className="icon-btn" aria-label="배너 닫기" onClick={() => setHidden(key)}>
        ✕
      </button>
    </div>
  )
}

/** Inline reminder for screens that start a new position (calculator, plan, entry fill). */
export function EntryRiskNotice() {
  const risk = useRisk()
  if (!risk?.state.level || risk.state.level === 'ok') return null
  const stop = risk.state.level === 'stop'
  return (
    <p className={`notice ${stop ? 'notice-bad' : 'notice-warn'}`} role="status">
      {stop
        ? `손실 한도에 도달한 상태입니다 (오늘 ${formatR(risk.state.today.r)} · 이번 주 ${formatR(risk.state.week.r)}). 계획에 없던 진입이 아닌지 확인하세요. 이미 체결된 매매라면 그대로 기록하면 됩니다.`
        : `손실 한도의 80%에 가까워졌습니다 (오늘 ${formatR(risk.state.today.r)} · 이번 주 ${formatR(risk.state.week.r)}).`}
    </p>
  )
}
