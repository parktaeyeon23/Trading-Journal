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

  useEffect(() => {
    void init()
  }, [init])

  const Screen = SCREENS[route]
  // reviewPending comes from positions in review_pending once Step 5 lands.
  return (
    <Shell current={route} reviewPending={0}>
      {ready ? <Screen /> : <p className="empty">불러오는 중…</p>}
    </Shell>
  )
}
