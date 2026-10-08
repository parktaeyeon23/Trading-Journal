import { create } from 'zustand'
import type { CalUnit, DateBasis } from '../core/calendar'

export type MarketFilter = 'ALL' | 'KR' | 'US'

/**
 * Filters shared by the calendar and (Step 8) the analysis tab. Display
 * preferences (unit, basis, weekends) are remembered on this device.
 */
interface FilterState {
  market: MarketFilter
  setup: string | null
  tagId: string | null
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
  market: 'ALL',
  setup: null,
  tagId: null,
  unit: prefs.unit ?? 'KRW',
  basis: prefs.basis ?? 'exit',
  showWeekends: prefs.showWeekends ?? false,
  set: (patch) => {
    set(patch)
    const s = get()
    savePrefs({ unit: s.unit, basis: s.basis, showWeekends: s.showWeekends })
  },
}))
