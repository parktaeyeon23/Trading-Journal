import type { ComponentType } from 'react'
import { AnalysisIcon, CalculatorIcon, CalendarIcon, NotesIcon, TradesIcon } from './icons'

export type TabId = 'calendar' | 'trades' | 'calculator' | 'analysis' | 'notes'
/** Tabs plus screens reached from elsewhere (settings opens from the sync status). */
export type RouteId = TabId | 'settings'

export interface RouteDef {
  id: TabId
  label: string
  Icon: ComponentType<{ size?: number }>
}

/** Order = sidebar / bottom-tab order (PRD 9: 캘린더(홈) · 트레이드 · 계산기 · 분석 · 노트). */
export const ROUTES: RouteDef[] = [
  { id: 'calendar', label: '캘린더', Icon: CalendarIcon },
  { id: 'trades', label: '트레이드', Icon: TradesIcon },
  { id: 'calculator', label: '계산기', Icon: CalculatorIcon },
  { id: 'analysis', label: '분석', Icon: AnalysisIcon },
  { id: 'notes', label: '노트', Icon: NotesIcon },
]

const ALL_ROUTES: RouteId[] = [...ROUTES.map((r) => r.id), 'settings']

export const DEFAULT_ROUTE: RouteId = 'calendar'

export function parseHash(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '').split('/')[0]
  return (ALL_ROUTES as string[]).includes(id) ? (id as RouteId) : DEFAULT_ROUTE
}

export const hrefFor = (id: RouteId) => `#/${id}`
