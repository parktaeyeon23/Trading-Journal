/**
 * R-multiple, MFE/MAE, open risk. R always uses the ORIGINAL stop.
 */
import { compareFills, entrySide, type PnlFill } from './pnl'
import type { Direction } from './sizing'

/**
 * Money value of 1R for a position.
 * 1) the planned risk amount when there is one,
 * 2) else first-stage entry qty × |first-stage average − original stop|.
 * null when neither can be computed (no original stop and no plan).
 */
export function oneR(args: {
  direction: Direction
  originalStop: number | null | undefined
  plannedRisk?: number | null
  fills: PnlFill[]
}): number | null {
  if (args.plannedRisk && args.plannedRisk > 0) return args.plannedRisk
  if (!args.originalStop || !(args.originalStop > 0)) return null
  const side = entrySide(args.direction)
  const entries = args.fills.filter((f) => f.side === side).sort(compareFills)
  if (!entries.length) return null
  const staged = entries.filter((f) => f.pyramid_stage === 1)
  // Without stage info, the first fill (by time) stands for stage 1.
  const first = staged.length ? staged : [entries[0]]
  const qty = first.reduce((s, f) => s + f.qty, 0)
  const avg = first.reduce((s, f) => s + f.price * f.qty, 0) / qty
  const r = qty * Math.abs(avg - args.originalStop)
  return r > 0 ? r : null
}

export function rMultiple(pnl: number, oneRValue: number | null): number | null {
  return oneRValue && oneRValue > 0 ? pnl / oneRValue : null
}

export interface Bar {
  date: string
  open?: number | null
  high?: number | null
  low?: number | null
  close?: number | null
}

export interface Excursion {
  /** Best move in the trade's favor, percent of entry (≥ 0). */
  mfePct: number
  /** Worst move against the trade, percent of entry (≤ 0). */
  maePct: number
  /** Same moves in R, when the original stop is known. */
  mfeR: number | null
  maeR: number | null
}

/** MFE/MAE from daily bars between entry and exit dates (inclusive). */
export function excursion(direction: Direction, entryPrice: number, originalStop: number | null | undefined, bars: Bar[]): Excursion | null {
  const highs = bars.map((b) => b.high).filter((v): v is number => typeof v === 'number')
  const lows = bars.map((b) => b.low).filter((v): v is number => typeof v === 'number')
  if (!highs.length || !lows.length || !(entryPrice > 0)) return null
  const hi = Math.max(...highs)
  const lo = Math.min(...lows)
  const fav = direction === 'long' ? hi - entryPrice : entryPrice - lo
  const adv = direction === 'long' ? lo - entryPrice : entryPrice - hi
  const perR = originalStop ? Math.abs(entryPrice - originalStop) : 0
  return {
    mfePct: (Math.max(fav, 0) / entryPrice) * 100,
    maePct: (Math.min(adv, 0) / entryPrice) * 100,
    mfeR: perR ? Math.max(fav, 0) / perR : null,
    maeR: perR ? Math.min(adv, 0) / perR : null,
  }
}

export interface OpenRiskItem {
  openQty: number
  avgCost: number
  /** Current stop (after any moves). */
  stop: number | null | undefined
  /** Account size of the position's market. */
  account: number
  direction: Direction
}

/**
 * Sum of what every open position would lose at its current stop, as percent
 * of its own account. A stop already past breakeven contributes 0.
 * Positions without a stop are counted separately — their risk is unknown.
 */
export function openRiskPct(items: OpenRiskItem[]): { pct: number; withoutStop: number } {
  let pct = 0
  let withoutStop = 0
  for (const it of items) {
    if (it.openQty <= 0) continue
    if (!it.stop || !(it.account > 0)) {
      withoutStop++
      continue
    }
    const loss = it.direction === 'long' ? it.avgCost - it.stop : it.stop - it.avgCost
    if (loss > 0) pct += ((loss * it.openQty) / it.account) * 100
  }
  return { pct, withoutStop }
}
