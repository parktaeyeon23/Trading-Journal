/**
 * R-based position sizing — same rules as the Darren Trading calculator:
 *   qty           = floor(account × RPT% ÷ |entry − stop|)
 *   position %    = RPT% ÷ stop %          (the stop width decides the size)
 *   account risk% = position % × stop %
 */

export type Direction = 'long' | 'short'

export interface SizingInput {
  direction: Direction
  /** Account size in the market's currency. */
  account: number
  /** Risk per trade, percent of account (1.25 = 1.25%). */
  rptPct: number
  entry: number
  stop: number
  /** Position size cap, percent of account. Default 25. */
  maxPositionPct?: number
}

export interface SizingResult {
  /** |entry − stop| ÷ entry, percent. */
  stopPct: number
  /** RPT% ÷ stop% — the position size the rule asks for, before rounding. */
  positionPct: number
  qty: number
  positionSize: number
  riskAmount: number
  /** Risk after rounding qty down, percent of account. */
  accountRiskPct: number
  /** Present when the position would exceed maxPositionPct. */
  capped: null | {
    maxPositionPct: number
    qty: number
    positionSize: number
    riskAmount: number
    accountRiskPct: number
  }
}

export type SizingError = 'not_positive' | 'stop_equals_entry' | 'stop_wrong_side'

export type SizingOutcome = { ok: true; result: SizingResult } | { ok: false; error: SizingError }

export const DEFAULT_MAX_POSITION_PCT = 25

export function sizePosition(input: SizingInput): SizingOutcome {
  const { direction, account, rptPct, entry, stop } = input
  const maxPositionPct = input.maxPositionPct ?? DEFAULT_MAX_POSITION_PCT
  if (!(account > 0) || !(rptPct > 0) || !(entry > 0) || !(stop > 0)) return { ok: false, error: 'not_positive' }
  if (entry === stop) return { ok: false, error: 'stop_equals_entry' }
  if ((direction === 'long' && stop > entry) || (direction === 'short' && stop < entry)) {
    return { ok: false, error: 'stop_wrong_side' }
  }

  const perShare = Math.abs(entry - stop)
  const stopPct = (perShare / entry) * 100
  const riskBudget = (account * rptPct) / 100
  const qty = Math.floor(riskBudget / perShare + 1e-9)
  const result: SizingResult = {
    stopPct,
    positionPct: (rptPct / stopPct) * 100,
    qty,
    positionSize: qty * entry,
    riskAmount: qty * perShare,
    accountRiskPct: ((qty * perShare) / account) * 100,
    capped: null,
  }

  const maxQty = Math.floor((account * maxPositionPct) / 100 / entry + 1e-9)
  if (qty > maxQty) {
    result.capped = {
      maxPositionPct,
      qty: maxQty,
      positionSize: maxQty * entry,
      riskAmount: maxQty * perShare,
      accountRiskPct: ((maxQty * perShare) / account) * 100,
    }
  }
  return { ok: true, result }
}
