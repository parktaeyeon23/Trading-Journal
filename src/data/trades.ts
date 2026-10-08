/**
 * Trade operations: everything that changes a position goes through here so
 * the status always follows the fills.
 */
import { pyramidState } from '../core/pyramid'
import { compareFills, entrySide, positionPnl } from '../core/pnl'
import { deriveStatus, summarizeTrade, type TradeSummary } from '../core/trade'
import type { LocalRepo, RowInput } from './repo'
import type { ChartImage, Fill, Market, Plan, Position, PositionTag, Review, Rule, StopChange, Tag } from './types'

// ---------- defaults ----------

/** Rule.setup value for the "하지 말아야 할 것" list. */
export const DONT_RULES = '__dont__'

const DEFAULT_TAGS: { id: string; family: Tag['family']; name: string }[] = [
  { id: 'tag-setup-vcp', family: 'setup', name: 'VCP 돌파' },
  { id: 'tag-setup-pullback', family: 'setup', name: '눌림목' },
  { id: 'tag-setup-ep', family: 'setup', name: 'EP' },
  { id: 'tag-mistake-chase', family: 'mistake', name: '추격매수' },
  { id: 'tag-mistake-late-stop', family: 'mistake', name: '손절 지연' },
  { id: 'tag-mistake-early-exit', family: 'mistake', name: '조기 익절' },
  { id: 'tag-mistake-oversize', family: 'mistake', name: '과대 사이즈' },
  { id: 'tag-mistake-no-plan', family: 'mistake', name: '무계획 진입' },
  { id: 'tag-mistake-fomo', family: 'mistake', name: 'FOMO' },
  { id: 'tag-mistake-early-stop-move', family: 'mistake', name: '조기 손절 이동' },
  { id: 'tag-emotion-confident', family: 'emotion', name: '확신' },
  { id: 'tag-emotion-calm', family: 'emotion', name: '침착' },
  { id: 'tag-emotion-impatient', family: 'emotion', name: '조급함' },
  { id: 'tag-emotion-fear', family: 'emotion', name: '두려움' },
  { id: 'tag-emotion-greed', family: 'emotion', name: '탐욕' },
  { id: 'tag-emotion-bored', family: 'emotion', name: '지루함' },
]

const DEFAULT_RULES: { id: string; setup: string; text: string }[] = [
  { id: 'rule-vcp-volume', setup: 'VCP 돌파', text: '돌파일 거래량 50일 평균 2배 이상' },
  { id: 'rule-vcp-regime', setup: 'VCP 돌파', text: '추세장 국면에서만 신규 진입' },
  { id: 'rule-pullback-count', setup: '눌림목', text: '1·2차 눌림만 (3차 눌림 제외)' },
  { id: 'rule-pullback-confirm', setup: '눌림목', text: '반등 확인 후 진입, 실패 시 빠른 손절' },
  { id: 'rule-ep-gap', setup: 'EP', text: '갭 상승과 거래량 급증 동반' },
]

/**
 * Seeds default tags and rules once. Fixed ids mean two devices seeding before
 * their first sync end up with the same rows, not duplicates. A default the
 * user deleted stays deleted.
 */
export async function ensureDefaults(repo: LocalRepo): Promise<void> {
  for (const t of DEFAULT_TAGS) {
    if (!(await repo.get('Tags', t.id))) await repo.put('Tags', { ...t })
  }
  for (const r of DEFAULT_RULES) {
    if (!(await repo.get('Rules', r.id))) await repo.put('Rules', { ...r, active: true })
  }
}

// ---------- reading ----------

export interface TradeBundle {
  position: Position
  plan: Plan | null
  fills: Fill[]
  stops: StopChange[]
  review: Review | null
  tags: PositionTag[]
  /** Uploaded/linked chart images, by slot order then sort. */
  charts: ChartImage[]
  summary: TradeSummary
  /** Latest stop: the last move, else the original stop. */
  currentStop: number | null
}

