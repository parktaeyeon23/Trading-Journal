import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { useData } from './data/dataStore'
import { loadAllTrades } from './data/trades'
import { todayKst } from './features/calendar/calText'
import { postChartDays } from './features/chartbook/postChart'
import { CalendarScreen } from './features/calendar/CalendarScreen'
import type { RouteId } from './ui/routes'
import { Shell } from './ui/Shell'
import { UpdateBanner } from './ui/UpdateBanner'
import { useRepoQuery } from './ui/useRepoQuery'
import { useRoute } from './ui/useRoute'

// The calendar is the home screen and ships in the main bundle; the other tabs
// load on first visit (and are prefetched when the browser is idle). The service
// worker precaches every chunk, so this still works offline.
const loaders = {
  trades: () => import('./features/trades/TradesScreen').then((m) => ({ default: m.TradesScreen })),
  calculator: () => import('./features/calculator/CalculatorScreen').then((m) => ({ default: m.CalculatorScreen })),
  analysis: () => import('./features/analysis/AnalysisScreen').then((m) => ({ default: m.AnalysisScreen })),
  notes: () => import('./features/notes/NotesScreen').then((m) => ({ default: m.NotesScreen })),
  settings: () => import('./features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })),
}
const TradesScreen = lazy(loaders.trades)
const CalculatorScreen = lazy(loaders.calculator)
const AnalysisScreen = lazy(loaders.analysis)
const NotesScreen = lazy(loaders.notes)
const SettingsScreen = lazy(loaders.settings)

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

  // Fetch the other tabs once the first screen is up, so switching is instant.
  useEffect(() => {
    if (!ready) return
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500))
    idle(() => Object.values(loaders).forEach((load) => void load().catch(() => {})))
  }, [ready])

  // New screen → start at the top.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route.id, route.param])

  const Screen = SCREENS[route.id]
  return (
    <Shell current={route.id} reviewPending={counts?.reviewPending ?? 0} postDue={counts?.postDue ?? 0}>
      {ready ? (
        <Suspense fallback={<p className="empty">불러오는 중…</p>}>
          <Screen />
        </Suspense>
      ) : (
        <p className="empty">불러오는 중…</p>
      )}
      <UpdateBanner />
    </Shell>
  )
}
