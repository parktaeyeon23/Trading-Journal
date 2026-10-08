/**
 * Per-trade derived numbers and the automatic review checks.
 */
import { compareFills, entrySide, positionPnl, type PnlFill, type PositionPnl } from './pnl'
import { oneR, rMultiple } from './risk'
import type { Direction } from './sizing'

export interface TradePlanInput {
  plan_entry?: number | null
  plan_qty?: number | null
  risk_amount?: number | null
}

export interface TradeInput {
  direction: Direction
  originalStop: number | null | undefined
  plan: TradePlanInput | null
  fills: PnlFill[]
}

export interface TradeSummary {
  pnl: PositionPnl
  oneR: number | null
  /** Realized net P&L in R (null without 1R). */
  r: number | null
  /** Price of the first entry fill. */
  firstEntry: number | null
  /** (first entry − planned entry) ÷ planned entry, percent. Positive = paid more (long). */
  entryDeviationPct: number | null
  /** (total entry qty − planned qty) ÷ planned qty, percent. */
  qtyDeviationPct: number | null
}

function firstEntryPrice(direction: Direction, fills: PnlFill[]): number | null {
  const side = entrySide(direction)
  const entries = fills.filter((f) => f.side === side).sort(compareFills)
  return entries.length ? entries[0].price : null
}

export function summarizeTrade(t: TradeInput): TradeSummary {
  const pnl = positionPnl(t.direction, t.fills)
  const r1 = oneR({ direction: t.direction, originalStop: t.originalStop, plannedRisk: t.plan?.risk_amount, fills: t.fills })
  const first = firstEntryPrice(t.direction, t.fills)
  const pe = t.plan?.plan_entry
  const pq = t.plan?.plan_qty
  return {
    pnl,
    oneR: r1,
    r: pnl.exitQty > 0 ? rMultiple(pnl.realizedNet, r1) : null,
    firstEntry: first,
    entryDeviationPct: first !== null && pe ? ((first - pe) / pe) * 100 : null,
    qtyDeviationPct: pnl.entryQty > 0 && pq ? ((pnl.entryQty - pq) / pq) * 100 : null,
  }
}

/** Ids of the built-in checklist items every review gets. */
export const BUILTIN_CHECKS = {
  entry: 'builtin:entry',
  size: 'builtin:size',
  stop: 'builtin:stop',
} as const

export const BUILTIN_CHECK_LABELS: Record<string, string> = {
  [BUILTIN_CHECKS.entry]: '진입가 계획 ±1% 이내',
  [BUILTIN_CHECKS.size]: '사이즈 계획 이내',
  [BUILTIN_CHECKS.stop]: '손절 지킴 (원 손절가보다 불리하게 청산하지 않음)',
}

/** Slippage allowed past the original stop before "손절 지킴" fails. */
export const STOP_SLIPPAGE = 0.005
/** How far the first entry may be from plan and still count as on plan. */
export const ENTRY_TOLERANCE = 0.01

/**
 * Pre-fills the built-in checks from the numbers. null = cannot tell yet
 * (no fills / no exits / no stop) — the user decides. A missing plan fails
 * the plan-based checks, because there was nothing to follow.
 */
export function autoChecks(t: TradeInput): Record<string, boolean | null> {
  const side = entrySide(t.direction)
  const entries = t.fills.filter((f) => f.side === side)
  const exits = t.fills.filter((f) => f.side !== side)
  const first = firstEntryPrice(t.direction, t.fills)
  const pe = t.plan?.plan_entry
  const pq = t.plan?.plan_qty

  let entry: boolean | null = null
  if (first !== null) {
    if (!pe) entry = false
    else entry = t.direction === 'long' ? first <= pe * (1 + ENTRY_TOLERANCE) : first >= pe * (1 - ENTRY_TOLERANCE)
  }

  let size: boolean | null = null
  if (entries.length) {
    const qty = entries.reduce((s, f) => s + f.qty, 0)
    size = pq ? qty <= pq : false
  }

  let stop: boolean | null = null
  const s = t.originalStop
  if (s && exits.length) {
    stop = exits.every((f) => (t.direction === 'long' ? f.price >= s * (1 - STOP_SLIPPAGE) : f.price <= s * (1 + STOP_SLIPPAGE)))
  }

  return { [BUILTIN_CHECKS.entry]: entry, [BUILTIN_CHECKS.size]: size, [BUILTIN_CHECKS.stop]: stop }
}

export type TradeStatus = 'planned' | 'open' | 'review_pending' | 'done'

/** Status follows the fills: nothing bought → planned, shares held → open, flat → review (or done once reviewed). */
export function deriveStatus(entryQty: number, openQty: number, hasReview: boolean): TradeStatus {
  if (entryQty <= 0) return 'planned'
  if (openQty > 0) return 'open'
  return hasReview ? 'done' : 'review_pending'
}
