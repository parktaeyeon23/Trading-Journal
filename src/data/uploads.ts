/**
 * Chart images waiting for upload. An image is saved here first (so it is
 * never lost offline), then sent to the backend one at a time. On success the
 * server's ChartImages row lands in the local store and the queue entry goes.
 */
import { BackendError, type BackendAdapter, type UploadImageRequest } from './backend'
import { UPLOADS } from './db'
import type { LocalRepo } from './repo'
import { backoffMs } from './syncPlan'
import type { ChartSlot } from './types'

export interface PendingUpload {
  /** Becomes the ChartImages row id. */
  id: string
  position_id: string
  slot: ChartSlot
  sort: number | null
  mime: string
  data: ArrayBuffer
  thumb: ArrayBuffer | null
  created_at: string
  /** 'waiting' until sent; 'failed' when the server refused it (won't retry by itself). */
  state: 'waiting' | 'failed'
  error: string | null
}

/** base64 without blowing the call stack on multi-MB buffers. */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export class UploadQueue {
  private repo: LocalRepo
  private getAdapter: () => BackendAdapter | null
  private isOnline: () => boolean
  private running: Promise<void> | null = null
  private failures = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()

  constructor(repo: LocalRepo, getAdapter: () => BackendAdapter | null, isOnline: () => boolean = () => navigator.onLine) {
    this.repo = repo
    this.getAdapter = getAdapter
    this.isOnline = isOnline
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  async list(positionId?: string): Promise<PendingUpload[]> {
    const rows = (positionId ? await this.repo.db.getAllFromIndex(UPLOADS, 'position_id', positionId) : await this.repo.db.getAll(UPLOADS)) as PendingUpload[]
    return rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  }

  async add(item: Omit<PendingUpload, 'state' | 'error' | 'created_at'>): Promise<PendingUpload> {
    const full: PendingUpload = { ...item, created_at: new Date().toISOString(), state: 'waiting', error: null }
    await this.repo.db.put(UPLOADS, full)
    this.emit()
    void this.run()
    return full
  }

  async remove(id: string) {
    await this.repo.db.delete(UPLOADS, id)
    this.emit()
  }

  /** Puts a failed item back in line and tries now. */
  async retry(id: string) {
    const item = (await this.repo.db.get(UPLOADS, id)) as PendingUpload | undefined
    if (!item) return
    await this.repo.db.put(UPLOADS, { ...item, state: 'waiting', error: null })
    this.failures = 0
    this.emit()
    await this.run()
  }

  /** Sends waiting items in order. Concurrent calls share one run. */
  run(): Promise<void> {
    if (this.running) return this.running
    this.running = this.drain().finally(() => {
      this.running = null
    })
    return this.running
  }

  stop() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
  }

  private async drain() {
    const adapter = this.getAdapter()
    if (!adapter || !this.isOnline()) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    // Re-list after each pass: images added while this run was busy joined it.
    for (;;) {
      const waiting = (await this.list()).filter((x) => x.state === 'waiting')
      if (!waiting.length) return
      const stop = await this.sendAll(adapter, waiting)
      if (stop) return
    }
  }

  /** @return true when a retryable error stopped the run. */
  private async sendAll(adapter: BackendAdapter, items: PendingUpload[]): Promise<boolean> {
    for (const item of items) {
      const req: UploadImageRequest = {
        id: item.id,
        position_id: item.position_id,
        slot: item.slot,
        sort: item.sort,
        mime: item.mime,
        data: arrayBufferToBase64(item.data),
        thumb: item.thumb ? arrayBufferToBase64(item.thumb) : null,
        created_at: item.created_at,
        updated_at: item.created_at,
      }
      try {
        const row = await adapter.uploadImage(req)
        await this.repo.applyServerRows('ChartImages', [row])
        await this.repo.db.delete(UPLOADS, item.id)
        this.failures = 0
        this.emit()
      } catch (err) {
        const be = err instanceof BackendError ? err : new BackendError('internal', String(err))
        if (be.retryable) {
          // Network or server hiccup: stop here and come back later, in order.
          this.failures++
          this.retryTimer = setTimeout(() => void this.run(), backoffMs(this.failures))
          return true
        }
        await this.repo.db.put(UPLOADS, { ...item, state: 'failed', error: be.message })
        this.emit()
      }
    }
    return false
  }
}
