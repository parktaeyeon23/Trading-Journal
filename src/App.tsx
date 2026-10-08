import { useEffect, type ComponentType } from 'react'
import { useData } from './data/dataStore'
import { AnalysisScreen } from './features/analysis/AnalysisScreen'
import { CalculatorScreen } from './features/calculator/CalculatorScreen'
import { CalendarScreen } from './features/calendar/CalendarScreen'
import { NotesScreen } from './features/notes/NotesScreen'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { TradesScreen } from './features/trades/TradesScreen'
import type { RouteId } from './ui/routes'
import { Shell } from './ui/Shell'
import { useRepoQuery } from './ui/useRepoQuery'
import { useRoute } from './ui/useRoute'

const SCREENS: Record<RouteId, ComponentType> = {
  calendar: CalendarScreen,
  trades: TradesScreen,
  calculator: CalculatorScreen,
  analysis: AnalysisScreen,
  notes: NotesScreen,
  settings: SettingsScreen,
}

export default function App() {
  const route = useRoute()
  const init = useData((s) => s.init)
  const ready = useData((s) => s.ready)
  const reviewPending = useRepoQuery(async (r) => (await r.list('Positions')).filter((p) => p.status === 'review_pending').length, []) ?? 0

  useEffect(() => {
    void init()
  }, [init])

  // New screen → start at the top.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route.id, route.param])

  const Screen = SCREENS[route.id]
  return (
    <Shell current={route.id} reviewPending={reviewPending}>
      {ready ? <Screen /> : <p className="empty">불러오는 중…</p>}
    </Shell>
  )
}
