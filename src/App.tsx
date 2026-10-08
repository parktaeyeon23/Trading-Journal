import { useEffect, type ComponentType } from 'react'
import { useData } from './data/dataStore'
import { loadAllTrades } from './data/trades'
import { todayKst } from './features/calendar/calText'
import { postChartDays } from './features/chartbook/postChart'
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
  const counts = useRepoQuery(async (r) => {
    const trades = await loadAllTrades(r)
    const today = todayKst()
    return {
      reviewPending: trades.filter((t) => t.position.status === 'review_pending').length,
      postDue: trades.filter((t) => postChartDays(t, today) !== null).length,
    }
  }, [])

  useEffect(() => {
    void init()
  }, [init])

  // New screen → start at the top.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route.id, route.param])

  const Screen = SCREENS[route.id]
  return (
    <Shell current={route.id} reviewPending={counts?.reviewPending ?? 0} postDue={counts?.postDue ?? 0}>
      {ready ? <Screen /> : <p className="empty">불러오는 중…</p>}
    </Shell>
  )
}
