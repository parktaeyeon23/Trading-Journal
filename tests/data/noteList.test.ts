import { describe, expect, it } from 'vitest'
import type { CalEvent } from '../../src/core/calendar'
import { notesInMonth, notesInWeek, rByDate, snippet, weekStartsOfMonth, yearMonths } from '../../src/features/notes/noteList'

const ev = (date: string, r: number | null): CalEvent => ({ tradeId: date + r, market: 'KR', date, net: 0, r })
const notes = [
  { date: '2026-10-08', premarket: '\n관심: CRDO\n국면: 추세', postmarket: '' },
  { date: '2026-10-06', premarket: '', postmarket: '손절 계획대로' },
  { date: '2026-10-05', premarket: '   ', postmarket: null }, // empty: not a note
  { date: '2026-09-30', premarket: '9월 말', postmarket: null },
]

describe('notes list grouping', () => {
  it('sums R per day and counts results without R', () => {
    expect(rByDate([ev('2026-10-06', 1), ev('2026-10-06', -0.5), ev('2026-10-07', null)]).get('2026-10-06')).toEqual({ r: 0.5, trades: 2 })
    expect(rByDate([ev('2026-10-07', null)]).get('2026-10-07')).toEqual({ r: 0, trades: 1 })
  })
  it('lists a month newest first and skips empty notes', () => {
    expect(notesInMonth(notes, '2026-10').map((n) => n.date)).toEqual(['2026-10-08', '2026-10-06'])
    expect(snippet(notes[0])).toBe('관심: CRDO')
    expect(snippet(notes[1])).toBe('손절 계획대로')
  })
  it('lists the weeks touching a month and the notes inside a week', () => {
    expect(weekStartsOfMonth(2026, 10)).toEqual(['2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05', '2026-09-28'])
    expect(notesInWeek(notes, '2026-09-28').map((n) => n.date)).toEqual(['2026-09-30'])
    expect(notesInWeek(notes, '2026-10-05').map((n) => n.date)).toEqual(['2026-10-06', '2026-10-08'])
  })
  it('summarizes each month of a year', () => {
    const rows = yearMonths(2026, notes, new Set(['2026-10-05', '2026-09-28']), rByDate([ev('2026-10-06', 2), ev('2026-09-30', -1)]))
    expect(rows).toHaveLength(12)
    expect(rows[0].month).toBe(12)
    const oct = rows.find((r) => r.month === 10)!
    expect(oct).toMatchObject({ r: 2, trades: 1, noteDays: 2, weeks: 4, reviewsWritten: 1 })
    // The week of Sep 28 belongs to September (its Monday), even though it runs into October.
    expect(rows.find((r) => r.month === 9)).toMatchObject({ r: -1, noteDays: 1, reviewsWritten: 1 })
  })
})
