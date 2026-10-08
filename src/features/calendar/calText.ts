import type { CSSProperties } from 'react'
import { intensity, tradeDate, weekdayMon0, type CalUnit } from '../../core/calendar'
import { formatCompact, formatUnit } from '../../core/format'

export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

export const UNITS: { v: CalUnit; label: string }[] = [
  { v: 'KRW', label: 'KRW' },
  { v: 'USD', label: 'USD' },
  { v: 'R', label: 'R' },
  { v: 'PCT', label: '%' },
]

export const compact = (v: number, unit: CalUnit, short = false) => formatCompact(v, unit, short)
export const full = (v: number, unit: CalUnit) => formatUnit(v, unit)

/** Today on the Seoul calendar. */
export const todayKst = () => tradeDate(new Date().toISOString(), 'KR')

/** "10/7" */
export const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

/** "10월 7일 (수)" */
export const longDate = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${WEEKDAYS[weekdayMon0(date)]})`

/**
 * Heat colour for a day: profit red / loss blue mixed into the surface, stronger
 * the closer the day is to the period's largest day. Text flips to white on strong fills.
 */
export function heatStyle(value: number, maxAbs: number): CSSProperties | undefined {
  const k = intensity(value, maxAbs)
  if (!k) return undefined
  const pct = Math.round((k * 0.6 + 0.08) * 100)
  const tone = value > 0 ? 'profit' : 'loss'
  return {
    background: `color-mix(in srgb, var(--${tone}) ${pct}%, var(--surface))`,
    color: pct > 45 ? 'var(--on-pnl)' : `var(--${tone}-strong)`,
    borderColor: 'transparent',
  }
}

export const toneClass = (v: number) => (v > 0 ? 'profit' : v < 0 ? 'loss' : '')
