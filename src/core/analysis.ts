/**
 * Performance analysis — pure. "Where do I make and lose money?"
 *
 * Works on closed positions only. Every metric takes a value accessor, so the
 * same function answers in money (KRW-converted, or a market's own currency)
 * and in R. R only exists for trades with an original stop / planned risk;
 * trades without it simply drop out of R metrics.
 */
import { addDays, tradeDate, weekdayMon0, type CalMarket } from './calendar'
import { rateOn } from './fx'
import { compareFills, entrySide, positionPnl, type PnlFill } from './pnl'
import { excursion, type Bar } from './risk'
import type { Direction } from './sizing'

export type Grade = 'A' | 'B' | 'C' | 'D'

export interface AnaTrade {
  id: string
  market: CalMarket
  setup: string | null
  regime: string | null
  grade: Grade | null
  noPlan: boolean
  /** Tags without a phase (mistakes, reasons, setup tags). */
  tagIds: string[]
  /** Emotion tags (any phase). */
  emotionTagIds: string[]
  checklist: Record<string, boolean> | null
  entryDate: string
  exitDate: string
  /** Calendar days from first entry to last exit (0 = same day). */
  holdDays: number
  /** Realized net P&L in the trade's own currency. */
  net: number
  /** Converted with the exit day's USD/KRW; null when no rate is known. */
  netKrw: number | null
  r: number | null
  entryDeviationPct: number | null
  qtyDeviationPct: number | null
  /** Stop moves that gave the trade more room (lower for a long). */
  stopWidened: number
  stopMoves: number
  mfeR: number | null
  maeR: number | null
  mfePct: number | null
  maePct: number | null
}

export interface AnaTradeInput {
  id: string
  market: CalMarket
  direction: Direction
  setup?: string | null
  regime?: string | null
  grade?: string | null
  noPlan?: boolean
  checklist?: Record<string, boolean> | null
  tags: { tagId: string; phase?: string | null }[]
  fills: PnlFill[]
  oneR: number | null
  originalStop?: number | null
  planEntry?: number | null
  planQty?: number | null
  stopMoves: { oldStop?: number | null; newStop: number }[]
  /** Daily bars of the symbol (any range; the holding window is cut out here). */
  bars: Bar[]
  usdkrw: Record<string, number>
}

const DAY = 86400000

/** null while the position is still open or never exited. */
export function buildAnaTrade(t: AnaTradeInput): AnaTrade | null {
  const pnl = positionPnl(t.direction, t.fills)
  if (!pnl.exits.length || pnl.openQty > 0) return null
  const side = entrySide(t.direction)
  const sorted = [...t.fills].sort(compareFills)
  const first = sorted.find((f) => f.side === side)!
  const entryDate = tradeDate(first.ts, t.market)
  const exitDate = tradeDate(pnl.exits[pnl.exits.length - 1].ts, t.market)
  const rate = t.market === 'US' ? rateOn(exitDate, t.usdkrw) : 1
  const window = t.bars.filter((b) => b.date >= entryDate && b.date <= exitDate)
  const ex = excursion(t.direction, first.price, t.originalStop, window)
  const widened = t.stopMoves.filter((m) => typeof m.oldStop === 'number' && (t.direction === 'long' ? m.newStop < m.oldStop : m.newStop > m.oldStop)).length
  const grade = t.grade && ['A', 'B', 'C', 'D'].includes(t.grade) ? (t.grade as Grade) : null
  return {
    id: t.id,
    market: t.market,
    setup: t.setup ?? null,
    regime: t.regime ?? null,
    grade,
    noPlan: !!t.noPlan,
    tagIds: t.tags.filter((x) => !x.phase).map((x) => x.tagId),
    emotionTagIds: t.tags.filter((x) => x.phase).map((x) => x.tagId),
    checklist: t.checklist ?? null,
    entryDate,
    exitDate,
    holdDays: Math.round((Date.parse(exitDate) - Date.parse(entryDate)) / DAY),
    net: pnl.realizedNet,
    netKrw: rate ? pnl.realizedNet * rate : null,
    r: t.oneR && t.oneR > 0 ? pnl.realizedNet / t.oneR : null,
    entryDeviationPct: t.planEntry ? ((first.price - t.planEntry) / t.planEntry) * 100 : null,
    qtyDeviationPct: t.planQty ? ((pnl.entryQty - t.planQty) / t.planQty) * 100 : null,
    stopWidened: widened,
    stopMoves: t.stopMoves.length,
    mfeR: ex?.mfeR ?? null,
    maeR: ex?.maeR ?? null,
    mfePct: ex?.mfePct ?? null,
    maePct: ex?.maePct ?? null,
  }
}

