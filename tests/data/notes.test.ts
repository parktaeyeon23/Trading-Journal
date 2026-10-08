import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { openAppDb } from '../../src/data/db'
import {
  DEFAULT_WEEKLY_QUESTIONS,
  mergeQuestions,
  readDailyNote,
  readWeeklyQuestions,
  readWeeklyReview,
  saveDailyNote,
  saveWeeklyReview,
  writeWeeklyQuestions,
} from '../../src/data/notes'
import { LocalRepo } from '../../src/data/repo'

let repo: LocalRepo
let n = 0
beforeEach(async () => {
  repo = new LocalRepo(await openAppDb(`notes-${++n}`))
})

describe('notes', () => {
  it('keeps one daily note row per date and merges partial saves', async () => {
    await saveDailyNote(repo, '2026-10-08', { premarket: '반도체 약세, A급만' })
    await saveDailyNote(repo, '2026-10-08', { postmarket: '손절 계획대로' })
    expect(await repo.list('DailyNotes')).toHaveLength(1)
    expect(await readDailyNote(repo, '2026-10-08')).toMatchObject({ id: 'note-2026-10-08', premarket: '반도체 약세, A급만', postmarket: '손절 계획대로' })
    expect(await readDailyNote(repo, '2026-10-09')).toBeNull()
  })

  it('stores weekly answers with their questions and merges the template', async () => {
    expect((await readWeeklyReview(repo, '2026-10-05')).answers).toEqual([])
    await saveWeeklyReview(repo, '2026-10-05', [{ q: '옛 질문', a: '답' }])
    const { answers } = await readWeeklyReview(repo, '2026-10-05')
    expect(mergeQuestions(['새 질문', '옛 질문'], answers)).toEqual([
      { q: '옛 질문', a: '답' },
      { q: '새 질문', a: '' },
    ])
  })

  it('edits the weekly template in settings, falling back to the default', async () => {
    expect(await readWeeklyQuestions(repo)).toEqual(DEFAULT_WEEKLY_QUESTIONS)
    await writeWeeklyQuestions(repo, [' 질문 A ', '', '질문 B'])
    expect(await readWeeklyQuestions(repo)).toEqual(['질문 A', '질문 B'])
  })
})

describe('saved views', () => {
  it('saves by name, replaces, sorts and deletes', async () => {
    const { readSavedViews, saveView, deleteView } = await import('../../src/data/savedViews')
    expect(await readSavedViews(repo)).toEqual([])
    await saveView(repo, { name: 'KR 눌림목 A등급', filters: { market: 'KR', setup: '눌림목', grade: 'A' } })
    await saveView(repo, { name: 'US 전체', filters: { market: 'US' } })
    await saveView(repo, { name: 'KR 눌림목 A등급', filters: { market: 'KR', setup: '눌림목', grade: 'B' } })
    const views = await readSavedViews(repo)
    expect(views.map((v) => v.name)).toEqual(['KR 눌림목 A등급', 'US 전체'])
    expect(views[0].filters.grade).toBe('B')
    await deleteView(repo, 'US 전체')
    expect((await readSavedViews(repo)).map((v) => v.name)).toEqual(['KR 눌림목 A등급'])
  })
})

describe('goals settings', () => {
  it('stores limits as positive R and reads unset ones as off', async () => {
    const { readGoals, writeGoals } = await import('../../src/data/goals')
    expect(await readGoals(repo)).toEqual({ monthlyR: null, dailyLossR: null, weeklyLossR: null })
    await writeGoals(repo, { monthlyR: 10, dailyLossR: -3, weeklyLossR: 0 })
    expect(await readGoals(repo)).toEqual({ monthlyR: 10, dailyLossR: 3, weeklyLossR: null })
  })
})
