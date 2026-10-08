/**
 * Grouping for the notes list (day / week / month views). Pure.
 */
import { addDays, monthWeeks, type CalEvent } from '../../core/calendar'

export type NotesView = 'day' | 'week' | 'month'

export interface NoteLike {
  date: string
  premarket?: string | null
  postmarket?: string | null
}

export interface DayR {
  r: number
  /** Realized results that day (some may lack R). */
  trades: number
}

/** Realized R per day (each market's own trading date). */
export function rByDate(events: CalEvent[]): Map<string, DayR> {
  const out = new Map<string, DayR>()
  for (const e of events) {
    const d = out.get(e.date) ?? { r: 0, trades: 0 }
    if (e.r !== null) d.r += e.r
    d.trades++
    out.set(e.date, d)
  }
  return out
}

const hasText = (n: NoteLike) => !!((n.premarket ?? '').trim() || (n.postmarket ?? '').trim())

/** First non-empty line of the note, pre-market first. */
export function snippet(n: NoteLike): string {
  const text = (n.premarket ?? '').trim() || (n.postmarket ?? '').trim()
  return text.split('\n').find((l) => l.trim())?.trim() ?? ''
}

/** Notes written in a month ('YYYY-MM'), newest first. */
export function notesInMonth<T extends NoteLike>(notes: T[], month: string): T[] {
  return notes.filter((n) => n.date.startsWith(month) && hasText(n)).sort((a, b) => (a.date < b.date ? 1 : -1))
}

/** Monday of every week touching the month, newest first. */
export function weekStartsOfMonth(year: number, month: number): string[] {
  return monthWeeks(year, month)
    .map((w) => w[0].date)
    .reverse()
}

/** Notes inside a Monday–Sunday week, oldest first (reads like the week went). */
export function notesInWeek<T extends NoteLike>(notes: T[], weekStart: string): T[] {
  const end = addDays(weekStart, 6)
  return notes.filter((n) => n.date >= weekStart && n.date <= end && hasText(n)).sort((a, b) => (a.date < b.date ? -1 : 1))
}

export interface MonthRow {
  month: number
  key: string
  r: number
  trades: number
  noteDays: number
  /** Weeks starting in this month, and how many have a written review. */
  weeks: number
  reviewsWritten: number
}

/** One row per month of a year, newest first. `written` = week starts with a written review. */
export function yearMonths(year: number, notes: NoteLike[], written: Set<string>, days: Map<string, DayR>): MonthRow[] {
  const rows: MonthRow[] = []
  for (let m = 12; m >= 1; m--) {
    const key = `${year}-${String(m).padStart(2, '0')}`
    let r = 0
    let trades = 0
    for (const [date, d] of days) {
      if (!date.startsWith(key)) continue
      r += d.r
      trades += d.trades
    }
    // A week belongs to the month its Monday falls in, so no week is counted twice.
    const weekStarts = monthWeeks(year, m)
      .map((w) => w[0].date)
      .filter((d) => d.startsWith(key))
    rows.push({
      month: m,
      key,
      r,
      trades,
      noteDays: notesInMonth(notes, key).length,
      weeks: weekStarts.length,
      reviewsWritten: weekStarts.filter((w) => written.has(w)).length,
    })
  }
  return rows
}