/** A value per trade in the unit being analysed; null = not measurable (left out). */
export type Val = (t: AnaTrade) => number | null

export const valR: Val = (t) => t.r
export const valKrw: Val = (t) => t.netKrw
export const valNative: Val = (t) => t.net

// ---------- filters ----------

export type ResultFilter = 'win' | 'loss' | 'be'

export interface AnaFilter {
  from?: string | null
  to?: string | null
  market?: CalMarket | null
  setup?: string | null
  /** One tag per family; a trade must carry every one of them. */
  tagIds?: string[]
  grade?: Grade | null
  result?: ResultFilter | null
}

export function resultOf(t: AnaTrade): ResultFilter {
  return t.net > 0 ? 'win' : t.net < 0 ? 'loss' : 'be'
}

/** AND of every filter set. Period applies to the exit day. */
export function filterTrades(trades: AnaTrade[], f: AnaFilter): AnaTrade[] {
  return trades.filter(
    (t) =>
      (!f.from || t.exitDate >= f.from) &&
      (!f.to || t.exitDate <= f.to) &&
      (!f.market || t.market === f.market) &&
      (!f.setup || t.setup === f.setup) &&
      (!f.grade || t.grade === f.grade) &&
      (!f.result || resultOf(t) === f.result) &&
      (f.tagIds ?? []).every((id) => t.tagIds.includes(id) || t.emotionTagIds.includes(id)),
  )
}

