import { createContext, useContext } from 'react'
import type { CalEvent } from '../../core/calendar'
import type { Goals, RiskState } from '../../core/goals'

export interface RiskInfo {
  goals: Goals
  /** Every realized result (exit-day basis, no filters) — the goals ignore calendar filters. */
  events: CalEvent[]
  state: RiskState
}

/** Computed once in App from all trades; read by the banner, calendar and entry forms. */
export const RiskContext = createContext<RiskInfo | null>(null)

export const useRisk = () => useContext(RiskContext)
