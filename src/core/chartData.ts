/**
 * Data for the automatic chartbook pictures — pure. Which charts a trade can
 * get, over which windows, and the indicator lines on them.
 */
import { addDays, tradeDate, type CalMarket } from './calendar'
import { postChartDue } from './charts'
import { compareFills, entrySide, type PnlFill } from './pnl'
import type { Direction } from './sizing'

// ---------- indicators ----------

/** Simple moving average; null until `n` values are in. */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= n) sum -= values[i - n]
    out.push(i >= n - 1 ? sum / n : null)
  }
  return out
}

/** Exponential moving average (k = 2/(n+1)), seeded with the SMA of the first `n` values. */
export function ema(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = []
  const k = 2 / (n + 1)
  let prev: number | null = null
  let seed = 0
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) {
      seed += values[i]
      out.push(null)
    } else if (i === n - 1) {
      prev = (seed + values[i]) / n
      out.push(prev)
    } else {
      prev = values[i] * k + (prev as number) * (1 - k)
      out.push(prev)
    }
  }
  return out
}

export interface VwapBar {
  date: string
  high: number
  low: number
  close: number
  volume: number | null
}

/**
 * Session VWAP: Σ(typical price × volume) ÷ Σ volume from each session's first
 * bar, typical price = (high + low + close) / 3. Restarts on a new date.
 * null until the session has traded volume.
 */
export function sessionVwap(bars: VwapBar[]): (number | null)[] {
  const out: (number | null)[] = []
  let day = ''
  let pv = 0
  let vol = 0
  for (const b of bars) {
    if (b.date !== day) {
      day = b.date
      pv = 0
      vol = 0
    }
    const v = b.volume ?? 0
    pv += ((b.high + b.low + b.close) / 3) * v
    vol += v
    out.push(vol > 0 ? pv / vol : null)
  }
  return out
}

// ---------- which charts ----------

export type AutoSlot = 'setup' | 'entry' | 'exit' | 'post' | 'free'

export interface ChartJob {
  slot: AutoSlot
  kind: 'daily' | 'intraday'
  /** Bars to request (daily jobs include ~200 sessions before `showFrom` for the 200-day average). */
  fetchFrom: string
  fetchTo: string
  /** Part of the chart that is shown. */
  showFrom: string
  showTo: string
  /** For intraday: the session drawn. */
  date?: string
}

export type SkipReason = 'filled' | 'no_entry' | 'not_closed' | 'post_not_due' | 'intraday_expired'

export interface ChartPlan {
  jobs: ChartJob[]
  skipped: { slot: AutoSlot; reason: SkipReason; date?: string }[]
}

/** Calendar days of history before the visible part, enough for a 200-session average. */
export const WARMUP_DAYS = 300
/** Longest daily request the backend accepts, with a little margin. */
export const MAX_DAILY_DAYS = 790
/** Yahoo keeps 5-minute bars for about 60 days; stay inside that. */
export const INTRADAY_DAYS = 58

