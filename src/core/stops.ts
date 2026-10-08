/**
 * Stop-placement helpers for the calculator, from daily bars (oldest first).
 */
import type { Bar } from './risk'
import type { Direction } from './sizing'

type FullBar = { high: number; low: number; close: number }

function full(bars: Bar[]): FullBar[] {
  return bars.filter((b): b is Bar & FullBar => typeof b.high === 'number' && typeof b.low === 'number' && typeof b.close === 'number')
}

/** Simple ATR (plain mean, not Wilder-smoothed) of the true range over the last `period` bars. */
export function atr(bars: Bar[], period = 14): number | null {
  const b = full(bars)
  if (b.length < 2) return null
  const trs: number[] = []
  for (let i = 1; i < b.length; i++) {
    const prevClose = b[i - 1].close
    trs.push(Math.max(b[i].high - b[i].low, Math.abs(b[i].high - prevClose), Math.abs(b[i].low - prevClose)))
  }
  const last = trs.slice(-period)
  return last.reduce((s, v) => s + v, 0) / last.length
}

/** Average daily range %, (high ÷ low − 1) averaged over `period` bars. */
export function adrPct(bars: Bar[], period = 20): number | null {
  const b = full(bars).slice(-period).filter((x) => x.low > 0)
  if (!b.length) return null
  return (b.reduce((s, x) => s + (x.high / x.low - 1), 0) / b.length) * 100
}

export function atrStop(direction: Direction, entry: number, bars: Bar[], multiple = 1.5, period = 14): number | null {
  const a = atr(bars, period)
  if (a === null) return null
  return direction === 'long' ? entry - a * multiple : entry + a * multiple
}

/** Today's low (long) or high (short) — the last bar. */
export function dayExtremeStop(direction: Direction, bars: Bar[]): number | null {
  const b = full(bars)
  if (!b.length) return null
  const last = b[b.length - 1]
  return direction === 'long' ? last.low : last.high
}

/** Lowest low (long) or highest high (short) of the last `lookback` bars. */
export function swingStop(direction: Direction, bars: Bar[], lookback = 10): number | null {
  const b = full(bars).slice(-lookback)
  if (!b.length) return null
  return direction === 'long' ? Math.min(...b.map((x) => x.low)) : Math.max(...b.map((x) => x.high))
}
