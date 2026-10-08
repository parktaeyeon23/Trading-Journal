/**
 * Daily notes and weekly reviews. Fixed ids per date / week, so two devices
 * writing the same day's note before syncing update one row instead of
 * creating two.
 */
import type { LocalRepo } from './repo'
import { readSetting, writeSetting } from './settings'
import type { DailyNote, WeeklyReview } from './types'

export const dailyNoteId = (date: string) => `note-${date}`
export const weeklyReviewId = (weekStart: string) => `week-${weekStart}`

export const WEEKLY_QUESTIONS_KEY = 'weekly_questions'
export const DEFAULT_WEEKLY_QUESTIONS = ['이번 주 가장 잘한 결정은?', '가장 비싼 실수와 그 원인은?', '다음 주 집중할 규칙 하나']

export async function readDailyNote(repo: LocalRepo, date: string): Promise<DailyNote | null> {
  const row = await repo.get('DailyNotes', dailyNoteId(date))
  return row && !row.deleted ? row : null
}

export async function saveDailyNote(repo: LocalRepo, date: string, patch: { premarket?: string | null; postmarket?: string | null }): Promise<DailyNote> {
  return repo.put('DailyNotes', { id: dailyNoteId(date), date, ...patch })
}

export interface WeeklyAnswer {
  q: string
  a: string
  /** 'memo' marks the free "한 주 정리" note stored alongside the answers (no extra sheet column). */
  kind?: 'memo'
}

export const MEMO_LABEL = '한 주 정리'

export interface ParsedWeeklyReview {
  /** Question answers, without the memo. */
  answers: WeeklyAnswer[]
  memo: string
}

/** Splits a stored answers array into question answers and the week memo. */
export function parseWeeklyAnswers(raw: unknown): ParsedWeeklyReview {
  const list = Array.isArray(raw) ? (raw as WeeklyAnswer[]).filter((x) => x && typeof x.q === 'string') : []
  const memo = list.find((x) => x.kind === 'memo')
  return { answers: list.filter((x) => x.kind !== 'memo').map((x) => ({ q: x.q, a: x.a ?? '' })), memo: memo?.a ?? '' }
}

/** True when anything was written: an answer or the memo. */
export const isWritten = (p: ParsedWeeklyReview) => !!p.memo.trim() || p.answers.some((a) => a.a.trim())

/** Answers keep their question text, so editing the template later never re-labels old answers. */
export async function readWeeklyReview(repo: LocalRepo, weekStart: string): Promise<{ row: WeeklyReview | null } & ParsedWeeklyReview> {
  const row = await repo.get('WeeklyReviews', weeklyReviewId(weekStart))
  if (!row || row.deleted) return { row: null, answers: [], memo: '' }
  return { row, ...parseWeeklyAnswers(row.answers) }
}

export async function saveWeeklyReview(repo: LocalRepo, weekStart: string, answers: WeeklyAnswer[], memo = ''): Promise<WeeklyReview> {
  const stored: WeeklyAnswer[] = answers.map((x) => ({ q: x.q, a: x.a }))
  if (memo.trim()) stored.push({ q: MEMO_LABEL, a: memo, kind: 'memo' })
  return repo.put('WeeklyReviews', { id: weeklyReviewId(weekStart), week_start: weekStart, answers: stored as unknown as WeeklyReview['answers'] })
}

/**
 * Questions to show for a week: the saved answers' questions first (in their
 * order), then any template question not yet answered.
 */
export function mergeQuestions(template: string[], answers: WeeklyAnswer[]): WeeklyAnswer[] {
  const out = answers.map((x) => ({ q: x.q, a: x.a ?? '' }))
  for (const q of template) if (!out.some((x) => x.q === q)) out.push({ q, a: '' })
  return out
}

export async function readWeeklyQuestions(repo: LocalRepo): Promise<string[]> {
  const v = await readSetting<unknown>(repo, WEEKLY_QUESTIONS_KEY, null)
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : DEFAULT_WEEKLY_QUESTIONS
}

export async function writeWeeklyQuestions(repo: LocalRepo, questions: string[]): Promise<void> {
  await writeSetting(repo, WEEKLY_QUESTIONS_KEY, questions.map((q) => q.trim()).filter(Boolean))
}
