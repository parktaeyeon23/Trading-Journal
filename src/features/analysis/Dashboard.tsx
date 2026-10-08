import { useMemo, useState } from 'react'
import {
  adherenceGap,
  breakdown,
  disciplineScore,
  entryWeekday,
  exitEfficiency,
  filterTrades,
  holdBucket,
  HOLD_BUCKETS,
  metrics,
  mistakeCost,
  periodRange,
  planDeviation,
  valKrw,
  valNative,
  valR,
  WEEKDAY_KEYS,
  type AnaTrade,
  type Grade,
  type PeriodKind,
  type ResultFilter,
  type Val,
} from '../../core/analysis'
import { addDays } from '../../core/calendar'
import { formatCompact, formatMoney, formatPct, formatR, formatSignedPct } from '../../core/format'
import { useData } from '../../data/dataStore'
import { deleteView, readSavedViews, saveView } from '../../data/savedViews'
import type { Tag } from '../../data/types'
import { NO_SHARED_FILTERS, useFilters, type MarketFilter, type SharedFilters } from '../../ui/filterStore'
import { hrefFor } from '../../ui/routes'
import { Sheet } from '../../ui/Sheet'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { md, todayKst } from '../calendar/calText'
import { TradeCards } from '../chartbook/Gallery'
import { BarBackfill } from './BarBackfill'
import { BarRows, Histogram, MetricCard, Section, type Fmt } from './parts'
import { useAnalysisBase, type AnalysisBase } from './useAnalysisData'

type PeriodSel = PeriodKind | 'all' | 'custom'
const PERIODS: { v: PeriodSel; label: string }[] = [
  { v: 'all', label: '전체' },
  { v: 'day', label: '일' },
  { v: 'week', label: '주' },
  { v: 'month', label: '월' },
  { v: 'quarter', label: '분기' },
  { v: 'year', label: '연' },
  { v: 'custom', label: '직접' },
]
const MARKETS: { v: MarketFilter; label: string }[] = [
  { v: 'ALL', label: '전체' },
  { v: 'KR', label: 'KR' },
  { v: 'US', label: 'US' },
]
const RESULTS: { v: ResultFilter | null; label: string }[] = [
  { v: null, label: '전체' },
  { v: 'win', label: '승' },
  { v: 'loss', label: '패' },
  { v: 'be', label: '본전' },
]
const TAG_FAMILIES: { f: Tag['family']; label: string }[] = [
  { f: 'reason', label: '근거' },
  { f: 'mistake', label: '실수' },
  { f: 'emotion', label: '감정' },
  { f: 'regime', label: '국면 태그' },
]
const REGIME_LABEL: Record<string, string> = { trend: '추세장', transition: '전환', range: '횡보', '(없음)': '(미입력)' }
type BreakTab = 'setup' | 'reason' | 'market' | 'weekday' | 'hold' | 'regime'
const BREAK_TABS: { v: BreakTab; label: string }[] = [
  { v: 'setup', label: '셋업' },
  { v: 'reason', label: '진입 근거' },
  { v: 'market', label: '시장' },
  { v: 'weekday', label: '요일' },
  { v: 'hold', label: '보유기간' },
  { v: 'regime', label: '국면' },
]

function initialPeriod(param: string | null): { kind: PeriodSel; anchor: string } {
  if (param && /^\d{4}-\d{2}$/.test(param)) return { kind: 'month', anchor: `${param}-01` }
  if (param && /^\d{4}$/.test(param)) return { kind: 'year', anchor: `${param}-01-01` }
  return { kind: 'all', anchor: todayKst() }
}

function periodLabel(kind: PeriodSel, from: string | null, to: string | null): string {
  if (kind === 'all' || !from || !to) return '전체 기간'
  if (kind === 'day') return md(from)
  if (kind === 'month') return `${from.slice(0, 4)}년 ${Number(from.slice(5, 7))}월`
  if (kind === 'quarter') return `${from.slice(0, 4)}년 ${Math.floor((Number(from.slice(5, 7)) - 1) / 3) + 1}분기`
  if (kind === 'year') return `${from.slice(0, 4)}년`
  return `${from === to ? md(from) : `${md(from)} – ${md(to)}`}${kind === 'custom' && from.slice(0, 4) !== to.slice(0, 4) ? ` (${from.slice(0, 4)}–${to.slice(0, 4)})` : ''}`
}

