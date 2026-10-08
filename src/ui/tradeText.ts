import type { Currency } from '../core/format'

export const STATUS_LABEL: Record<string, string> = {
  planned: '계획',
  open: '보유 중',
  review_pending: '복기 대기',
  done: '완료',
}

export const currencyOf = (market: string): Currency => (market === 'KR' ? 'KRW' : 'USD')

/** Local datetime-local value (YYYY-MM-DDTHH:mm) for "now". */
export function localDateTimeValue(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 10/7 22:58 in local time. */
export function shortDateTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
