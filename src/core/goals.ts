/**
 * Monthly R goal and daily / weekly loss limits — pure.
 *
 * Limits count REALIZED R only (closing fills), on the same days the calendar
 * uses: KR fills on the Seoul date, US fills on the New York trading date. So
 * "today" for a US session traded at night in Korea is that US session.
 * Open positions are not counted: the app has daily bars, not live prices.
 */
import { tradeDate, weekStart, type CalEvent, type CalMarket } from './calendar'

export type LimitLevel = 'ok' | 'warn' | 'stop'

/** Share of a limit at which the warning starts. */
export const WARN_AT = 0.8

export interface Goals {
  /** Monthly target in R (positive), null = no goal. */
  monthlyR: number | null
  /** Daily / weekly loss limits in R (positive numbers, e.g. 3 = −3R), null = off. */
  dailyLossR: number | null
  weeklyLossR: number | null
}

export const NO_GOALS: Goals = { monthlyR: null, dailyLossR: null, weeklyLossR: null }

/** Each market's current trading date at `nowIso`. */
export function marketToday(nowIso: string): Record<CalMarket, string> {
  return { KR: tradeDate(nowIso, 'KR'), US: tradeDate(nowIso, 'US') }
}

export interface RSum {
  r: number
  /** Results without a 1R (no stop, no planned risk) — left out of `r`. */
  missing: number
}

function sumR(events: CalEvent[], keep: (e: CalEvent) => boolean): RSum {
  let r = 0
  let missing = 0
  for (const e of events) {
    if (!keep(e)) continue
    if (e.r === null) missing++
    else r += e.r
  }
  return { r, missing }
}

/** Realized R today (per market's own date). */
export function todayR(events: CalEvent[], nowIso: string): RSum {
  const t = marketToday(nowIso)
  return sumR(events, (e) => e.date === t[e.market])
}

/** Realized R this week, Monday through today, per market's own calendar. */
export function weekR(events: CalEvent[], nowIso: string): RSum {
  const t = marketToday(nowIso)
  const from = { KR: weekStart(t.KR), US: weekStart(t.US) }
  return sumR(events, (e) => e.date >= from[e.market] && e.date <= t[e.market])
}

/** Realized R between two dates (inclusive), e.g. a calendar month. */
export function rangeR(events: CalEvent[], from: string, to: string): RSum {
  return sumR(events, (e) => e.date >= from && e.date <= to)
}

/**
 * Where a realized result stands against a loss limit (limit given as a
 * positive R amount). null when the limit is off.
 */
export function limitLevel(realizedR: number, limitR: number | null): LimitLevel | null {
  if (!limitR || !(limitR > 0)) return null
  const loss = -realizedR
  if (loss >= limitR - 1e-9) return 'stop'
  if (loss >= limitR * WARN_AT - 1e-9) return 'warn'
  return 'ok'
}

export interface RiskState {
  today: RSum
  week: RSum
  daily: LimitLevel | null
  weekly: LimitLevel | null
  /** The worse of the two. */
  level: LimitLevel | null
}

const RANK: Record<LimitLevel, number> = { ok: 0, warn: 1, stop: 2 }

export function riskState(events: CalEvent[], goals: Goals, nowIso: string): RiskState {
  const today = todayR(events, nowIso)
  const week = weekR(events, nowIso)
  const daily = limitLevel(today.r, goals.dailyLossR)
  const weekly = limitLevel(week.r, goals.weeklyLossR)
  const levels = [daily, weekly].filter((x): x is LimitLevel => x !== null)
  const level = levels.length ? levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : null
  return { today, week, daily, weekly, level }
}

/** Progress toward the monthly goal, 0–1 (clamped; losses show 0). null without a goal. */
export function goalProgress(r: number, goalR: number | null): number | null {
  if (!goalR || !(goalR > 0)) return null
  return Math.max(0, Math.min(1, r / goalR))
}
