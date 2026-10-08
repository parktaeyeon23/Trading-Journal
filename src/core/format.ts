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

/** Parses user-typed numbers like "98,500", " 72.40 ", "₩1,000". NaN when not a number. */
export function parseAmount(text: string): number {
  const s = text.replace(/[,\s₩$]/g, '')
  if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.$/.test(s)) return NaN
  return Number(s)
}

/** Price as typed back into an input: KRW whole numbers, USD up to 4 decimals without trailing zeros. */
export function formatPrice(n: number, currency: Currency): string {
  if (!Number.isFinite(n)) return ''
  if (currency === 'KRW') return Math.round(n).toLocaleString('en-US')
  return String(Math.round(n * 10000) / 10000)
}

/** 27.96% style, one or two decimals. */
export function formatPct(n: number, digits = 2): string {
  return `${n.toFixed(digits)}%`
}

/** Tone for coloring a P&L value: KR convention → profit red, loss blue. */
export type PnlTone = 'profit' | 'loss' | 'flat'
export function pnlTone(n: number): PnlTone {
  if (n > 0) return 'profit'
  if (n < 0) return 'loss'
  return 'flat'
}

/** Signed percent for P&L: +0.42% / −1.10%. */
export function formatSignedPct(n: number, digits = 2): string {
  const abs = Math.abs(n).toFixed(digits)
  return `${Number(abs) === 0 ? '' : sign(n)}${abs}%`
}

/**
 * Short form for calendar cells. KRW in 만/억 (+52.3만, −1.24억), USD in K/M
 * (+$1.2K), R and % with one decimal. Full numbers below 10,000 won / $1,000.
 */
export function formatCompact(value: number, unit: Currency | 'R' | 'PCT', short = false): string {
  if (unit === 'R') return formatR(value)
  if (unit === 'PCT') return formatSignedPct(value, 1)
  const abs = Math.abs(value)
  const trim = (n: number, d: number) => String(Number(n.toFixed(d)))
  if (unit === 'KRW') {
    // short: phone-width cells — whole 만, one decimal 억, no ₩ below 만.
    if (abs >= 1e8) return `${sign(value)}${trim(abs / 1e8, short ? 1 : 2)}억`
    if (abs >= 1e4) return `${sign(value)}${trim(abs / 1e4, short || abs >= 1e6 ? 0 : 1)}만`
    return short ? `${sign(value)}${trim(abs / 1e4, 1)}만` : formatMoney(value, 'KRW')
  }
  if (abs >= 1e6) return `${sign(value)}$${trim(abs / 1e6, short ? 1 : 2)}M`
  if (abs >= 1e3) return `${sign(value)}$${trim(abs / 1e3, short && abs >= 1e4 ? 0 : 1)}K`
  return Math.round(abs) === 0 ? '$0' : `${sign(value)}$${Math.round(abs)}`
}

/** Full form in the calendar's unit. */
export function formatUnit(value: number, unit: Currency | 'R' | 'PCT'): string {
  if (unit === 'R') return formatR(value, 2)
  if (unit === 'PCT') return formatSignedPct(value, 2)
  return formatMoney(value, unit)
}
