import { create } from 'zustand'
import type { Grade, ResultFilter } from '../core/analysis'
import type { CalUnit, DateBasis } from '../core/calendar'

export type MarketFilter = 'ALL' | 'KR' | 'US'

/**
 * Filters shared by the calendar and the analysis tab (AND of all set).
 * Display preferences (unit, basis, weekends) are remembered on this device.
 */
export interface SharedFilters {
  market: MarketFilter
  setup: string | null
  /** At most one tag per family; a trade must carry all of them. */
  tagIds: string[]
  grade: Grade | null
  result: ResultFilter | null
}

export const NO_SHARED_FILTERS: SharedFilters = { market: 'ALL', setup: null, tagIds: [], grade: null, result: null }

interface FilterState extends SharedFilters {
  unit: CalUnit
  basis: DateBasis
  showWeekends: boolean
  set: (patch: Partial<Omit<FilterState, 'set'>>) => void
}

const PREFS_KEY = 'aj.filters'
type Prefs = Pick<FilterState, 'unit' | 'basis' | 'showWeekends'>

function loadPrefs(): Partial<Prefs> {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : {}
  } catch {
    return {}
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* private mode: preferences just aren't remembered */
  }
}

const prefs = loadPrefs()

export const useFilters = create<FilterState>((set, get) => ({
  ...NO_SHARED_FILTERS,
  unit: prefs.unit ?? 'KRW',
  basis: prefs.basis ?? 'exit',
  showWeekends: prefs.showWeekends ?? false,
  set: (patch) => {
    set(patch)
    const s = get()
    savePrefs({ unit: s.unit, basis: s.basis, showWeekends: s.showWeekends })
  },
}))
