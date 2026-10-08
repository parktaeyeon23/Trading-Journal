/**
 * Calendar P&L — pure.
 *
 * Every closing fill is an event on its own trading day, so a position sold
 * in three parts shows up on three days. With the "entry" basis the whole
 * realized P&L of a position lands on its first entry day instead.
 * Trading day = the fill's date in its market's time zone (KR Seoul, US New York),
 * so a 02:00 KST US sale counts on the US session date, like the broker statement.
 */
import { toKrw } from './fx'
import { compareFills, entrySide, positionPnl, type PnlFill } from './pnl'
import type { Direction } from './sizing'

export type CalMarket = 'KR' | 'US'
export type CalUnit = 'KRW' | 'USD' | 'R' | 'PCT'
export type DateBasis = 'exit' | 'entry'

const ZONES: Record<CalMarket, string> = { KR: 'Asia/Seoul', US: 'America/New_York' }
const fmtCache = new Map<string, Intl.DateTimeFormat>()

/** YYYY-MM-DD of an instant in the market's own time zone. */
export function tradeDate(ts: string, market: CalMarket): string {
  const zone = ZONES[market]
  let f = fmtCache.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    fmtCache.set(zone, f)
  }
  return f.format(new Date(ts))
}

// ---------- dates (YYYY-MM-DD, calendar arithmetic in UTC) ----------

const DAY = 86400000
const toMs = (d: string) => Date.parse(d + 'T00:00:00Z')
const fromMs = (t: number) => new Date(t).toISOString().slice(0, 10)

export function addDays(date: string, n: number): string {
  return fromMs(toMs(date) + n * DAY)
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayMon0(date: string): number {
  return (new Date(toMs(date)).getUTCDay() + 6) % 7
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, -weekdayMon0(date))
}

export interface CalDay {
  date: string
  inMonth: boolean
}

/** Monday-first weeks covering a month (month is 1–12). */
export function monthWeeks(year: number, month: number): CalDay[][] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const prefix = first.slice(0, 7)
  const weeks: CalDay[][] = []
  let d = weekStart(first)
  do {
    const week: CalDay[] = []
    for (let i = 0; i < 7; i++) {
      week.push({ date: d, inMonth: d.startsWith(prefix) })
      d = addDays(d, 1)
    }
    weeks.push(week)
  } while (d.startsWith(prefix))
  return weeks
}

// ---------- events ----------

export interface CalTradeInput {
  id: string
  market: CalMarket
  direction: Direction
  fills: PnlFill[]
  /** Money value of 1R (null when unknown). */
  oneR: number | null
}

/** One position's realized P&L on one day, in the position's own currency. */
export interface CalEvent {
  tradeId: string
  market: CalMarket
  date: string
  net: number
  /** R for this slice (null without 1R). */
  r: number | null
}

export function tradeEvents(t: CalTradeInput, basis: DateBasis): CalEvent[] {
  const pnl = positionPnl(t.direction, t.fills)
  if (!pnl.exits.length) return []
  const r = (net: number) => (t.oneR && t.oneR > 0 ? net / t.oneR : null)
  if (basis === 'entry') {
    const side = entrySide(t.direction)
    const first = [...t.fills].filter((f) => f.side === side).sort(compareFills)[0]
    if (!first) return []
    return [{ tradeId: t.id, market: t.market, date: tradeDate(first.ts, t.market), net: pnl.realizedNet, r: r(pnl.realizedNet) }]
  }
  const byDay = new Map<string, number>()
  for (const e of pnl.exits) {
    const d = tradeDate(e.ts, t.market)
    byDay.set(d, (byDay.get(d) ?? 0) + e.net)
  }
  return [...byDay].map(([date, net]) => ({ tradeId: t.id, market: t.market, date, net, r: r(net) }))
}

export interface UnitContext {
  /** date → KRW per 1 USD */
  usdkrw: Record<string, number>
  accountKR: number | null
  accountUS: number | null
}

