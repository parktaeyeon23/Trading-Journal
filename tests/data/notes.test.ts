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