export type PeriodKind = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** The period of the given kind that contains `anchor`. */
export function periodRange(kind: PeriodKind, anchor: string): { from: string; to: string } {
  const y = Number(anchor.slice(0, 4))
  const m = Number(anchor.slice(5, 7))
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10)
  switch (kind) {
    case 'day':
      return { from: anchor, to: anchor }
    case 'week': {
      const from = addDays(anchor, -weekdayMon0(anchor))
      return { from, to: addDays(from, 6) }
    }
    case 'month':
      return { from: `${anchor.slice(0, 7)}-01`, to: last(y, m) }
    case 'quarter': {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1
      return { from: `${y}-${String(q0).padStart(2, '0')}-01`, to: last(y, q0 + 2) }
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` }
  }
}

// ---------- core metrics ----------

export interface Metrics {
  count: number
  /** Trades the value could be measured for. */
  measured: number
  wins: number
  losses: number
  breakeven: number
  winRate: number | null
  total: number
  /** Average value per trade — with R, the expectancy. */
  expectancy: number | null
  avgWin: number | null
  avgLoss: number | null
  /** avgWin ÷ |avgLoss| */
  payoff: number | null
  /** gross wins ÷ |gross losses| */
  profitFactor: number | null
  /** Largest peak-to-trough fall of the cumulative value, by exit day (≤ 0). */
  maxDrawdown: number
  /** maxDrawdown as % of `account + peak` when an account size is given. */
  maxDrawdownPct: number | null
  avgHoldWin: number | null
  avgHoldLoss: number | null
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

export function metrics(trades: AnaTrade[], val: Val, account?: number | null): Metrics {
  const rows = trades.map((t) => ({ t, v: val(t) })).filter((x): x is { t: AnaTrade; v: number } => x.v !== null)
  const wins = rows.filter((x) => x.v > 0)
  const losses = rows.filter((x) => x.v < 0)
  const gw = wins.reduce((s, x) => s + x.v, 0)
  const gl = losses.reduce((s, x) => s + x.v, 0)
  const aw = avg(wins.map((x) => x.v))
  const al = avg(losses.map((x) => x.v))

  let cum = 0
  let peak = 0
  let dd = 0
  let ddPeak = 0
  for (const x of [...rows].sort((a, b) => (a.t.exitDate < b.t.exitDate ? -1 : a.t.exitDate > b.t.exitDate ? 1 : 0))) {
    cum += x.v
    peak = Math.max(peak, cum)
    if (cum - peak < dd) {
      dd = cum - peak
      ddPeak = peak
    }
  }
  return {
    count: trades.length,
    measured: rows.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: rows.length - wins.length - losses.length,
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
    total: gw + gl,
    expectancy: avg(rows.map((x) => x.v)),
    avgWin: aw,
    avgLoss: al,
    payoff: aw !== null && al !== null ? aw / Math.abs(al) : null,
    profitFactor: gl < 0 ? gw / Math.abs(gl) : null,
    maxDrawdown: dd,
    maxDrawdownPct: account && account > 0 ? (dd / (account + ddPeak)) * 100 : null,
    avgHoldWin: avg(wins.map((x) => x.t.holdDays)),
    avgHoldLoss: avg(losses.map((x) => x.t.holdDays)),
  }
}

/** Kept ÷ answered checklist items over the latest `n` reviewed trades (by exit day). */
export function disciplineScore(trades: AnaTrade[], n = 20): { score: number | null; trades: number } {
  const reviewed = trades.filter((t) => t.checklist && Object.keys(t.checklist).length).sort((a, b) => (a.exitDate < b.exitDate ? 1 : -1)).slice(0, n)
  let kept = 0
  let answered = 0
  for (const t of reviewed) {
    for (const v of Object.values(t.checklist!)) {
      answered++
      if (v) kept++
    }
  }
  return { score: answered ? kept / answered : null, trades: reviewed.length }
}

// ---------- breakdowns ----------

export interface BreakdownRow {
  key: string
  count: number
  total: number
  avg: number | null
  winRate: number | null
  /** Ids of the trades in this row (for drill-down). */
  ids: string[]
}

/**
 * Groups trades by one or more keys each (a trade with two reason tags counts
 * in both rows). Rows sorted by total, best first.
 */
export function breakdown(trades: AnaTrade[], keysOf: (t: AnaTrade) => string[], val: Val): BreakdownRow[] {
  const groups = new Map<string, AnaTrade[]>()
  for (const t of trades) {
    for (const k of new Set(keysOf(t))) {
      const g = groups.get(k) ?? []
      g.push(t)
      groups.set(k, g)
    }
  }
  return [...groups]
    .map(([key, list]) => {
      const m = metrics(list, val)
      return { key, count: list.length, total: m.total, avg: m.expectancy, winRate: m.winRate, ids: list.map((t) => t.id) }
    })
    .sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : 1))
}

export const WEEKDAY_KEYS = ['월', '화', '수', '목', '금', '토', '일']

export const HOLD_BUCKETS: { key: string; max: number }[] = [
  { key: '당일', max: 0 },
  { key: '1–3일', max: 3 },
  { key: '4–7일', max: 7 },
  { key: '8–20일', max: 20 },
  { key: '21일+', max: Infinity },
]

export const holdBucket = (days: number) => HOLD_BUCKETS.find((b) => days <= b.max)!.key
export const entryWeekday = (t: AnaTrade) => WEEKDAY_KEYS[weekdayMon0(t.entryDate)]

// ---------- mistakes and rules ----------

export interface MistakeCost {
  tagId: string
  count: number
  total: number
  ids: string[]
}

/** Sum of the results of trades carrying each mistake tag, most expensive first. */
export function mistakeCost(trades: AnaTrade[], mistakeTagIds: Set<string>, val: Val): MistakeCost[] {
  return breakdown(trades, (t) => t.tagIds.filter((id) => mistakeTagIds.has(id)), val)
    .map((r) => ({ tagId: r.key, count: r.count, total: r.total, ids: r.ids }))
    .sort((a, b) => a.total - b.total || (a.tagId < b.tagId ? -1 : 1))
}

export interface AdherenceGap {
  setup: string
  kept: { count: number; expectancy: number | null }
  broke: { count: number; expectancy: number | null }
  /** kept − broke expectancy; null unless both sides have trades. */
  gap: number | null
}

/** Within each setup: trades that kept every checklist rule vs. those that broke at least one. */
export function adherenceGap(trades: AnaTrade[], val: Val): AdherenceGap[] {
  const bySetup = new Map<string, AnaTrade[]>()
  for (const t of trades) {
    if (!t.checklist || !Object.keys(t.checklist).length) continue
    const k = t.setup ?? '(셋업 없음)'
    bySetup.set(k, [...(bySetup.get(k) ?? []), t])
  }
  return [...bySetup]
    .map(([setup, list]) => {
      const kept = list.filter((t) => Object.values(t.checklist!).every(Boolean))
      const broke = list.filter((t) => !Object.values(t.checklist!).every(Boolean))
      const ke = metrics(kept, val).expectancy
      const be = metrics(broke, val).expectancy
      return { setup, kept: { count: kept.length, expectancy: ke }, broke: { count: broke.length, expectancy: be }, gap: ke !== null && be !== null ? ke - be : null }
    })
    .sort((a, b) => (b.gap ?? -Infinity) - (a.gap ?? -Infinity) || (a.setup < b.setup ? -1 : 1))
}

export interface PlanDeviation {
  /** Trades with a planned entry. */
  withPlan: number
  avgEntryDevPct: number | null
  /** Share of trades that paid more than 1% over plan (long) / under (short) — chasing. */
  entryOver1Pct: number | null
  avgQtyDevPct: number | null
  /** Share of trades sized over plan. */
  oversized: number | null
  /** Share of trades whose stop was moved to give more room at least once. */
  stopWidenedRate: number | null
  stopWidenedTrades: string[]
}

export function planDeviation(trades: AnaTrade[]): PlanDeviation {
  const e = trades.filter((t) => t.entryDeviationPct !== null)
  const q = trades.filter((t) => t.qtyDeviationPct !== null)
  const widened = trades.filter((t) => t.stopWidened > 0)
  return {
    withPlan: e.length,
    avgEntryDevPct: avg(e.map((t) => t.entryDeviationPct!)),
    entryOver1Pct: e.length ? e.filter((t) => Math.abs(t.entryDeviationPct!) > 1).length / e.length : null,
    avgQtyDevPct: avg(q.map((t) => t.qtyDeviationPct!)),
    oversized: q.length ? q.filter((t) => t.qtyDeviationPct! > 0).length / q.length : null,
    stopWidenedRate: trades.length ? widened.length / trades.length : null,
    stopWidenedTrades: widened.map((t) => t.id),
  }
}

// ---------- exits ----------

export interface ExitEfficiency {
  /** Trades with both R and MFE in R. */
  measured: number
  /** Average of realized R ÷ MFE R over trades that had a favourable move. */
  captureRatio: number | null
  avgMfeR: number | null
  avgMaeR: number | null
  /** MAE (in R) histogram of winners: how deep good trades went before working. */
  maeWinners: HistogramBin[]
  maeLosers: HistogramBin[]
}

export interface HistogramBin {
  label: string
  /** Lower edge (inclusive) and upper edge (exclusive), in R. */
  lo: number
  hi: number
  count: number
}

/** MAE bins in R (MAE is ≤ 0): the last bin catches everything shallower than −0.25R. */
export const MAE_BINS: Omit<HistogramBin, 'count'>[] = [
  { label: '<−1.5', lo: -Infinity, hi: -1.5 },
  { label: '−1.5~−1', lo: -1.5, hi: -1 },
  { label: '−1~−.75', lo: -1, hi: -0.75 },
  { label: '−.75~−.5', lo: -0.75, hi: -0.5 },
  { label: '−.5~−.25', lo: -0.5, hi: -0.25 },
  { label: '−.25~0', lo: -0.25, hi: Infinity },
]

export function histogram(values: number[], bins: Omit<HistogramBin, 'count'>[]): HistogramBin[] {
  return bins.map((b) => ({ ...b, count: values.filter((v) => v >= b.lo && v < b.hi).length }))
}

export function exitEfficiency(trades: AnaTrade[]): ExitEfficiency {
  const m = trades.filter((t) => t.r !== null && t.mfeR !== null)
  const ratios = m.filter((t) => t.mfeR! > 0).map((t) => t.r! / t.mfeR!)
  const maeOf = (list: AnaTrade[]) => list.filter((t) => t.maeR !== null).map((t) => t.maeR!)
  return {
    measured: m.length,
    captureRatio: avg(ratios),
    avgMfeR: avg(m.map((t) => t.mfeR!)),
    avgMaeR: avg(maeOf(m)),
    maeWinners: histogram(maeOf(m.filter((t) => t.net > 0)), MAE_BINS),
    maeLosers: histogram(maeOf(m.filter((t) => t.net < 0)), MAE_BINS),
  }
}
