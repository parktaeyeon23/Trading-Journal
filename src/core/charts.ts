/**
 * Chartbook helpers — pure.
 */

/** Scales (w, h) down so the long side is at most `max`; never scales up. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 }
  const long = Math.max(w, h)
  if (long <= max) return { w, h }
  const k = max / long
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/**
 * TradingView snapshot page → its PNG.
 * https://www.tradingview.com/x/AbCd1234/ → https://s3.tradingview.com/snapshots/a/AbCd1234.png
 * null when the link is not a snapshot link.
 */
export function tradingViewSnapshotImage(link: string): string | null {
  const m = link.trim().match(/^https?:\/\/(?:[a-z]+\.)?tradingview\.com\/x\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/)
  if (!m) return null
  const id = m[1]
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`
}

/** Weekdays strictly after `from` up to and including `to` (YYYY-MM-DD). Holidays are not known, so this is approximate. */
export function tradingDaysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(to + 'T00:00:00Z')
  if (!(b > a)) return 0
  let n = 0
  for (let t = a + 86400000; t <= b; t += 86400000) {
    const d = new Date(t).getUTCDay()
    if (d !== 0 && d !== 6) n++
  }
  return n
}

/** After this many trading days a closed trade should get its post-trade chart. */
export const POST_CHART_AFTER_DAYS = 10

/**
 * Trading days since the exit when the post-trade chart is due and still
 * missing; null when it is not due (or already there).
 */
export function postChartDue(exitDay: string | null, today: string, hasPost: boolean): number | null {
  if (!exitDay || hasPost) return null
  const n = tradingDaysBetween(exitDay, today)
  return n >= POST_CHART_AFTER_DAYS ? n : null
}
