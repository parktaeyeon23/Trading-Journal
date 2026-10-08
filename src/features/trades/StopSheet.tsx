import { useState } from 'react'
import { formatPrice, parseAmount } from '../../core/format'
import { useData } from '../../data/dataStore'
import { moveStop, type TradeBundle } from '../../data/trades'
import { Sheet } from '../../ui/Sheet'
import { currencyOf } from '../../ui/tradeText'

export function StopSheet({ trade, onClose }: { trade: TradeBundle; onClose: () => void }) {
  const repo = useData((s) => s.repo)
  const currency = currencyOf(trade.position.market)
  const [stopText, setStopText] = useState(trade.currentStop ? formatPrice(trade.currentStop, currency) : '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!repo) return
    const v = parseAmount(stopText)
    if (!(v > 0)) return setError('새 손절가를 입력하세요.')
    if (v === trade.currentStop) return setError('지금 손절가와 같습니다.')
    await moveStop(repo, trade.position.id, v, reason.trim() || null)
    onClose()
  }

  return (
    <Sheet title="손절 이동" onClose={onClose}>
      <div className="stack">
        <p className="help" style={{ margin: 0 }}>
          지금 손절 <span className="num">{trade.currentStop ? formatPrice(trade.currentStop, currency) : '—'}</span> · R 계산은 원 손절가{' '}
          <span className="num">{trade.position.original_stop ? formatPrice(trade.position.original_stop, currency) : '—'}</span> 기준으로 유지됩니다.
        </p>
        <label className="field">
          <span className="field-label">새 손절가</span>
          <input className="input num big-input" inputMode="decimal" value={stopText} onChange={(e) => setStopText(e.target.value)} />
        </label>
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
          손절 이동 저장
        </button>
      </div>
    </Sheet>
  )
}
