import type { ComponentType } from 'react'
import { AnalysisScreen } from './features/analysis/AnalysisScreen'
import { CalculatorScreen } from './features/calculator/CalculatorScreen'
import { CalendarScreen } from './features/calendar/CalendarScreen'
import { NotesScreen } from './features/notes/NotesScreen'
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
}

export default function App() {
  const route = useRoute()
  const Screen = SCREENS[route]
  // reviewPending comes from the data layer once Step 2/5 land.
  return (
    <Shell current={route} reviewPending={0}>
      <Screen />
    </Shell>
  )
}
