/**
 * Position P&L with the moving-average cost method (이동평균법), the way
 * Korean brokers report it: each entry re-averages the cost, each exit
 * realizes (exit price − average cost) × qty and leaves the average unchanged.
 */
import type { Direction } from './sizing'

export interface PnlFill {
  id: string
  ts: string
  /** Tie-breaker when two fills share a timestamp (entered within the same minute). */
  created_at?: string
  side: 'buy' | 'sell'
  price: number
  qty: number
  fee?: number | null
  tax?: number | null
  pyramid_stage?: number | null
}

export interface ExitPnl {
  fillId: string
  ts: string
  qty: number
  price: number
  /** Average cost at the time of this exit. */
  avgCost: number
  /** (price − avgCost) × qty, sign-flipped for shorts. */
  gross: number
  /** gross − this exit's fee/tax − the matching share of entry fee/tax. */
  net: number
}

export interface PositionPnl {
  entryQty: number
  exitQty: number
  openQty: number
  /** Current average cost of the open shares (0 when flat). */
  avgCost: number
  /** Weighted average of every entry fill — what the trade "got in at". */
  avgEntry: number
  /** Average price of the exits. */
  avgExit: number
  realizedGross: number
  /** Sum of exits' net — entry fees count only for the shares already closed. */
  realizedNet: number
  feesTotal: number
  exits: ExitPnl[]
  /** An exit sold more than was held; the excess was ignored. */
  oversold: boolean
}

export function entrySide(direction: Direction): 'buy' | 'sell' {
  return direction === 'long' ? 'buy' : 'sell'
}

const costOf = (f: PnlFill) => (f.fee ?? 0) + (f.tax ?? 0)

/** Chronological order: by fill time, then by when it was recorded. */
export function compareFills(a: PnlFill, b: PnlFill): number {
  if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1
  const ca = a.created_at ?? ''
  const cb = b.created_at ?? ''
  return ca < cb ? -1 : ca > cb ? 1 : 0
}

export function positionPnl(direction: Direction, fills: PnlFill[]): PositionPnl {
  const sorted = [...fills].sort(compareFills)
  const inSide = entrySide(direction)
  const sign = direction === 'long' ? 1 : -1

  let openQty = 0
  let avgCost = 0
  let entryQty = 0
  let entryValue = 0
  let entryFees = 0
  let exitQty = 0
  let exitValue = 0
  let feesTotal = 0
  let oversold = false
  const exits: ExitPnl[] = []

  for (const f of sorted) {
    feesTotal += costOf(f)
    if (f.side === inSide) {
      avgCost = (avgCost * openQty + f.price * f.qty) / (openQty + f.qty)
      openQty += f.qty
      entryQty += f.qty
      entryValue += f.price * f.qty
      entryFees += costOf(f)
      continue
    }
    let qty = f.qty
    if (qty > openQty) {
      oversold = true
      qty = openQty
    }
    if (qty <= 0) continue
    const gross = (f.price - avgCost) * qty * sign
    const entryFeeShare = entryQty > 0 ? (entryFees * qty) / entryQty : 0
    exits.push({ fillId: f.id, ts: f.ts, qty, price: f.price, avgCost, gross, net: gross - costOf(f) - entryFeeShare })
    openQty -= qty
    exitQty += qty
    exitValue += f.price * qty
    if (openQty === 0) avgCost = 0
  }

  return {
    entryQty,
    exitQty,
    openQty,
    avgCost,
    avgEntry: entryQty ? entryValue / entryQty : 0,
    avgExit: exitQty ? exitValue / exitQty : 0,
    realizedGross: exits.reduce((s, e) => s + e.gross, 0),
    realizedNet: exits.reduce((s, e) => s + e.net, 0),
    feesTotal,
    exits,
    oversold,
  }
}
