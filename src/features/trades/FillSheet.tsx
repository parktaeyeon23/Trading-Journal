import { useMemo, useState } from 'react'
import { defaultFees } from '../../core/fees'
import { formatPrice, parseAmount } from '../../core/format'
import { entrySide } from '../../core/pnl'
import { pyramidState } from '../../core/pyramid'
import { useData } from '../../data/dataStore'
import { readSetting, SETTING_KEYS } from '../../data/settings'
import { addFill, createUnplannedTrade, type TradeBundle } from '../../data/trades'
import type { Market, Position } from '../../data/types'
import { navigate } from '../../ui/routes'
import { EntryRiskNotice } from '../goals/RiskBanner'
import { Sheet } from '../../ui/Sheet'
import { currencyOf, localDateTimeValue } from '../../ui/tradeText'
import { useRepoQuery } from '../../ui/useRepoQuery'

const nowIso = () => new Date().toISOString()

interface Props {
  /** Existing trade; omit to start a no-plan trade from its first fill. */
  trade?: TradeBundle
  side?: 'buy' | 'sell'
  onClose: () => void
}

/**
 * Quick fill entry. For an existing trade, price and quantity come prefilled
 * (planned entry and next pyramid stage for entries, open quantity for exits),
 * so a fill that went as planned is one tap to save.
 */
