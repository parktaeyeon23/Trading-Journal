import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { gradeExecution } from '../../src/core/grade'
import { autoChecks, BUILTIN_CHECKS } from '../../src/core/trade'
import { openAppDb } from '../../src/data/db'
import { LocalRepo } from '../../src/data/repo'
import {
  addFill,
  createPlannedTrade,
  createUnplannedTrade,
  DONT_RULES,
  ensureDefaults,
  loadAllTrades,
  loadTrade,
  moveStop,
  removeFill,
  rulesForSetup,
  saveReview,
  setReasonTags,
} from '../../src/data/trades'

let repo: LocalRepo
let n = 0
beforeEach(async () => {
  repo = new LocalRepo(await openAppDb(`trades-${++n}`))
})

const ts = (d: string) => `2026-10-0${d}T13:00:00.000Z`

async function crdoPlan() {
  return createPlannedTrade(repo, {
    position: { ticker: 'CRDO', market: 'US', direction: 'long', setup: 'VCP 돌파', original_stop: 69.8 },
    plan: { thesis: '3주 수축 후 피벗 돌파', plan_entry: 72.4, plan_stop: 69.8, plan_qty: 162, rpt_pct: 1.25, risk_amount: 421, pyramid_plan: { weights: [50, 30, 20] } },
  })
}

describe('trade lifecycle', () => {
  it('plan → pyramid buys → stop move → scaled exits → review → done', async () => {
    const p = await crdoPlan()
    expect((await loadTrade(repo, p.id))!.position.status).toBe('planned')

    await addFill(repo, p.id, { ts: ts('2'), side: 'buy', price: 72.55, qty: 81 })
    await addFill(repo, p.id, { ts: ts('5'), side: 'buy', price: 74.1, qty: 49 })
    let t = (await loadTrade(repo, p.id))!
    expect(t.position.status).toBe('open')
    expect(t.fills.map((f) => f.pyramid_stage)).toEqual([1, 2])

    await moveStop(repo, p.id, 71.9, '2차 진입 후 본전 근처')
    t = (await loadTrade(repo, p.id))!
    expect(t.currentStop).toBe(71.9)
    expect(t.position.original_stop).toBe(69.8) // R stays on the original stop
    expect(t.stops[0]).toMatchObject({ old_stop: 69.8, new_stop: 71.9 })

    await addFill(repo, p.id, { ts: ts('6'), side: 'sell', price: 75, qty: 60 })
    expect((await loadTrade(repo, p.id))!.position.status).toBe('open')
    await addFill(repo, p.id, { ts: ts('7'), side: 'sell', price: 72.05, qty: 70 })
    t = (await loadTrade(repo, p.id))!
    expect(t.position.status).toBe('review_pending')
    expect(t.summary.oneR).toBe(421)
    expect(t.summary.r).toBeCloseTo(t.summary.pnl.realizedNet / 421, 12)

    const auto = autoChecks({ direction: 'long', originalStop: 69.8, plan: t.plan, fills: t.fills })
    const checklist = { ...auto, 'rule-vcp-volume': true } as Record<string, boolean>
    const g = gradeExecution(checklist, false)
    await saveReview(repo, p.id, {
      checklist,
      grade: g.grade,
      good: '계획 가격 근처 진입',
      improve: '손절을 너무 빨리 올림',
      next_rule: '2차 진입 직후 손절 올리지 않기',
      promoted_rule: true,
      mistakeTagIds: ['tag-mistake-early-stop-move'],
      emotionTags: [{ tagId: 'tag-emotion-impatient', phase: 'hold' }],
    })
    t = (await loadTrade(repo, p.id))!
    expect(t.position.status).toBe('done')
    expect(t.review).toMatchObject({ grade: 'A', checklist: { [BUILTIN_CHECKS.entry]: true } })
    expect(t.tags.map((x) => [x.tag_id, x.phase ?? null]).sort()).toEqual([
      ['tag-emotion-impatient', 'hold'],
      ['tag-mistake-early-stop-move', null],
    ])
    const dont = (await repo.list('Rules')).filter((r) => r.setup === DONT_RULES)
    expect(dont.map((r) => r.text)).toEqual(['2차 진입 직후 손절 올리지 않기'])
  })

  it('editing a review swaps tags instead of piling them up', async () => {
    const p = await crdoPlan()
    await addFill(repo, p.id, { ts: ts('2'), side: 'buy', price: 72.4, qty: 10 })
    await addFill(repo, p.id, { ts: ts('3'), side: 'sell', price: 74, qty: 10 })
    const base = { checklist: {}, grade: null, good: null, improve: null, next_rule: null, promoted_rule: false, emotionTags: [] }
    await saveReview(repo, p.id, { ...base, mistakeTagIds: ['tag-mistake-chase', 'tag-mistake-fomo'] })
    await saveReview(repo, p.id, { ...base, mistakeTagIds: ['tag-mistake-fomo'] })
    const t = (await loadTrade(repo, p.id))!
    expect(t.tags.map((x) => x.tag_id)).toEqual(['tag-mistake-fomo'])
    expect((await repo.listByPosition('Reviews', p.id)).length).toBe(1)
  })

  it('deleting the exit reopens the position', async () => {
    const p = await crdoPlan()
    await addFill(repo, p.id, { ts: ts('2'), side: 'buy', price: 72.4, qty: 10 })
    const sell = await addFill(repo, p.id, { ts: ts('3'), side: 'sell', price: 74, qty: 10 })
    expect((await loadTrade(repo, p.id))!.position.status).toBe('review_pending')
    await removeFill(repo, sell.id)
    const t = (await loadTrade(repo, p.id))!
    expect(t.position.status).toBe('open')
    expect(t.fills).toHaveLength(1)
  })

  it('a fill typed without a plan opens a no-plan position', async () => {
    const p = await createUnplannedTrade(repo, { ticker: '042700', market: 'KR', direction: 'long', fill: { ts: ts('7'), side: 'buy', price: 98500, qty: 10 } })
    const t = (await loadTrade(repo, p.id))!
    expect(t.position).toMatchObject({ no_plan: true, status: 'open' })
    expect(t.fills[0].pyramid_stage).toBeNull()
    expect(gradeExecution(autoChecks({ direction: 'long', originalStop: null, plan: null, fills: t.fills }) as never, true).grade).not.toBe('A')
  })

  it('lists every live trade', async () => {
    await crdoPlan()
    await crdoPlan()
    expect(await loadAllTrades(repo)).toHaveLength(2)
  })
})