/** The event in the chosen unit; null when it can't be converted (no rate, no 1R, no account size). */
export function eventValue(e: CalEvent, unit: CalUnit, ctx: UnitContext): number | null {
  const currency = e.market === 'KR' ? 'KRW' : 'USD'
  switch (unit) {
    case 'R':
      return e.r
    case 'PCT': {
      const acct = e.market === 'KR' ? ctx.accountKR : ctx.accountUS
      return acct && acct > 0 ? (e.net / acct) * 100 : null
    }
    case 'KRW':
      return toKrw(e.net, currency, e.date, ctx.usdkrw)
    case 'USD': {
      if (currency === 'USD') return e.net
      const k = toKrw(1, 'USD', e.date, ctx.usdkrw)
      return k ? e.net / k : null
    }
  }
}

// ---------- day buckets ----------

export interface DayBucket {
  date: string
  /** Sum in the chosen unit (events that could not be converted are left out and counted in `missing`). */
  value: number
  missing: number
  /** Sum of R over events with a known 1R. */
  r: number
  /** Native-currency sums by market. */
  KR: number
  US: number
  trades: number
  wins: number
  losses: number
  tradeIds: string[]
}

export function dailyBuckets(events: CalEvent[], unit: CalUnit, ctx: UnitContext): Map<string, DayBucket> {
  const out = new Map<string, DayBucket>()
  for (const e of events) {
    let b = out.get(e.date)
    if (!b) {
      b = { date: e.date, value: 0, missing: 0, r: 0, KR: 0, US: 0, trades: 0, wins: 0, losses: 0, tradeIds: [] }
      out.set(e.date, b)
    }
    const v = eventValue(e, unit, ctx)
    if (v === null) b.missing++
    else b.value += v
    if (e.r !== null) b.r += e.r
    b[e.market] += e.net
    // tradeEvents gives one event per trade per day, so each is one trade.
    b.trades++
    b.tradeIds.push(e.tradeId)
    if (e.net > 0) b.wins++
    else if (e.net < 0) b.losses++
  }
  return out
}

/** Sum of buckets over a list of dates. */
export function sumDays(buckets: Map<string, DayBucket>, dates: string[]): { value: number; r: number; trades: number; missing: number } {
  let value = 0
  let r = 0
  let trades = 0
  let missing = 0
  for (const d of dates) {
    const b = buckets.get(d)
    if (!b) continue
    value += b.value
    r += b.r
    trades += b.trades
    missing += b.missing
  }
  return { value, r, trades, missing }
}

/** Colour strength 0–1 relative to the period's largest absolute day. 0 for flat days. */
export function intensity(value: number, maxAbs: number): number {
  if (!value || !(maxAbs > 0)) return 0
  return Math.min(1, Math.max(0.15, Math.abs(value) / maxAbs))
}

// ---------- period summary ----------

export interface PeriodSummary {
  total: number
  rSum: number
  /** Positions with a realized result in the period (summed per position). */
  wins: number
  losses: number
  winRate: number | null
  /** Average win ÷ |average loss|. */
  payoff: number | null
  tradingDays: number
  best: { date: string; value: number } | null
  worst: { date: string; value: number } | null
  missing: number
}

