import { useRoute } from '../../ui/useRoute'
import { Dashboard } from './Dashboard'
import { Reconcile } from './Reconcile'

export function AnalysisScreen() {
  // #/analysis/2026-10 (from the calendar) opens that month; #/analysis/recon is month-end reconciliation.
  const { param } = useRoute()
  if (param === 'recon' || param?.startsWith('recon-')) return <Reconcile month={param.startsWith('recon-') ? param.slice(6) : null} />
  return <Dashboard key={param ?? ''} param={param} />
}
