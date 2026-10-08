import { goalProgress, rangeR } from '../../core/goals'
import { formatR } from '../../core/format'
import { hrefFor } from '../../ui/routes'
import { useRisk } from './risk'

/**
 * Monthly R against the goal. Uses every trade (calendar filters don't apply:
 * the goal is for the whole account). Hidden when no goal is set.
 */
export function GoalBar({ from, to, label }: { from: string; to: string; label: string }) {
  const risk = useRisk()
  const goal = risk?.goals.monthlyR ?? null
  if (!risk || !goal) return null
  const { r, missing } = rangeR(risk.events, from, to)
  const pct = goalProgress(r, goal) ?? 0
  const reached = r >= goal
  return (
    <div className="goal-bar">
      <div className="row wrap tight">
        <span className="field-label">{label} 목표</span>
        <span className={`num strong ${r > 0 ? 'profit' : r < 0 ? 'loss' : ''}`}>{formatR(r)}</span>
        <span className="num faint">/ +{goal}R</span>
        <span className="small faint push-right">
          {reached ? '목표 달성' : `${Math.round(pct * 100)}%`}
          {missing > 0 && ` · R 없는 ${missing}건 제외`}
        </span>
      </div>
      <div className="goal-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label={`${label} R 목표 진행`}>
        <span className="goal-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <a className="small" href={hrefFor('settings')}>
        목표 바꾸기
      </a>
    </div>
  )
}
