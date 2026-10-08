/**
 * Display formatting for money and R. Pure functions — no React, no IndexedDB.
 * Minus sign is U+2212 so numbers align in monospace columns.
 */

export type Currency = 'KRW' | 'USD'

const MINUS = '−'

function sign(n: number): string {
  if (n > 0) return '+'
  if (n < 0) return MINUS
  return ''
}

/** +1.9R / −0.6R / 0.0R */
export function formatR(r: number, digits = 1): string {
  const abs = Math.abs(r).toFixed(digits)
  return `${Number(abs) === 0 ? '' : sign(r)}${abs}R`
}

/** +₩1,011,000 / −$84.60 — KRW has no decimals, USD has two. */
export function formatMoney(amount: number, currency: Currency, signed = true): string {
  const digits = currency === 'KRW' ? 0 : 2
  const symbol = currency === 'KRW' ? '₩' : '$'
  const rounded = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  const s = signed && Number(rounded.replace(/,/g, '')) !== 0 ? sign(amount) : amount < 0 ? MINUS : ''
  return `${s}${symbol}${rounded}`
}

/** Tone for coloring a P&L value: KR convention → profit red, loss blue. */
export type PnlTone = 'profit' | 'loss' | 'flat'
export function pnlTone(n: number): PnlTone {
  if (n > 0) return 'profit'
  if (n < 0) return 'loss'
  return 'flat'
}
