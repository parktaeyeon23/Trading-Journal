import { useState } from 'react'
import { formatMoney, formatPct, formatPrice, parseAmount } from '../../core/format'
import { PYRAMID_PRESETS, splitStages } from '../../core/pyramid'
import { useData } from '../../data/dataStore'
import { readSetting, SETTING_KEYS } from '../../data/settings'
import { createPlannedTrade, setReasonTags, updatePlan, type TradeBundle } from '../../data/trades'
import type { Market, Position } from '../../data/types'
import { navigate } from '../../ui/routes'
import { Sheet } from '../../ui/Sheet'
import { currencyOf } from '../../ui/tradeText'
import { useRepoQuery } from '../../ui/useRepoQuery'

interface Props {
  /** Editing an existing trade; omit for a new plan. */
  trade?: TradeBundle
  onClose: () => void
}

type Cond = { sleep?: number; stress?: number; conviction?: number }

const REGIMES: { v: NonNullable<Position['regime']>; label: string }[] = [
  { v: 'trend', label: '추세장' },
  { v: 'transition', label: '전환' },
  { v: 'range', label: '횡보' },
]

export function PlanSheet({ trade, onClose }: Props) {
  const repo = useData((s) => s.repo)
  const p = trade?.position
  const plan = trade?.plan
  const cur0 = currencyOf(p?.market ?? 'KR')
  const pp = (plan?.pyramid_plan ?? {}) as { preset?: string }
  const cond0 = (plan?.pre_condition ?? {}) as Cond

  const [market, setMarket] = useState<Market>(p?.market ?? 'KR')
  const [ticker, setTicker] = useState(p?.ticker ?? '')
  const [tickerName, setTickerName] = useState(p?.ticker_name ?? '')
  const [direction, setDirection] = useState<Position['direction']>(p?.direction ?? 'long')
  const [setup, setSetup] = useState(p?.setup ?? '')
  const [regime, setRegime] = useState<Position['regime'] | ''>(p?.regime ?? '')
  const [thesis, setThesis] = useState(plan?.thesis ?? '')
  const [invalidation, setInvalidation] = useState(plan?.invalidation ?? '')
  const [entryText, setEntryText] = useState(plan?.plan_entry ? formatPrice(plan.plan_entry, cur0) : '')
  const [stopText, setStopText] = useState(plan?.plan_stop ? formatPrice(plan.plan_stop, cur0) : '')
  const [qtyText, setQtyText] = useState(plan?.plan_qty ? String(plan.plan_qty) : '')
  const [targetRule, setTargetRule] = useState(plan?.target_rule ?? '')
  const [preset, setPreset] = useState(pp.preset ?? '50/30/20')
  const [cond, setCond] = useState<Cond>(cond0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const tags = useRepoQuery((r) => r.list('Tags'), [])
  const setups = (tags ?? []).filter((t) => t.family === 'setup').map((t) => t.name)
  const reasonTags = (tags ?? []).filter((t) => t.family === 'reason').sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const reasonIds = new Set(reasonTags.map((t) => t.id))
  // null until the user touches a tag: until then the trade's saved reason tags show (once the Tag rows have loaded).
  const [reasons, setReasons] = useState<Set<string> | null>(null)
  const picked = reasons ?? new Set((trade?.tags ?? []).filter((pt) => !pt.phase && reasonIds.has(pt.tag_id)).map((pt) => pt.tag_id))
  const toggleReason = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setReasons(next)
  }
  const chosenReasons = [...picked].filter((id) => reasonIds.has(id))
  const account = useRepoQuery((r) => readSetting<number | null>(r, SETTING_KEYS.accountSize(market), null), [market])

  const entry = parseAmount(entryText)
  const stop = parseAmount(stopText)
  const qty = parseAmount(qtyText)
  const risk = entry > 0 && stop > 0 && qty > 0 ? qty * Math.abs(entry - stop) : null
  const rpt = risk && account ? (risk / account) * 100 : null
  const currency = currencyOf(market)
  const hasFills = !!trade?.fills.length

  async function save() {
    if (!repo) return
    const missing = [
      !ticker.trim() && '티커',
      !setup.trim() && '셋업',
      !thesis.trim() && '진입 근거',
      !invalidation.trim() && '무효화 조건',
      !(entry > 0) && '계획 진입가',
      !(stop > 0) && '손절가',
      !(qty > 0 && Number.isInteger(qty)) && '계획 수량',
    ].filter(Boolean)
    if (missing.length) return setError(`${missing.join(', ')}을(를) 입력하세요.`)
    if ((direction === 'long' && stop >= entry) || (direction === 'short' && stop <= entry)) {
      return setError('손절가가 진입가의 반대편에 있어야 합니다 (롱은 아래, 숏은 위).')
    }
    setSaving(true)
    const weights = PYRAMID_PRESETS[preset]
    const planFields = {
      thesis: thesis.trim(),
      invalidation: invalidation.trim(),
      plan_entry: entry,
      plan_stop: stop,
      plan_qty: qty,
      rpt_pct: rpt,
      risk_amount: risk,
      target_rule: targetRule.trim() || null,
      pyramid_plan: { preset, weights, stages: splitStages(qty, weights) },
      pre_condition: cond,
    }
    const posFields = {
      ticker: ticker.trim().toUpperCase(),
      ticker_name: tickerName.trim() || null,
      market,
      direction,
      setup: setup.trim(),
      regime: regime || null,
    }
    try {
      if (!trade) {
        const created = await createPlannedTrade(repo, { position: { ...posFields, original_stop: stop }, plan: planFields })
        await setReasonTags(repo, created.id, chosenReasons)
        onClose()
        navigate('trades', created.id)
      } else {
        // R is measured from the original stop, so it only follows the plan until the first fill.
        await updatePlan(repo, trade.position, trade.plan, {
          position: hasFills ? posFields : { ...posFields, original_stop: stop },
          plan: planFields,
        })
        await setReasonTags(repo, trade.position.id, chosenReasons)
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet title={trade ? '계획 편집' : '새 계획'} onClose={onClose}>
      <div className="stack">
        <div className="row wrap">
          <div className="seg" role="group" aria-label="마켓">
            {(['KR', 'US'] as Market[]).map((m) => (
              <button key={m} type="button" aria-pressed={market === m} onClick={() => setMarket(m)} disabled={hasFills}>
                {m}
              </button>
            ))}
          </div>
          <div className="seg push-right" role="group" aria-label="방향">
            <button type="button" aria-pressed={direction === 'long'} onClick={() => setDirection('long')} disabled={hasFills}>
              롱
            </button>
            <button type="button" aria-pressed={direction === 'short'} onClick={() => setDirection('short')} disabled={hasFills}>
              숏
            </button>
          </div>
        </div>
        <div className="field-pair">
          <label className="field">
            <span className="field-label">티커 *</span>
            <input className="input num" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder={market === 'KR' ? '042700' : 'CRDO'} autoCapitalize="characters" />
          </label>
          <label className="field">
            <span className="field-label">종목명</span>
            <input className="input" value={tickerName} onChange={(e) => setTickerName(e.target.value)} placeholder={market === 'KR' ? '한미반도체' : 'Credo Technology'} />
          </label>
        </div>
        <div className="field-pair">
          <label className="field">
            <span className="field-label">셋업 *</span>
            <input className="input" list="setup-options" value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="VCP 돌파" />
            <datalist id="setup-options">
              {setups.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="field-label">시장 국면</span>
            <select className="input" value={regime ?? ''} onChange={(e) => setRegime(e.target.value as Position['regime'])}>
              <option value="">선택 안 함</option>
              {REGIMES.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">진입 근거 (thesis) *</span>
          <input className="input" value={thesis} onChange={(e) => setThesis(e.target.value)} placeholder="3주 수축 후 피벗 돌파, 거래량 2배 이상이면 진입" />
        </label>
        <div className="field">
          <span className="field-label">근거 태그</span>
          <div className="row wrap">
            {reasonTags.map((t) => (
              <button key={t.id} type="button" className="pill" aria-pressed={picked.has(t.id)} onClick={() => toggleReason(t.id)}>
                {t.name}
              </button>
            ))}
            {tags && !reasonTags.length && <span className="help">설정 → 태그 → 근거에서 추가하세요.</span>}
          </div>
        </div>
        <label className="field">
          <span className="field-label">무효화 조건 *</span>
          <input className="input" value={invalidation} onChange={(e) => setInvalidation(e.target.value)} placeholder="돌파 당일 저가 이탈 시 thesis 붕괴" />
        </label>
        <div className="field-triple">
          <label className="field">
            <span className="field-label">계획 진입가 *</span>
            <input className="input num" inputMode="decimal" value={entryText} onChange={(e) => setEntryText(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">손절가 * {hasFills && <span className="faint">(R은 원 손절가 고정)</span>}</span>
            <input className="input num" inputMode="decimal" value={stopText} onChange={(e) => setStopText(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">계획 수량 *</span>
            <input className="input num" inputMode="numeric" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
          </label>
        </div>
        <p className="help">
          리스크 {risk !== null ? formatMoney(risk, currency, false) : '—'} · RPT {rpt !== null ? formatPct(rpt) : account ? '—' : '계좌 규모를 계산기에서 저장하면 표시'}
        </p>
        <div className="field-pair">
          <label className="field">
            <span className="field-label">피라미딩</span>
            <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {Object.keys(PYRAMID_PRESETS).map((k) => (
                <option key={k} value={k}>
                  {k === '100' ? '한 번에' : k}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">목표·익절 규칙</span>
            <input className="input" value={targetRule} onChange={(e) => setTargetRule(e.target.value)} placeholder="2R에서 1/3, 10일선 이탈 시 잔량" />
          </label>
        </div>
        <fieldset className="cond">
          <legend className="field-label">장전 컨디션 (1 나쁨 – 5 좋음)</legend>
          {(
            [
              ['sleep', '수면'],
              ['stress', '스트레스 관리'],
              ['conviction', '확신도'],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="cond-row">
              <span>{label}</span>
              <div className="seg seg-small" role="group" aria-label={label}>
                {[1, 2, 3, 4, 5].map((v) => (
                  <button key={v} type="button" aria-pressed={cond[k] === v} onClick={() => setCond((c) => ({ ...c, [k]: c[k] === v ? undefined : v }))}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        {error && (
          <p className="notice notice-bad" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-primary btn-block" onClick={() => void save()} disabled={saving}>
          {trade ? '계획 저장' : '계획 만들기'}
        </button>
      </div>
    </Sheet>
  )
}
