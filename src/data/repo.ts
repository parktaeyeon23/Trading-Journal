import type { RowError } from './backend'
import { CONFLICTS, META, OUTBOX, type AppDb } from './db'
import { shouldApplyServerRow, type OutboxEntry } from './syncPlan'
import type { BaseRow, EntityMap, EntityName } from './types'

/** What a caller passes to put(): any subset of fields, id optional for new rows. */
export type RowInput<E extends EntityName> = Partial<Omit<EntityMap[E], 'created_at' | 'updated_at'>> & { id?: string }

export interface ConflictRecord {
  seq?: number
  /** conflict: the server had a newer version and won. rejected: the server refused the row. */
  kind: 'conflict' | 'rejected'
  entity: EntityName
  id: string | null
  local: BaseRow | null
  server: BaseRow | null
  errors?: RowError[]
  at: string
}

export interface ListOptions {
  includeDeleted?: boolean
}

type Listener = (entity: EntityName | null) => void

export function newId(): string {
  return crypto.randomUUID()
}

/** Drops undefined so rows stay JSON-clean and match what the server stores. */
function clean<T extends object>(row: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v
  return out as T
}

/**
 * Local-first data access. Every write lands in IndexedDB and the outbox in one
 * transaction, so a change is never saved without also being queued for sync.
 * Screens read only through this class.
 */
export class LocalRepo {
  readonly db: AppDb
  private now: () => Date
  private listeners = new Set<Listener>()

  constructor(db: AppDb, now: () => Date = () => new Date()) {
    this.db = db
    this.now = now
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(entity: EntityName | null) {
    this.listeners.forEach((fn) => fn(entity))
  }

  // ---------- reads ----------

  async get<E extends EntityName>(entity: E, id: string): Promise<EntityMap[E] | undefined> {
    return this.db.get(entity, id)
  }

  async list<E extends EntityName>(entity: E, opts: ListOptions = {}): Promise<EntityMap[E][]> {
    const rows = (await this.db.getAll(entity)) as EntityMap[E][]
    return opts.includeDeleted ? rows : rows.filter((r) => !r.deleted)
  }

  async listByPosition<E extends EntityName>(entity: E, positionId: string, opts: ListOptions = {}): Promise<EntityMap[E][]> {
    const rows = (await this.db.getAllFromIndex(entity, 'position_id', positionId)) as EntityMap[E][]
    return opts.includeDeleted ? rows : rows.filter((r) => !r.deleted)
  }

  // ---------- writes ----------

  /**
   * Creates or patches a row. Fields not given keep their current values.
   * updated_at always moves forward, even for two writes in the same millisecond,
   * so the server's last-write-wins ordering matches the order of local edits.
   */
  async put<E extends EntityName>(entity: E, input: RowInput<E>): Promise<EntityMap[E]> {
    const id = input.id ?? newId()
    const tx = this.db.transaction([entity, OUTBOX], 'readwrite')
    const existing = (await tx.objectStore(entity).get(id)) as BaseRow | undefined
    const now = this.now()
    let updatedMs = now.getTime()
    if (existing && Date.parse(existing.updated_at) >= updatedMs) updatedMs = Date.parse(existing.updated_at) + 1
    const nowIso = now.toISOString()
    const row = clean({
      deleted: false,
      ...existing,
      ...input,
      id,
      created_at: existing?.created_at ?? nowIso,
      updated_at: new Date(updatedMs).toISOString(),
    }) as unknown as EntityMap[E]
    await tx.objectStore(entity).put(row)
    const entry: Omit<OutboxEntry, 'seq'> = { entity, id, row: row as BaseRow, at: nowIso }
    await tx.objectStore(OUTBOX).add(entry)
    await tx.done
    this.emit(entity)
    return row
  }

  /** Soft delete: the row stays (deleted = true) so the deletion syncs like any edit. */
  async remove(entity: EntityName, id: string): Promise<void> {
    const existing = await this.get(entity, id)
    if (!existing || existing.deleted) return
    await this.put(entity, { id, deleted: true } as RowInput<typeof entity>)
  }

  // ---------- sync support ----------

  async pendingEntries(): Promise<OutboxEntry[]> {
    return (await this.db.getAll(OUTBOX)) as OutboxEntry[]
  }

  async pendingCount(): Promise<number> {
    return this.db.count(OUTBOX)
  }

  async clearOutbox(seqs: number[]): Promise<void> {
    if (!seqs.length) return
    const tx = this.db.transaction(OUTBOX, 'readwrite')
    await Promise.all(seqs.map((s) => tx.store.delete(s)))
    await tx.done
  }

  /** Is there an unsent change for this row (optionally newer than a given seq)? */
  async hasPending(entity: EntityName, id: string, afterSeq = 0): Promise<boolean> {
    const keys = (await this.db.getAllKeysFromIndex(OUTBOX, 'entity_id', [entity, id])) as number[]
    return keys.some((k) => k > afterSeq)
  }

  /**
   * Writes rows that came from the server, skipping any that would clobber an
   * unsent local change or a newer local copy. Does not touch the outbox.
   */
  async applyServerRows(entity: EntityName, rows: BaseRow[]): Promise<number> {
    if (!rows.length) return 0
    const tx = this.db.transaction([entity, OUTBOX], 'readwrite')
    const store = tx.objectStore(entity)
    const pendingIdx = tx.objectStore(OUTBOX).index('entity_id')
    let applied = 0
    for (const row of rows) {
      const local = (await store.get(row.id)) as BaseRow | undefined
      const pending = (await pendingIdx.count([entity, row.id])) > 0
      if (shouldApplyServerRow(local, row, pending)) {
        await store.put(clean(row))
        applied++
      }
    }
    await tx.done
    if (applied) this.emit(entity)
    return applied
  }

  async addConflict(rec: ConflictRecord): Promise<void> {
    await this.db.add(CONFLICTS, rec)
  }

  async listConflicts(): Promise<ConflictRecord[]> {
    return ((await this.db.getAll(CONFLICTS)) as ConflictRecord[]).reverse()
  }

  async clearConflicts(): Promise<void> {
    await this.db.clear(CONFLICTS)
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.db.get(META, key)
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put(META, value, key)
  }
}
