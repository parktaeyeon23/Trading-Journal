import { useData } from '../data/dataStore'
import { hrefFor } from './routes'
import { formatClock, syncLabel } from './syncText'

/** Small status link to the settings screen; used in the sidebar and the mobile top bar. */
export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const status = useData((s) => s.status)
  const tone = status.state === 'error' ? 'bad' : status.state === 'idle' && status.pending === 0 ? 'good' : 'neutral'
  return (
    <a className={`sync-badge sync-${tone}`} href={hrefFor('settings')} aria-label={`${syncLabel(status)} — 설정 열기`}>
      <span className="sync-dot" aria-hidden="true" />
      <span>{syncLabel(status)}</span>
      {!compact && status.state === 'idle' && status.lastSyncAt && <span className="sync-time">· {formatClock(status.lastSyncAt)}</span>}
    </a>
  )
}
