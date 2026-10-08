/**
 * Which daily-bar windows to fetch so every closed trade has bars for its
 * holding period (MFE/MAE). Pure.
 */

export interface HoldWindow {
  /** MarketCache symbol, e.g. "KR:042700". */
  cacheSymbol: string
  /** First entry and last exit, on the market's own calendar (YYYY-MM-DD). */
  from: string
  to: string
}

export interface FetchWindow {
  cacheSymbol: string
  from: string
  to: string
}

const DAY = 86400000
const ms = (d: string) => Date.parse(d + 'T00:00:00Z')
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Holidays and weekends: a bar within this many days of each end counts as covering it. */
export const EDGE_SLACK_DAYS = 4
/** Longest single request (the backend allows a bit more). */
export const MAX_FETCH_DAYS = 700

/** True when cached bars reach both ends of the window (allowing for holidays). */
export function covered(w: { from: string; to: string }, dates: string[]): boolean {
  const startHi = iso(ms(w.from) + EDGE_SLACK_DAYS * DAY)
  const endLo = iso(ms(w.to) - EDGE_SLACK_DAYS * DAY)
  return dates.some((d) => d >= w.from && d <= startHi) && dates.some((d) => d >= endLo && d <= w.to)
}

/**
 * Uncovered holding windows merged per symbol into as few requests as
 * possible, each at most MAX_FETCH_DAYS long. Sorted by symbol, then date.
 * @param have cached bar dates per cacheSymbol
 */
export function windowsToFetch(holds: HoldWindow[], have: Map<string, string[]>): FetchWindow[] {
  const bySymbol = new Map<string, HoldWindow[]>()
  for (const h of holds) {
    if (!(h.from <= h.to)) continue
    if (covered(h, have.get(h.cacheSymbol) ?? [])) continue
    const list = bySymbol.get(h.cacheSymbol) ?? []
    list.push(h)
    bySymbol.set(h.cacheSymbol, list)
  }
  const out: FetchWindow[] = []
  for (const sym of [...bySymbol.keys()].sort()) {
    const list = bySymbol.get(sym)!.sort((a, b) => (a.from < b.from ? -1 : 1))
    let cur: FetchWindow | null = null
    for (const h of list) {
      if (cur && (ms(h.to) - ms(cur.from)) / DAY <= MAX_FETCH_DAYS) {
        if (h.to > cur.to) cur.to = h.to
        continue
      }
      if (cur) out.push(cur)
      cur = { cacheSymbol: sym, from: h.from, to: h.to }
    }
    if (cur) out.push(cur)
  }
  return out
}
