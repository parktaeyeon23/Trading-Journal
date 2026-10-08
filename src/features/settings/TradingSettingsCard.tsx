import { useState } from 'react'
import { parseAmount } from '../../core/format'
import type { GradeBands } from '../../core/grade'
import { useData } from '../../data/dataStore'
import type { LocalRepo } from '../../data/repo'
import { readSetting, SETTING_KEYS, writeSetting } from '../../data/settings'
import { useRepoQuery } from '../../ui/useRepoQuery'

interface Values {
  feeKR: string
  taxKR: string
  feeUS: string
  rpt: string
  maxPos: string
  maxOpen: string
  bandB: string
  bandC: string
}

const toText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

export function TradingSettingsCard() {
  const repo = useData((s) => s.repo)
  const loaded = useRepoQuery(async (r): Promise<Values> => {
    const bands = await readSetting<GradeBands>(r, SETTING_KEYS.gradeBands, { A: 1, B: 0.8, C: 0.6 })
    return {
      feeKR: toText(await readSetting<number | null>(r, SETTING_KEYS.feeRate('KR'), null)),
      taxKR: toText(await readSetting<number | null>(r, SETTING_KEYS.sellTaxKR, null)),
      feeUS: toText(await readSetting<number | null>(r, SETTING_KEYS.feeRate('US'), null)),
      rpt: toText(await readSetting<number>(r, SETTING_KEYS.defaultRptPct, 1.25)),
      maxPos: toText(await readSetting<number>(r, SETTING_KEYS.maxPositionPct, 25)),
      maxOpen: toText(await readSetting<number>(r, SETTING_KEYS.maxOpenRiskPct, 6)),
      bandB: toText(Math.round(bands.B * 100)),
      bandC: toText(Math.round(bands.C * 100)),
    }
  }, [])
  if (!loaded) return null
  return <Form key={JSON.stringify(loaded)} initial={loaded} save={async (v) => repo && persist(repo, v)} />
}

async function persist(repo: LocalRepo, v: Values) {
  const num = (s: string) => (s.trim() === '' ? null : parseAmount(s))
  await writeSetting(repo, SETTING_KEYS.feeRate('KR'), num(v.feeKR))
  await writeSetting(repo, SETTING_KEYS.sellTaxKR, num(v.taxKR))
  await writeSetting(repo, SETTING_KEYS.feeRate('US'), num(v.feeUS))
  await writeSetting(repo, SETTING_KEYS.defaultRptPct, num(v.rpt) ?? 1.25)
  await writeSetting(repo, SETTING_KEYS.maxPositionPct, num(v.maxPos) ?? 25)
  await writeSetting(repo, SETTING_KEYS.maxOpenRiskPct, num(v.maxOpen) ?? 6)
  await writeSetting(repo, SETTING_KEYS.gradeBands, { A: 1, B: (num(v.bandB) ?? 80) / 100, C: (num(v.bandC) ?? 60) / 100 })
}

function Form({ initial, save }: { initial: Values; save: (v: Values) => Promise<unknown> }) {
  const [v, setV] = useState(initial)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value })
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)

  async function submit() {
    const bad = Object.entries(v).find(([, s]) => s.trim() !== '' && !(parseAmount(s) >= 0))
    if (bad) return setMsg({ ok: false, text: '숫자만 넣으세요.' })
    const b = parseAmount(v.bandB)
    const c = parseAmount(v.bandC)
    if (!(b > c && b < 100 && c > 0)) return setMsg({ ok: false, text: '등급 구간은 100 > B > C > 0 이어야 합니다.' })
    await save(v)
    setMsg({ ok: true, text: '저장했습니다.' })
  }

  const field = (k: keyof Values, label: string, hint?: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input num" inputMode="decimal" value={v[k]} onChange={set(k)} placeholder={hint} />
    </label>
  )

  return (
    <section className="card stack" aria-labelledby="trading-title">
      <div>
        <h2 id="trading-title" className="section-title">
          매매 설정
        </h2>
        <p className="help">모든 값은 퍼센트(%)입니다. 수수료·세율은 증권사 요율표에서 확인해 넣으세요. 비워두면 체결 입력 때 직접 넣습니다.</p>
      </div>
      <div className="field-triple">
        {field('feeKR', 'KR 수수료 %', '예: 0.015')}
        {field('taxKR', 'KR 매도 세금 %')}
        {field('feeUS', 'US 수수료 %')}
      </div>
      <div className="field-triple">
        {field('rpt', '기본 RPT %')}
        {field('maxPos', '포지션 비중 상한 %')}
        {field('maxOpen', '오픈 리스크 상한 %')}
      </div>
      <div className="field-pair">
        {field('bandB', '등급 B 기준 (준수율 %)')}
        {field('bandC', '등급 C 기준 (준수율 %)')}
      </div>
      <p className="help" style={{ margin: 0 }}>
        A는 100% 준수. 무계획 진입은 준수율과 관계없이 최대 C.
      </p>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => void submit()}>
          저장
        </button>
        {msg && (
          <span className={msg.ok ? 'help' : 'field-error'} role="status">
            {msg.text}
          </span>
        )}
      </div>
    </section>
  )
}
