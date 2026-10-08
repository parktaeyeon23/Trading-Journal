/**
 * Currency conversion with daily USD/KRW closes.
 */
import type { Currency } from './format'

/**
 * USD/KRW rate for a date: that day's rate, else the latest earlier one within
 * `maxGapDays` (weekends, holidays). null when nothing close enough is known.
 * @param rates date (YYYY-MM-DD) → KRW per 1 USD
 */
export function rateOn(date: string, rates: Record<string, number>, maxGapDays = 7): number | null {
  if (rates[date] > 0) return rates[date]
  const target = Date.parse(date + 'T00:00:00Z')
  let best: { t: number; v: number } | null = null
  for (const [d, v] of Object.entries(rates)) {
    const t = Date.parse(d + 'T00:00:00Z')
    if (!(v > 0) || t > target || target - t > maxGapDays * 86400000) continue
    if (!best || t > best.t) best = { t, v }
  }
  return best ? best.v : null
}

/** Converts to KRW on the given date. KRW passes through. */
export function toKrw(amount: number, currency: Currency, date: string, rates: Record<string, number>): number | null {
  if (currency === 'KRW') return amount
  const r = rateOn(date, rates)
  return r === null ? null : amount * r
}