const span = (from: string, to: string) => (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000

function daily(slot: AutoSlot, showFrom: string, showTo: string): ChartJob {
  let fetchFrom = addDays(showFrom, -WARMUP_DAYS)
  if (span(fetchFrom, showTo) > MAX_DAILY_DAYS) fetchFrom = addDays(showTo, -MAX_DAILY_DAYS)
  if (fetchFrom > showFrom) showFrom = fetchFrom
  return { slot, kind: 'daily', fetchFrom, fetchTo: showTo, showFrom, showTo }
}

export interface ChartPlanInput {
  market: CalMarket
  direction: Direction
  fills: PnlFill[]
  closed: boolean
  /** Slots that already hold a picture (uploaded, linked or waiting to upload). */
  filled: Set<AutoSlot>
  /** Today on the market's calendar. */
  today: string
}

/**
 * The automatic charts a trade can get now. Fixed slots are only planned when
 * empty; extra entry days go to free attachments.
 */
export function planCharts(t: ChartPlanInput): ChartPlan {
  const plan: ChartPlan = { jobs: [], skipped: [] }
  const side = entrySide(t.direction)
  const fills = [...t.fills].sort(compareFills)
  const entries = fills.filter((f) => f.side === side)
  const exits = fills.filter((f) => f.side !== side)
  if (!entries.length) {
    for (const slot of ['setup', 'entry', 'exit', 'post'] as const) plan.skipped.push({ slot, reason: 'no_entry' })
    return plan
  }
  const entryDay = tradeDate(entries[0].ts, t.market)
  const exitDay = t.closed && exits.length ? tradeDate(exits[exits.length - 1].ts, t.market) : null
  const skip = (slot: AutoSlot, reason: SkipReason, date?: string) => plan.skipped.push(date ? { slot, reason, date } : { slot, reason })

  // ① setup: about six months up to the day before the first entry.
  if (t.filled.has('setup')) skip('setup', 'filled')
  else plan.jobs.push(daily('setup', addDays(entryDay, -182), addDays(entryDay, -1)))

  // ② entry: 5-minute bars with VWAP for each day there was an entry; the first fills ②.
  const entryDays = [...new Set(entries.map((f) => tradeDate(f.ts, t.market)))]
  entryDays.forEach((d, i) => {
    const slot: AutoSlot = i === 0 ? 'entry' : 'free'
    if (slot === 'entry' && t.filled.has('entry')) return skip('entry', 'filled')
    if (span(d, t.today) > INTRADAY_DAYS) return skip(slot, 'intraday_expired', d)
    plan.jobs.push({ slot, kind: 'intraday', fetchFrom: d, fetchTo: d, showFrom: d, showTo: d, date: d })
  })

  // ③ exit: two months before the entry to a week after the last exit.
  if (t.filled.has('exit')) skip('exit', 'filled')
  else if (!exitDay) skip('exit', 'not_closed')
  else plan.jobs.push(daily('exit', addDays(entryDay, -61), minDate(addDays(exitDay, 7), t.today)))

  // ④ post: from the entry to 20 trading days (about a month) after the exit, once 10 have passed.
  if (t.filled.has('post')) skip('post', 'filled')
  else if (!exitDay) skip('post', 'not_closed')
  else if (postChartDue(exitDay, t.today, false) === null) skip('post', 'post_not_due')
  else plan.jobs.push(daily('post', addDays(entryDay, -10), minDate(addDays(exitDay, 30), t.today)))

  return plan
}

const minDate = (a: string, b: string) => (a < b ? a : b)

// ---------- markers ----------

export interface FillMark {
  /** Bar key: the date for daily charts, the bar start (epoch s) for intraday. */
  at: string | number
  side: 'buy' | 'sell'
  isEntry: boolean
  price: number
  qty: number
  stage: number | null
}

/**
 * Where each fill sits on a chart. Daily: its trading date. Intraday: the
 * start of the bar containing it (`barSeconds` long), only for `date`.
 */
export function fillMarks(
  fills: (PnlFill & { pyramid_stage?: number | null })[],
  direction: Direction,
  market: CalMarket,
  opts: { kind: 'daily' } | { kind: 'intraday'; date: string; barSeconds: number },
): FillMark[] {
  const side = entrySide(direction)
  return [...fills]
    .sort(compareFills)
    .filter((f) => opts.kind === 'daily' || tradeDate(f.ts, market) === opts.date)
    .map((f) => {
      const sec = Math.floor(Date.parse(f.ts) / 1000)
      return {
        at: opts.kind === 'daily' ? tradeDate(f.ts, market) : sec - (sec % opts.barSeconds),
        side: f.side,
        isEntry: f.side === side,
        price: f.price,
        qty: f.qty,
        stage: f.pyramid_stage ?? null,
      }
    })
}