export function Dashboard({ param }: { param: string | null }) {
  const base = useAnalysisBase()
  if (!base) return <p className="empty">불러오는 중…</p>
  return <DashboardBody base={base} param={param} />
}

function DashboardBody({ base, param }: { base: AnalysisBase; param: string | null }) {
  const repo = useData((s) => s.repo)
  const filters = useFilters()
  const { market, setup, tagIds, grade, result, set } = filters
  const [period, setPeriod] = useState(() => initialPeriod(param))
  const [custom, setCustom] = useState({ from: addDays(todayKst(), -90), to: todayKst() })
  const [unit, setUnit] = useState<'R' | 'money'>('R')
  const [tab, setTab] = useState<BreakTab>('setup')
  const [drill, setDrill] = useState<{ title: string; ids: string[] } | null>(null)
  const views = useRepoQuery((r) => readSavedViews(r), []) ?? []
  const [viewName, setViewName] = useState('')
  // Open at first when filters are already set (e.g. coming from the calendar); then the user decides.
  const [moreOpen, setMoreOpen] = useState(() => filters.market !== 'ALL' || !!filters.setup || filters.tagIds.length > 0 || !!filters.grade || !!filters.result)

  const range = useMemo(() => {
    if (period.kind === 'all') return { from: null, to: null }
    if (period.kind === 'custom') return custom
    return periodRange(period.kind, period.anchor)
  }, [period, custom])

  const shown = useMemo(
    () =>
      filterTrades(base.trades, {
        from: range.from,
        to: range.to,
        market: market === 'ALL' ? null : market,
        setup,
        tagIds,
        grade,
        result,
      }),
    [base.trades, range, market, setup, tagIds, grade, result],
  )

  // Money is the market's own currency when one market is chosen, else KRW at the exit day's rate.
  const currency = market === 'US' ? 'USD' : 'KRW'
  const moneyVal: Val = market === 'ALL' ? valKrw : valNative
  const val = unit === 'R' ? valR : moneyVal
  const fmt: Fmt = unit === 'R' ? (v) => formatR(v, 2) : (v) => formatMoney(v, currency)
  const fmtMoney: Fmt = (v) => formatMoney(v, currency)
  const account = market === 'KR' ? base.accountKR : market === 'US' ? base.accountUS : krwAccount(base)

  const view = useMemo(() => {
    const mistakeIds = new Set(base.tags.filter((t) => t.family === 'mistake').map((t) => t.id))
    const reasonIds = new Set(base.tags.filter((t) => t.family === 'reason').map((t) => t.id))
    const keysOf: Record<BreakTab, (t: AnaTrade) => string[]> = {
      setup: (t) => [t.setup ?? '(셋업 없음)'],
      reason: (t) => {
        const r = t.tagIds.filter((id) => reasonIds.has(id))
        return r.length ? r : ['(근거 태그 없음)']
      },
      market: (t) => [t.market],
      weekday: (t) => [entryWeekday(t)],
      hold: (t) => [holdBucket(t.holdDays)],
      regime: (t) => [t.regime ?? '(없음)'],
    }
    let rows = breakdown(shown, keysOf[tab], val)
    if (tab === 'weekday') rows = [...rows].sort((a, b) => WEEKDAY_KEYS.indexOf(a.key) - WEEKDAY_KEYS.indexOf(b.key))
    if (tab === 'hold') rows = [...rows].sort((a, b) => HOLD_BUCKETS.findIndex((x) => x.key === a.key) - HOLD_BUCKETS.findIndex((x) => x.key === b.key))
    return {
      mR: metrics(shown, valR),
      mMoney: metrics(shown, moneyVal, account),
      discipline: disciplineScore(shown),
      rows,
      mistakes: mistakeCost(shown, mistakeIds, val),
      mistakesR: mistakeCost(shown, mistakeIds, valR),
      gaps: adherenceGap(shown, valR),
      plan: planDeviation(shown),
      exits: exitEfficiency(shown),
    }
  }, [shown, tab, val, moneyVal, account, base.tags])

  const tagName = useMemo(() => new Map(base.tags.map((t) => [t.id, t.name])), [base.tags])
  const label = periodLabel(period.kind, range.from, range.to)
  const worst = view.mistakesR.find((m) => m.total < 0) ?? null
  const worstMoney = worst ? view.mistakes.find((m) => m.tagId === worst.tagId) : null
  const exitOf = useMemo(() => new Map(base.trades.map((t) => [t.id, t.exitDate])), [base.trades])
  // Newest exits first in drill-downs.
  const open = (title: string, ids: string[]) => setDrill({ title, ids: [...ids].sort((x, y) => ((exitOf.get(x) ?? '') < (exitOf.get(y) ?? '') ? 1 : -1)) })
  const missingR = view.mR.count - view.mR.measured
  const filtersOn = market !== 'ALL' || setup || tagIds.length || grade || result

  const step = (d: number) => {
    if (period.kind === 'all' || period.kind === 'custom') return
    const a = period.anchor
    const next =
      period.kind === 'day'
        ? addDays(a, d)
        : period.kind === 'week'
          ? addDays(a, 7 * d)
          : period.kind === 'month'
            ? new Date(Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1 + d, 1)).toISOString().slice(0, 10)
            : period.kind === 'quarter'
              ? new Date(Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1 + 3 * d, 1)).toISOString().slice(0, 10)
              : `${Number(a.slice(0, 4)) + d}-01-01`
    setPeriod({ ...period, anchor: next })
  }

  const setTag = (family: Tag['family'], id: string) => {
    const familyIds = new Set(base.tags.filter((t) => t.family === family).map((t) => t.id))
    set({ tagIds: [...tagIds.filter((x) => !familyIds.has(x)), ...(id ? [id] : [])] })
  }
  const setups = [...new Set(base.trades.map((t) => t.setup).filter((s): s is string => !!s))].sort()

  return (
    <div className="stack analysis">
      <div className="row wrap">
        <h1 className="page-title">분석</h1>
        <a className="btn btn-secondary btn-small push-right" href={hrefFor('analysis', 'recon')}>
          월말 대조
        </a>
      </div>

      <div className="cal-toolbar">
        <div className="seg seg-small" role="group" aria-label="기간">
          {PERIODS.map((p) => (
            <button key={p.v} type="button" aria-pressed={period.kind === p.v} onClick={() => setPeriod({ kind: p.v, anchor: period.anchor })}>
              {p.label}
            </button>
          ))}
        </div>
        {period.kind !== 'all' && period.kind !== 'custom' && (
          <div className="row tight">
            <button type="button" className="icon-btn bordered" aria-label="이전 기간" onClick={() => step(-1)}>
              ‹
            </button>
            <b className="period-label">{label}</b>
            <button type="button" className="icon-btn bordered" aria-label="다음 기간" onClick={() => step(1)}>
              ›
            </button>
          </div>
        )}
        {period.kind === 'custom' && (
          <div className="row tight">
            <input type="date" className="input input-small" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="시작일" />
            <span>–</span>
            <input type="date" className="input input-small" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="종료일" />
          </div>
        )}
        <div className="seg seg-small push-right" role="group" aria-label="단위">
          <button type="button" aria-pressed={unit === 'R'} onClick={() => setUnit('R')}>
            R
          </button>
          <button type="button" aria-pressed={unit === 'money'} onClick={() => setUnit('money')}>
            {market === 'ALL' ? '원화 환산' : currency}
          </button>
        </div>
      </div>

      <details className="cal-more" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary>
          필터·저장된 뷰
          {filtersOn ? <span className="chip chip-auto">적용 중</span> : null}
        </summary>
        <div className="stack-tight">
          <div className="row wrap">
            <div className="seg seg-small" role="group" aria-label="시장">
              {MARKETS.map((x) => (
                <button key={x.v} type="button" aria-pressed={market === x.v} onClick={() => set({ market: x.v })}>
                  {x.label}
                </button>
              ))}
            </div>
            <div className="seg seg-small" role="group" aria-label="결과">
              {RESULTS.map((x) => (
                <button key={x.label} type="button" aria-pressed={result === x.v} onClick={() => set({ result: x.v })}>
                  {x.label}
                </button>
              ))}
            </div>
            <select className="input input-small" value={grade ?? ''} onChange={(e) => set({ grade: (e.target.value || null) as Grade | null })} aria-label="실행 등급">
              <option value="">등급 전체</option>
              {(['A', 'B', 'C', 'D'] as const).map((g) => (
                <option key={g} value={g}>
                  {g}등급
                </option>
              ))}
            </select>
            <select className="input input-small" value={setup ?? ''} onChange={(e) => set({ setup: e.target.value || null })} aria-label="셋업">
              <option value="">모든 셋업</option>
              {setups.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {TAG_FAMILIES.map(({ f, label: fl }) => {
              const tags = base.tags.filter((t) => t.family === f)
              if (!tags.length) return null
              const cur = tags.find((t) => tagIds.includes(t.id))?.id ?? ''
              return (
                <select key={f} className="input input-small" value={cur} onChange={(e) => setTag(f, e.target.value)} aria-label={fl}>
                  <option value="">{fl} 전체</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )
            })}
            {filtersOn ? (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => set({ ...NO_SHARED_FILTERS })}>
                필터 지우기
              </button>
            ) : null}
          </div>
          <div className="row wrap">
            <select
              className="input input-small"
              value=""
              onChange={(e) => {
                const v = views.find((x) => x.name === e.target.value)
                if (!v) return
                const { period: pk, ...rest } = v.filters as Partial<SharedFilters> & { period?: PeriodSel }
                set({ ...NO_SHARED_FILTERS, ...rest })
                if (pk) setPeriod({ kind: pk, anchor: todayKst() })
              }}
              aria-label="저장된 뷰 불러오기"
            >
              <option value="">저장된 뷰 {views.length ? `(${views.length})` : ''}</option>
              {views.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
            <input className="input input-small" value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="KR 눌림목 A등급" aria-label="뷰 이름" />
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={!viewName.trim() || !repo}
              onClick={() => {
                if (!repo) return
                void saveView(repo, { name: viewName.trim(), filters: { market, setup, tagIds, grade, result, period: period.kind } })
                setViewName('')
              }}
            >
              지금 필터 저장
            </button>
            {views.length > 0 && (
              <select
                className="input input-small"
                value=""
                onChange={(e) => e.target.value && repo && window.confirm(`"${e.target.value}" 뷰를 삭제할까요?`) && void deleteView(repo, e.target.value)}
                aria-label="저장된 뷰 삭제"
              >
                <option value="">뷰 삭제…</option>
                {views.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </details>

      {shown.length === 0 ? (
        <section className="card">
          <p className="empty" style={{ margin: 0 }}>
            {base.trades.length ? `${label}에 조건에 맞는 청산 트레이드가 없습니다.` : '청산된 트레이드가 쌓이면 여기서 분석합니다.'}
          </p>
        </section>
      ) : (
        <>
          <p className="insight">
            {worst ? (
              <>
                가장 비싼 실수 · <b>{tagName.get(worst.tagId) ?? worst.tagId}</b> — {label} <span className="num loss">{formatR(worst.total, 1)}</span>
                {worstMoney && <span className="num loss"> ({fmtMoney(worstMoney.total)})</span>}, {worst.count}건
              </>
            ) : (
              <>
                {label} 청산 {shown.length}건 · 손실로 이어진 실수 태그가 없습니다.
              </>
            )}
          </p>

          <div className="metric-grid">
            <MetricCard label="기대값 (트레이드당)" value={view.mR.expectancy === null ? '—' : formatR(view.mR.expectancy, 2)} tone={view.mR.expectancy} sub={view.mMoney.expectancy === null ? null : `${fmtMoney(view.mMoney.expectancy)} / 건`} />
            <MetricCard
              label="승률 · 손익비"
              value={`${view.mMoney.winRate === null ? '—' : `${Math.round(view.mMoney.winRate * 100)}%`} · ${view.mR.payoff === null ? '—' : view.mR.payoff.toFixed(2)}`}
              sub={`${view.mMoney.wins}승 ${view.mMoney.losses}패${view.mMoney.breakeven ? ` ${view.mMoney.breakeven}본전` : ''}`}
            />
            <MetricCard
              label="Profit Factor"
              value={(unit === 'R' ? view.mR : view.mMoney).profitFactor?.toFixed(2) ?? '—'}
              sub={`합계 ${unit === 'R' ? formatR(view.mR.total, 1) : formatCompact(view.mMoney.total, currency)}`}
            />
            <MetricCard
              label="최대 드로다운"
              value={formatCompact(view.mMoney.maxDrawdown, currency)}
              tone={view.mMoney.maxDrawdown}
              sub={
                <>
                  {view.mMoney.maxDrawdownPct === null ? '계좌 규모 미설정' : formatSignedPct(view.mMoney.maxDrawdownPct, 1)} · {formatR(view.mR.maxDrawdown, 1)}
                </>
              }
            />
            <MetricCard
              label="평균 보유일 (승 · 패)"
              value={`${view.mMoney.avgHoldWin === null ? '—' : view.mMoney.avgHoldWin.toFixed(1)} · ${view.mMoney.avgHoldLoss === null ? '—' : view.mMoney.avgHoldLoss.toFixed(1)}일`}
            />
            <MetricCard
              label="규율 점수 (최근 20건)"
              value={view.discipline.score === null ? '—' : String(Math.round(view.discipline.score * 100))}
              sub={view.discipline.trades ? `복기 ${view.discipline.trades}건의 규칙 준수율` : '복기한 트레이드 없음'}
            />
          </div>
          {unit === 'R' && missingR > 0 && <p className="help">손절가·계획 리스크가 없어 R을 못 구한 {missingR}건은 R 지표에서 뺐습니다.</p>}

          <Section id="sec-break" title="어디서 벌고 어디서 잃나">
            <div className="seg seg-small seg-scroll" role="group" aria-label="분해 기준">
              {BREAK_TABS.map((b) => (
                <button key={b.v} type="button" aria-pressed={tab === b.v} onClick={() => setTab(b.v)}>
                  {b.label}
                </button>
              ))}
            </div>
            <BarRows
              rows={view.rows}
              fmt={fmt}
              onOpen={open}
              label={(k) => (tab === 'reason' ? (tagName.get(k) ?? k) : tab === 'regime' ? (REGIME_LABEL[k] ?? k) : tab === 'weekday' ? `${k}요일 진입` : k)}
            />
          </Section>

          <div className="analysis-two">
            <Section id="sec-mistake" title="실수별 비용">
              <BarRows rows={view.mistakes.map((m) => ({ key: m.tagId, count: m.count, total: m.total, avg: m.count ? m.total / m.count : null, winRate: null, ids: m.ids }))} fmt={fmt} onOpen={open} label={(k) => tagName.get(k) ?? k} />
            </Section>
            <Section id="sec-rule" title="규칙을 지켰을 때 vs 어겼을 때">
              {view.gaps.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>셋업</th>
                        <th className="r">지킴 (기대값)</th>
                        <th className="r">어김 (기대값)</th>
                        <th className="r">차이</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.gaps.map((g) => (
                        <tr key={g.setup}>
                          <td>{g.setup}</td>
                          <td className="num r">
                            {g.kept.expectancy === null ? '—' : formatR(g.kept.expectancy, 2)} <span className="faint">({g.kept.count})</span>
                          </td>
                          <td className="num r">
                            {g.broke.expectancy === null ? '—' : formatR(g.broke.expectancy, 2)} <span className="faint">({g.broke.count})</span>
                          </td>
                          <td className={`num r ${g.gap === null ? 'faint' : g.gap > 0 ? 'profit' : 'loss'}`}>{g.gap === null ? '—' : formatR(g.gap, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="help">복기를 쓴 트레이드가 없습니다.</p>
              )}
              <p className="help" style={{ margin: 0 }}>
                같은 셋업 안에서 체크리스트를 모두 지킨 트레이드와 하나라도 어긴 트레이드의 평균 R 차이입니다.
              </p>
            </Section>
          </div>

          <div className="analysis-two">
            <Section id="sec-plan" title="계획 대비 실행">
              <dl className="tiles">
                <div className="tile">
                  <dt>평균 진입가 괴리</dt>
                  <dd className="num">{view.plan.avgEntryDevPct === null ? '—' : formatSignedPct(view.plan.avgEntryDevPct, 2)}</dd>
                </div>
                <div className="tile">
                  <dt>±1% 넘게 벗어난 진입</dt>
                  <dd className="num">{view.plan.entryOver1Pct === null ? '—' : formatPct(view.plan.entryOver1Pct * 100, 0)}</dd>
                </div>
                <div className="tile">
                  <dt>평균 수량 괴리</dt>
                  <dd className="num">{view.plan.avgQtyDevPct === null ? '—' : formatSignedPct(view.plan.avgQtyDevPct, 1)}</dd>
                </div>
                <div className="tile">
                  <dt>계획보다 크게 산 비율</dt>
                  <dd className="num">{view.plan.oversized === null ? '—' : formatPct(view.plan.oversized * 100, 0)}</dd>
                </div>
              </dl>
              <button type="button" className="link-row" onClick={() => open('손절을 넓힌 트레이드', view.plan.stopWidenedTrades)} disabled={!view.plan.stopWidenedTrades.length}>
                손절을 넓힌(뒤로 미룬) 트레이드 <b className="num">{view.plan.stopWidenedTrades.length}건</b>
                {view.plan.stopWidenedRate !== null && <span className="faint num"> ({formatPct(view.plan.stopWidenedRate * 100, 0)})</span>}
                {view.plan.stopWidenedTrades.length > 0 && ' ›'}
              </button>
              <p className="help" style={{ margin: 0 }}>
                계획이 있는 {view.plan.withPlan}건 기준. 무계획 진입은 괴리 계산에서 빠집니다.
              </p>
            </Section>
            <Section id="sec-exit" title="청산 효율 (MFE · MAE)">
              <dl className="tiles">
                <div className="tile">
                  <dt>최대 유리 구간 대비 실현</dt>
                  <dd className={`num ${view.exits.captureRatio === null ? '' : view.exits.captureRatio >= 0 ? 'profit' : 'loss'}`}>{view.exits.captureRatio === null ? '—' : formatPct(view.exits.captureRatio * 100, 0)}</dd>
                </div>
                <div className="tile">
                  <dt>평균 MFE · MAE</dt>
                  <dd className="num">
                    {view.exits.avgMfeR === null ? '—' : formatR(view.exits.avgMfeR, 2)} · {view.exits.avgMaeR === null ? '—' : formatR(view.exits.avgMaeR, 2)}
                  </dd>
                </div>
              </dl>
              <div className="histo-pair">
                <Histogram bins={view.exits.maeWinners} title="수익 트레이드의 MAE" />
                <Histogram bins={view.exits.maeLosers} title="손실 트레이드의 MAE" />
              </div>
              <p className="help" style={{ margin: 0 }}>
                수익 트레이드가 대부분 −0.5R 안쪽에서 돌아섰다면 손절을 더 좁혀도 됩니다 (ATR 손절 배수 보정). 일봉 고가·저가 기준, 측정 {view.exits.measured}건.
              </p>
              <BarBackfill bundles={base.allBundles} />
            </Section>
          </div>
        </>
      )}

      {drill && (
        <Sheet title={`${drill.title} · ${drill.ids.length}건`} onClose={() => setDrill(null)}>
          <TradeCards trades={drill.ids.map((id) => base.bundles.get(id)).filter((t): t is NonNullable<typeof t> => !!t)} />
        </Sheet>
      )}
    </div>
  )
}

/** Both accounts in KRW (US at the latest known rate), for drawdown % across markets. */
function krwAccount(base: AnalysisBase): number | null {
  const dates = Object.keys(base.usdkrw).sort()
  const rate = dates.length ? base.usdkrw[dates[dates.length - 1]] : null
  if (!base.accountKR && !base.accountUS) return null
  return (base.accountKR ?? 0) + (base.accountUS && rate ? base.accountUS * rate : 0)
}
