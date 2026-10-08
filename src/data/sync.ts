import { BackendError, type BackendAdapter, type UpsertResult } from './backend'
import type { LocalRepo } from './repo'
import { backoffMs, buildBatch } from './syncPlan'
import { ENTITY_ORDER, type BaseRow } from './types'

export type SyncState = 'unconfigured' | 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncStatus {
  state: SyncState
  pending: number
  lastSyncAt: string | null
  /** Human-readable reason for the last failure, if any. */
  lastError: string | null
  /** Error code of the last failure (e.g. 'unauthorized'), if any. */
  lastErrorCode: string | null
  conflicts: number
}

export interface SyncReport {
  pushed: number
  pulled: number
  conflicts: number
  rejected: number
}

export interface SyncEngineOptions {
  onStatus?: (s: SyncStatus) => void
  /** Delay after a local write before syncing, so a burst of edits goes in one batch. */
  debounceMs?: number
  /** Background sync interval while the app is open. */
  intervalMs?: number
  isOnline?: () => boolean
  now?: () => Date
}

/** Ops per request — keeps each Apps Script execution short. */
const OPS_PER_REQUEST = 10
const META_LAST_SERVER_TIME = 'lastServerTime'
const META_LAST_SYNC_AT = 'lastSyncAt'

/**
 * Push local changes, then pull remote ones. One sync runs at a time; calls
 * during a run share it. Retryable failures back off exponentially.
 */
export class SyncEngine {
  private repo: LocalRepo
  private adapter: BackendAdapter | null = null
  private opts: Required<SyncEngineOptions>
  private running: Promise<SyncReport | null> | null = null
  private failures = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private cleanup: (() => void)[] = []
  status: SyncStatus = {
    state: 'unconfigured',
    pending: 0,
    lastSyncAt: null,
    lastError: null,
    lastErrorCode: null,
    conflicts: 0,
  }

