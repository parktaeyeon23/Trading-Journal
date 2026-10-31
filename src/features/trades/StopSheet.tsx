import { useState } from 'react'
import { formatPrice, parseAmount } from '../../core/format'
import { useData } from '../../data/dataStore'
import { moveStop, removeStopMove, updateStopMove, type TradeBundle } from '../../data/trades'
import type { StopChange } from '../../data/types'
import { Sheet } from '../../ui/Sheet'
import { currencyOf, localDateTimeValue } from '../../ui/tradeText'
import { getStickyWhen, isFuture, setStickyWhen } from './stickyWhen'
import { WhenField } from './WhenField'

/** Records a stop move, or corrects a recorded one (`move`). */
export function StopSheet({ trade, move, onClose }: { trade: TradeBundle; move?: StopChange; onClose: () => void }) {
  const repo = useData((s) => s.repo)
  const currency = currencyOf(trade.position.market)
  const [stopText, setStopText] = useState(move ? formatPrice(move.new_stop, currency) : trade.currentStop ? formatPrice(trade.currentStop, currency) : '')
  const [reason, setReason] = useState(move?.reason ?? '')
  const [when, setWhen] = useState(() => (move ? localDateTimeValue(new Date(move.ts)) : (getStickyWhen() ?? localDateTimeValue())))
  const [whenEdited, setWhenEdited] = useState(!move && getStickyWhen() !== null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!repo) return
    const v = parseAmount(stopText)
    if (!(v > 0)) return setError('새 손절가를 입력하세요.')
    if (!move && v === trade.currentStop) return setError('지금 손절가와 같습니다.')
    if (whenEdited && isFuture(when)) return setError('미래 시각으로는 기록할 수 없습니다.')
    const ts = whenEdited ? new Date(when).toISOString() : move ? move.ts : new Date().toISOString()
    if (move) await updateStopMove(repo, move.id, { ts, new_stop: v, reason: reason.trim() || null })
    else await moveStop(repo, trade.position.id, v, reason.trim() || null, ts)
    onClose()
  }

  async function remove() {
    if (!repo || !move || !window.confirm('이 손절 이동 기록을 삭제할까요?')) return
    await removeStopMove(repo, move.id)
    onClose()
  }

  return (
    <Sheet title={move ? '손절 이동 수정' : '손절 이동'} onClose={onClose}>
      <div className="stack">
        <p className="help" style={{ margin: 0 }}>
          지금 손절 <span className="num">{trade.currentStop ? formatPrice(trade.currentStop, currency) : '—'}</span> · R 계산은 원 손절가{' '}
          <span className="num">{trade.position.original_stop ? formatPrice(trade.position.original_stop, currency) : '—'}</span> 기준으로 유지됩니다.
        </p>
        <label className="field">
          <span className="field-label">새 손절가</span>
          <input className="input num big-input" inputMode="decimal" value={stopText} onChange={(e) => setStopText(e.target.value)} />
        </label>
        <WhenField
          label="이동 일시"
          value={when}
          onChange={(v, byHand) => {
            setWhen(v)
            setWhenEdited(byHand)
            if (!move) setStickyWhen(byHand ? v : null)
          }}
        />
        <label className="field">
          <span className="field-label">사유</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="2차 진입 후 본전 근처로" />
        </label>
        {error && (
          <p className="notice notice-bad" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-primary btn-block" onClick={() => void save()}>
          {move ? '수정 저장' : '손절 이동 저장'}
        </button>
        {move && (
          <button type="button" className="btn btn-secondary btn-block danger-outline" onClick={() => void remove()}>
            이 기록 삭제
          </button>
        )}
      </div>
    </Sheet>
  )
}