export async function loadTrade(repo: LocalRepo, positionId: string): Promise<TradeBundle | null> {
  const position = await repo.get('Positions', positionId)
  if (!position || position.deleted) return null
  const [plans, fills, stops, reviews, tags, charts] = await Promise.all([
    repo.listByPosition('Plans', positionId),
    repo.listByPosition('Fills', positionId),
    repo.listByPosition('StopHistory', positionId),
    repo.listByPosition('Reviews', positionId),
    repo.listByPosition('PositionTags', positionId),
    repo.listByPosition('ChartImages', positionId),
  ])
  const plan = latest(plans)
  const sortedFills = [...fills].sort(compareFills)
  const sortedStops = [...stops].sort((a, b) => (a.ts < b.ts ? -1 : 1))
  return {
    position,
    plan,
    fills: sortedFills,
    stops: sortedStops,
    review: latest(reviews),
    tags,
    charts: [...charts].sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || (a.sort ?? 0) - (b.sort ?? 0) || (a.created_at < b.created_at ? -1 : 1)),
    summary: summarizeTrade({ direction: position.direction, originalStop: position.original_stop, plan, fills: sortedFills }),
    currentStop: sortedStops.length ? sortedStops[sortedStops.length - 1].new_stop : (position.original_stop ?? null),
  }
}

export async function loadAllTrades(repo: LocalRepo): Promise<TradeBundle[]> {
  const positions = await repo.list('Positions')
  const out: TradeBundle[] = []
  for (const p of positions) {
    const t = await loadTrade(repo, p.id)
    if (t) out.push(t)
  }
  return out
}

export const SLOT_ORDER: Record<ChartImage['slot'], number> = { setup: 0, entry: 1, exit: 2, post: 3, free: 4 }

function latest<T extends { updated_at: string }>(rows: T[]): T | null {
  return rows.length ? [...rows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] : null
}

// ---------- writing ----------

export interface NewPlanInput {
  position: Omit<RowInput<'Positions'>, 'status' | 'no_plan'> & { ticker: string; market: Market; direction: Position['direction'] }
  plan: Omit<RowInput<'Plans'>, 'position_id'>
}

export async function createPlannedTrade(repo: LocalRepo, input: NewPlanInput): Promise<Position> {
  const position = await repo.put('Positions', { ...input.position, status: 'planned', no_plan: false })
  await repo.put('Plans', { ...input.plan, position_id: position.id })
  return position
}

export async function updatePlan(repo: LocalRepo, position: Position, plan: Plan | null, changes: { position?: RowInput<'Positions'>; plan?: RowInput<'Plans'> }) {
  if (changes.position) await repo.put('Positions', { ...changes.position, id: position.id })
  if (changes.plan) {
    await repo.put('Plans', { ...changes.plan, id: plan?.id, position_id: position.id })
    // Adding a plan to a no-plan trade does not erase the fact it started without one.
  }
}

export interface FillInput {
  ts: string
  side: Fill['side']
  price: number
  qty: number
  fee?: number | null
  tax?: number | null
  memo?: string | null
}

/** The pyramid stage a new entry fill belongs to, from the plan's split. */
export function nextPyramidStage(plan: Plan | null, fills: Fill[], direction: Position['direction']): number | null {
  const pp = plan?.pyramid_plan as { weights?: number[] } | undefined
  if (!pp?.weights?.length || !plan?.plan_qty) return null
  const side = entrySide(direction)
  const st = pyramidState(plan.plan_qty, pp.weights, fills.filter((f) => f.side === side))
  return st.nextStage ?? pp.weights.length
}

export async function addFill(repo: LocalRepo, positionId: string, input: FillInput): Promise<Fill> {
  const t = await loadTrade(repo, positionId)
  if (!t) throw new Error('포지션을 찾을 수 없습니다.')
  const isEntry = input.side === entrySide(t.position.direction)
  const fill = await repo.put('Fills', {
    ...input,
    position_id: positionId,
    pyramid_stage: isEntry ? nextPyramidStage(t.plan, t.fills, t.position.direction) : null,
  })
  await refreshStatus(repo, positionId)
  return fill
}

export async function removeFill(repo: LocalRepo, fillId: string): Promise<void> {
  const f = await repo.get('Fills', fillId)
  if (!f) return
  await repo.remove('Fills', fillId)
  await refreshStatus(repo, f.position_id)
}