  constructor(repo: LocalRepo, opts: SyncEngineOptions = {}) {
    this.repo = repo
    this.opts = {
      onStatus: opts.onStatus ?? (() => {}),
      debounceMs: opts.debounceMs ?? 1500,
      intervalMs: opts.intervalMs ?? 5 * 60 * 1000,
      isOnline: opts.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine)),
      now: opts.now ?? (() => new Date()),
    }
  }

  /** Sets (or clears) the backend. Resets the failure count so the next sync runs right away. */
  setAdapter(adapter: BackendAdapter | null) {
    this.adapter = adapter
    this.failures = 0
    this.clearRetry()
    void this.refreshStatus({ state: adapter ? 'idle' : 'unconfigured', lastError: null, lastErrorCode: null })
  }

  /** Wires automatic syncing: after local writes, when coming back online, and on an interval. */
  start() {
    this.cleanup.push(
      this.repo.onChange(() => {
        void this.refreshStatus({})
        this.scheduleSoon()
      }),
    )
    if (typeof window !== 'undefined') {
      const online = () => void this.syncNow()
      const offline = () => void this.refreshStatus({ state: 'offline' })
      window.addEventListener('online', online)
      window.addEventListener('offline', offline)
      this.cleanup.push(() => {
        window.removeEventListener('online', online)
        window.removeEventListener('offline', offline)
      })
    }
    this.intervalTimer = setInterval(() => void this.syncNow(), this.opts.intervalMs)
    void this.refreshStatus({})
    void this.syncNow()
  }

  stop() {
    this.cleanup.forEach((fn) => fn())
    this.cleanup = []
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.clearRetry()
  }

  /** Runs a sync now (or joins the one in progress). Resolves null when nothing could run. */
  syncNow(): Promise<SyncReport | null> {
    if (this.running) return this.running
    this.running = this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private scheduleSoon() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => void this.syncNow(), this.opts.debounceMs)
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private async run(): Promise<SyncReport | null> {
    if (!this.adapter) {
      await this.refreshStatus({ state: 'unconfigured' })
      return null
    }
    if (!this.opts.isOnline()) {
      await this.refreshStatus({ state: 'offline' })
      return null
    }
    this.clearRetry()
    await this.refreshStatus({ state: 'syncing' })
    try {
      const report = await this.pushThenPull(this.adapter)
      this.failures = 0
      const at = this.opts.now().toISOString()
      await this.repo.setMeta(META_LAST_SYNC_AT, at)
      await this.refreshStatus({ state: 'idle', lastSyncAt: at, lastError: null, lastErrorCode: null })
      return report
    } catch (err) {
      const be = err instanceof BackendError ? err : new BackendError('internal', String((err as Error)?.message ?? err))
      this.failures++
      if (be.retryable) {
        this.retryTimer = setTimeout(() => void this.syncNow(), backoffMs(this.failures))
      }
      await this.refreshStatus({ state: be.code === 'network' && !this.opts.isOnline() ? 'offline' : 'error', lastError: describe(be), lastErrorCode: be.code })
      return null
    }
  }

  private async pushThenPull(adapter: BackendAdapter): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, rejected: 0 }

    // ---- push ----
    const entries = await this.repo.pendingEntries()
    if (entries.length) {
      const { ops, seqs } = buildBatch(entries)
      const maxSeq = Math.max(...seqs)
      const results: UpsertResult[] = []
      for (let i = 0; i < ops.length; i += OPS_PER_REQUEST) {
        results.push(...(await adapter.batch(ops.slice(i, i + OPS_PER_REQUEST))))
      }
      await this.repo.clearOutbox(seqs)
      const at = this.opts.now().toISOString()
      for (let i = 0; i < results.length; i++) {
        const op = ops[i]
        const res = results[i]
        report.pushed += res.inserted + res.updated + res.unchanged
        for (const rej of res.rejected) {
          report.rejected++
          await this.repo.addConflict({ kind: 'rejected', entity: op.entity, id: rej.id, local: op.rows[rej.index] ?? null, server: null, errors: rej.errors, at })
        }
        for (const c of res.conflicts) {
          report.conflicts++
          const sent = op.rows.find((r) => r.id === c.id) ?? null
          await this.repo.addConflict({ kind: 'conflict', entity: op.entity, id: c.id, local: sent, server: c.server, at })
          // The server's newer version wins locally too, unless the user edited again meanwhile.
          if (!(await this.repo.hasPending(op.entity, c.id, maxSeq))) {
            await this.repo.applyServerRows(op.entity, [c.server])
          }
        }
      }
    }

    // ---- pull ----
    const since = (await this.repo.getMeta<string>(META_LAST_SERVER_TIME)) ?? null
    const pulled = await adapter.pullAll(since)
    for (const entity of ENTITY_ORDER) {
      const rows = (pulled.data[entity] ?? []) as BaseRow[]
      report.pulled += await this.repo.applyServerRows(entity, rows)
    }
    await this.repo.setMeta(META_LAST_SERVER_TIME, pulled.serverTime)
    return report
  }

  /** Forgets the pull checkpoint so the next sync downloads everything again. */
  async resetCheckpoint() {
    await this.repo.setMeta(META_LAST_SERVER_TIME, null)
  }

  private async refreshStatus(patch: Partial<SyncStatus>) {
    const [pending, conflicts, lastSyncAt] = await Promise.all([
      this.repo.pendingCount(),
      this.repo.listConflicts().then((c) => c.length),
      this.repo.getMeta<string>(META_LAST_SYNC_AT),
    ])
    this.status = { ...this.status, lastSyncAt: lastSyncAt ?? this.status.lastSyncAt, ...patch, pending, conflicts }
    if (!this.adapter && this.status.state !== 'unconfigured') this.status.state = 'unconfigured'
    this.opts.onStatus(this.status)
  }
}

function describe(err: BackendError): string {
  switch (err.code) {
    case 'unauthorized':
      return 'API Secret이 맞지 않습니다.'
    case 'not_setup':
      return 'GAS에서 setupSheets()를 먼저 실행하세요.'
    case 'network':
      return '서버에 연결할 수 없습니다. 네트워크나 웹앱 URL을 확인하세요.'
    case 'busy':
      return '서버가 다른 저장을 처리 중입니다. 잠시 후 다시 시도합니다.'
    default:
      return err.message
  }
}
