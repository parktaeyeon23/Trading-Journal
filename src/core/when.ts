/**
 * Helpers for the "YYYY-MM-DDTHH:mm" values of datetime-local inputs (the
 * device's local time). Pure: calendar arithmetic only, no time zones.
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export function isLocalDateTime(v: string): boolean {
  return LOCAL.test(v)
}

/** Same time of day, `days` calendar days away. */
export function shiftDays(v: string, days: number): string {
  const m = v.match(LOCAL)
  if (!m) return v
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days))
  return `${d.toISOString().slice(0, 10)}T${m[4]}:${m[5]}`
}

/** Same time of day on the previous weekday (Mon → Fri). Holidays are not known. */
export function previousWeekday(v: string): string {
  let out = shiftDays(v, -1)
  for (let i = 0; i < 3; i++) {
    const day = new Date(out.slice(0, 10) + 'T00:00:00Z').getUTCDay()
    if (day !== 0 && day !== 6) return out
    out = shiftDays(out, -1)
  }
  return out
}

/** Replaces the date part, keeping the time. */
export function withDate(v: string, date: string): string {
  return isLocalDateTime(v) && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}${v.slice(10)}` : v
}
