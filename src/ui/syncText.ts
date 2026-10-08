import type { SyncStatus } from '../data/sync'

const LABEL: Record<SyncStatus['state'], string> = {
  unconfigured: '동기화 미설정',
  idle: '동기화됨',
  syncing: '동기화 중…',
  offline: '오프라인',
  error: '동기화 오류',
}

export function syncLabel(s: SyncStatus): string {
  if (s.state === 'idle' && s.pending > 0) return `대기 ${s.pending}건`
  if ((s.state === 'offline' || s.state === 'error') && s.pending > 0) return `${LABEL[s.state]} · 대기 ${s.pending}건`
  return LABEL[s.state]
}

/** 10. 8. 16:44 style, in the viewer's local time. */
export function formatClock(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