export function summarizePeriod(events: CalEvent[], unit: CalUnit, ctx: UnitContext, from: string, to: string): PeriodSummary {
  const inRange = events.filter((e) => e.date >= from && e.date <= to)
  const perTrade = new Map<string, number>()
  let total = 0
  let rSum = 0
  let missing = 0
  for (const e of inRange) {
    const v = eventValue(e, unit, ctx)
    if (e.r !== null) rSum += e.r
    if (v === null) {
      missing++
      continue
    }
    total += v
    perTrade.set(e.tradeId, (perTrade.get(e.tradeId) ?? 0) + v)
  }
  const results = [...perTrade.values()]
  const winsV = results.filter((v) => v > 0)
  const lossesV = results.filter((v) => v < 0)
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const buckets = dailyBuckets(inRange, unit, ctx)
  let best: PeriodSummary['best'] = null
  let worst: PeriodSummary['worst'] = null
  for (const b of buckets.values()) {
    if (b.value > 0 && (!best || b.value > best.value)) best = { date: b.date, value: b.value }
    if (b.value < 0 && (!worst || b.value < worst.value)) worst = { date: b.date, value: b.value }
  }
  return {
    total,
    rSum,
    wins: winsV.length,
    losses: lossesV.length,
    winRate: winsV.length + lossesV.length ? winsV.length / (winsV.length + lossesV.length) : null,
    payoff: winsV.length && lossesV.length ? avg(winsV) / Math.abs(avg(lossesV)) : null,
    tradingDays: buckets.size,
    best,
    worst,
    missing,
  }
}

// ---------- equity curve ----------

export interface EquityPoint {
  date: string
  /** Cumulative value up to and including this day. */
  cum: number
  /** cum − running peak (≤ 0). The peak starts at 0, so an opening loss is a drawdown. */
  dd: number
}

export function equityCurve(buckets: Map<string, DayBucket>, from: string, to: string): EquityPoint[] {
  const days = [...buckets.keys()].filter((d) => d >= from && d <= to).sort()
  let cum = 0
  let peak = 0
  return days.map((date) => {
    cum += buckets.get(date)!.value
    peak = Math.max(peak, cum)
    return { date, cum, dd: cum - peak }
  })
}

// ---------- weekly review numbers ----------

export interface WeeklyStatsInput {
  events: CalEvent[]
  ctx: UnitContext
  /** Reviews of the positions closed this week: rule id → kept. */
  checklists: Record<string, boolean>[]
  /** Mistake tag ids attached to those positions (one entry per position-tag). */
  mistakeTagIds: string[]
}

export interface WeeklyStats {
  KR: number
  US: number
  krw: number
  krwMissing: number
  r: number
  trades: number
  /** Kept ÷ answered over all checklists; null without reviews. */
  adherence: number | null
  topMistakes: { tagId: string; count: number }[]
}

export function weeklyStats(input: WeeklyStatsInput): WeeklyStats {
  let KR = 0
  let US = 0
  let krw = 0
  let krwMissing = 0
  let r = 0
  const ids = new Set<string>()
  for (const e of input.events) {
    if (e.market === 'KR') KR += e.net
    else US += e.net
    const k = eventValue(e, 'KRW', input.ctx)
    if (k === null) krwMissing++
    else krw += k
    if (e.r !== null) r += e.r
    ids.add(e.tradeId)
  }
  let kept = 0
  let answered = 0
  for (const c of input.checklists) {
    for (const v of Object.values(c)) {
      answered++
      if (v) kept++
    }
  }
  const counts = new Map<string, number>()
  for (const t of input.mistakeTagIds) counts.set(t, (counts.get(t) ?? 0) + 1)
  const topMistakes = [...counts]
    .map(([tagId, count]) => ({ tagId, count }))
    .sort((a, b) => b.count - a.count || (a.tagId < b.tagId ? -1 : 1))
    .slice(0, 3)
  return { KR, US, krw, krwMissing, r, trades: ids.size, adherence: answered ? kept / answered : null, topMistakes }
}

// ---------- index moves ----------

/** Close and change vs the previous bar for a date; null when that day has no bar. */
export function dayChange(bars: { date: string; close?: number | null }[], date: string): { close: number; changePct: number | null } | null {
  const sorted = bars.filter((b) => typeof b.close === 'number').sort((a, b) => (a.date < b.date ? -1 : 1))
  const i = sorted.findIndex((b) => b.date === date)
  if (i < 0) return null
  const close = sorted[i].close as number
  const prev = i > 0 ? (sorted[i - 1].close as number) : null
  return { close, changePct: prev ? ((close - prev) / prev) * 100 : null }
}