export function FillSheet({ trade, side: sideProp, onClose }: Props) {
  const repo = useData((s) => s.repo)
  const p = trade?.position
  const [market, setMarket] = useState<Market>(p?.market ?? 'KR')
  const [ticker, setTicker] = useState('')
  const [direction, setDirection] = useState<Position['direction']>(p?.direction ?? 'long')
  const side = sideProp ?? entrySide(direction)
  const currency = currencyOf(market)
  const isEntry = side === entrySide(direction)

  const prefill = useMemo(() => {
    if (!trade) return { price: '', qty: '' }
    const s = trade.summary.pnl
    if (!isEntry) {
      const last = trade.fills.at(-1)?.price
      return { price: last ? formatPrice(last, currency) : '', qty: s.openQty ? String(s.openQty) : '' }
    }
    const plan = trade.plan
    const weights = (plan?.pyramid_plan as { weights?: number[] } | undefined)?.weights
    const next = plan?.plan_qty && weights ? pyramidState(plan.plan_qty, weights, trade.fills.filter((f) => f.side === side)).nextQty : null
    const price = s.entryQty === 0 && plan?.plan_entry ? plan.plan_entry : trade.fills.at(-1)?.price
    return { price: price ? formatPrice(price, currency) : '', qty: next ? String(next) : plan?.plan_qty && s.entryQty === 0 ? String(plan.plan_qty) : '' }
  }, [trade, isEntry, side, currency])

  const [priceText, setPriceText] = useState(prefill.price)
  const [qtyText, setQtyText] = useState(prefill.qty)
  const [when, setWhen] = useState(localDateTimeValue())
  // The time field only has minute precision. Untouched, the fill gets the exact
  // save time so fills entered within one minute keep their real order.
  const [whenEdited, setWhenEdited] = useState(false)
  const [feeText, setFeeText] = useState<string | null>(null)
  const [taxText, setTaxText] = useState<string | null>(null)
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const rates = useRepoQuery(
    async (r) => ({
      feePct: await readSetting<number | null>(r, SETTING_KEYS.feeRate(market), null),
      sellTaxPct: await readSetting<number | null>(r, SETTING_KEYS.sellTaxKR, null),
    }),
    [market],
  )
  const price = parseAmount(priceText)
  const qty = parseAmount(qtyText)
  const auto = rates && price > 0 && qty > 0 ? defaultFees(market, side, price, qty, rates) : { fee: null, tax: null }
  const fee = feeText !== null ? parseAmount(feeText) : auto.fee
  const tax = taxText !== null ? parseAmount(taxText) : auto.tax

  async function save() {
    if (!repo) return
    if (!trade && !ticker.trim()) return setError('티커를 입력하세요.')
    if (!(price > 0)) return setError('체결가를 입력하세요.')
    if (!(qty > 0) || !Number.isInteger(qty)) return setError('수량은 1 이상의 정수로 입력하세요.')
    if (trade && !isEntry && qty > trade.summary.pnl.openQty) return setError(`보유 수량(${trade.summary.pnl.openQty})보다 많이 팔 수 없습니다.`)
    const ts = whenEdited ? new Date(when).toISOString() : nowIso()
    const fill = {
      ts,
      side,
      price,
      qty,
      fee: Number.isFinite(fee) ? fee : null,
      tax: Number.isFinite(tax) ? tax : null,
      memo: memo.trim() || null,
    }
    setSaving(true)
    try {
      if (trade) {
        await addFill(repo, trade.position.id, fill)
        onClose()
      } else {
        const created = await createUnplannedTrade(repo, { ticker: ticker.trim().toUpperCase(), market, direction, fill })
        onClose()
        navigate('trades', created.id)
      }
    } finally {
      setSaving(false)
    }
  }

  const title = trade ? `${trade.position.ticker} ${side === 'buy' ? '매수' : '매도'}` : '체결부터 입력 (무계획)'

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack">
        {!trade && (
          <>
            <p className="notice notice-warn">계획 없이 시작하는 포지션은 "무계획 진입"으로 표시되고, 실행 등급은 최대 C입니다.</p>
            <div className="row wrap">
              <div className="seg" role="group" aria-label="마켓">
                {(['KR', 'US'] as Market[]).map((m) => (
                  <button key={m} type="button" aria-pressed={market === m} onClick={() => setMarket(m)}>
                    {m}
                  </button>
                ))}
              </div>
              <div className="seg push-right" role="group" aria-label="방향">
                <button type="button" aria-pressed={direction === 'long'} onClick={() => setDirection('long')}>
                  롱
                </button>
                <button type="button" aria-pressed={direction === 'short'} onClick={() => setDirection('short')}>
                  숏
                </button>
              </div>
            </div>
            <label className="field">
              <span className="field-label">티커</span>
              <input className="input num" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder={market === 'KR' ? '042700' : 'CRDO'} autoCapitalize="characters" />
            </label>
          </>
        )}
        <div className="field-pair">
          <label className="field">
            <span className="field-label">체결가 ({currency})</span>
            <input className="input num big-input" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">수량</span>
            <input className="input num big-input" inputMode="numeric" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
          </label>
        </div>
        <details className="more">
          <summary>시각·수수료·메모</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <label className="field">
              <span className="field-label">체결 시각</span>
              <input
                className="input num"
                type="datetime-local"
                value={when}
                onChange={(e) => {
                  setWhen(e.target.value)
                  setWhenEdited(true)
                }}
              />
            </label>
            <div className="field-pair">
              <label className="field">
                <span className="field-label">수수료</span>
                <input className="input num" inputMode="decimal" value={feeText ?? (auto.fee ?? '').toString()} onChange={(e) => setFeeText(e.target.value)} placeholder="0" />
              </label>
              <label className="field">
                <span className="field-label">세금</span>
                <input className="input num" inputMode="decimal" value={taxText ?? (auto.tax ?? '').toString()} onChange={(e) => setTaxText(e.target.value)} placeholder="0" />
              </label>
            </div>
            {!rates?.feePct && <p className="help">설정 → 매매 설정에 수수료율을 넣으면 자동으로 채워집니다.</p>}
            <label className="field">
              <span className="field-label">메모</span>
              <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </label>
          </div>
        </details>
        {isEntry && <EntryRiskNotice />}
        {error && (
          <p className="notice notice-bad" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-primary btn-block" onClick={() => void save()} disabled={saving}>
          {side === 'buy' ? '매수 저장' : '매도 저장'}
        </button>
      </div>
    </Sheet>
  )
}