describe('defaults', () => {
  it('seeds tags and rules once with fixed ids and respects deletions', async () => {
    await ensureDefaults(repo)
    await ensureDefaults(repo)
    const tags = await repo.list('Tags')
    expect(tags.filter((t) => t.family === 'mistake').map((t) => t.name)).toContain('추격매수')
    expect(new Set(tags.map((t) => t.id)).size).toBe(tags.length)
    await repo.remove('Tags', 'tag-mistake-fomo')
    await ensureDefaults(repo)
    expect((await repo.get('Tags', 'tag-mistake-fomo'))!.deleted).toBe(true)
    const rules = await repo.list('Rules')
    expect(rulesForSetup(rules, '눌림목').map((r) => r.text)).toContain('1·2차 눌림만 (3차 눌림 제외)')
    expect(rulesForSetup(rules, null)).toEqual([])
  })
})

describe('reason tags', () => {
  it('are set on the plan and survive a review that edits mistake tags', async () => {
    await ensureDefaults(repo)
    const p = await createPlannedTrade(repo, {
      position: { ticker: 'CRDO', market: 'US', direction: 'long', setup: 'VCP 돌파', original_stop: 69.8 },
      plan: { plan_entry: 72.4, plan_qty: 10 },
    })
    await setReasonTags(repo, p.id, ['tag-reason-volume', 'tag-reason-rs'])
    await setReasonTags(repo, p.id, ['tag-reason-rs', 'tag-reason-tight'])
    const ids = async () => (await loadTrade(repo, p.id))!.tags.map((t) => t.tag_id).sort()
    expect(await ids()).toEqual(['tag-reason-rs', 'tag-reason-tight'])
    await addFill(repo, p.id, { ts: ts('2'), side: 'buy', price: 72.4, qty: 10 })
    await addFill(repo, p.id, { ts: ts('3'), side: 'sell', price: 75, qty: 10 })
    await saveReview(repo, p.id, { checklist: { a: true }, grade: 'A', good: null, improve: null, next_rule: null, promoted_rule: false, mistakeTagIds: ['tag-mistake-chase'], emotionTags: [] })
    expect(await ids()).toEqual(['tag-mistake-chase', 'tag-reason-rs', 'tag-reason-tight'])
  })
})