/** A fill typed before any plan exists: opens a new no-plan position. */
export async function createUnplannedTrade(
  repo: LocalRepo,
  input: { ticker: string; market: Market; direction: Position['direction']; ticker_name?: string | null; fill: FillInput },
): Promise<Position> {
  const position = await repo.put('Positions', {
    ticker: input.ticker,
    ticker_name: input.ticker_name ?? null,
    market: input.market,
    direction: input.direction,
    status: 'open',
    no_plan: true,
  })
  await addFill(repo, position.id, input.fill)
  return position
}

export async function moveStop(repo: LocalRepo, positionId: string, newStop: number, reason: string | null): Promise<StopChange> {
  const t = await loadTrade(repo, positionId)
  if (!t) throw new Error('포지션을 찾을 수 없습니다.')
  return repo.put('StopHistory', { position_id: positionId, ts: new Date().toISOString(), old_stop: t.currentStop, new_stop: newStop, reason })
}

/** Re-derives status from fills and review. Never touches a planned trade's other fields. */
export async function refreshStatus(repo: LocalRepo, positionId: string): Promise<void> {
  const t = await loadTrade(repo, positionId)
  if (!t) return
  const pnl = positionPnl(t.position.direction, t.fills)
  const next = deriveStatus(pnl.entryQty, pnl.openQty, !!t.review)
  if (next !== t.position.status) await repo.put('Positions', { id: positionId, status: next })
}

export interface ReviewInput {
  checklist: Record<string, boolean>
  grade: Review['grade']
  good: string | null
  improve: string | null
  next_rule: string | null
  promoted_rule: boolean
  /** Selected tag ids by family; emotion tags carry their phase. */
  mistakeTagIds: string[]
  emotionTags: { tagId: string; phase: 'entry' | 'hold' | 'exit' }[]
}

export async function saveReview(repo: LocalRepo, positionId: string, input: ReviewInput): Promise<Review> {
  const t = await loadTrade(repo, positionId)
  if (!t) throw new Error('포지션을 찾을 수 없습니다.')
  const review = await repo.put('Reviews', {
    id: t.review?.id,
    position_id: positionId,
    checklist: input.checklist,
    grade: input.grade,
    good: input.good,
    improve: input.improve,
    next_rule: input.next_rule,
    promoted_rule: input.promoted_rule,
  })

  // Sync mistake/emotion tags: keep matches, add new, soft-delete removed.
  const allTags = await repo.list('Tags', { includeDeleted: true })
  const family = new Map(allTags.map((x) => [x.id, x.family]))
  // The review owns every tag that is not known to be a setup/regime tag —
  // including ones whose Tag row has not synced to this device yet.
  const managed = t.tags.filter((pt) => {
    const f = family.get(pt.tag_id)
    return f !== 'setup' && f !== 'regime'
  })
  const want = new Set([...input.mistakeTagIds.map((id) => `${id}|`), ...input.emotionTags.map((e) => `${e.tagId}|${e.phase}`)])
  const have = new Set<string>()
  for (const pt of managed) {
    const key = `${pt.tag_id}|${pt.phase ?? ''}`
    if (want.has(key)) have.add(key)
    else await repo.remove('PositionTags', pt.id)
  }
  for (const key of want) {
    if (have.has(key)) continue
    const [tagId, phase] = key.split('|')
    await repo.put('PositionTags', { position_id: positionId, tag_id: tagId, phase: (phase || null) as PositionTag['phase'] })
  }

  // Promote the next-action rule to the "하지 말아야 할 것" list once.
  const text = input.next_rule?.trim()
  if (input.promoted_rule && text) {
    const id = `rule-dont-${positionId}`
    const existing = await repo.get('Rules', id)
    if (!existing || existing.text !== text || existing.deleted) await repo.put('Rules', { id, setup: DONT_RULES, text, active: true, deleted: false })
  }

  await refreshStatus(repo, positionId)
  return review
}

/** Active checklist rules for a setup (setup-specific first), excluding the don't-list. */
export function rulesForSetup(rules: Rule[], setup: string | null | undefined): Rule[] {
  return rules.filter((r) => r.active !== false && r.setup !== DONT_RULES && r.setup && r.setup === setup)
}
