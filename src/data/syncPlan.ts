/**
 * Pure sync decisions — no IndexedDB, no network — so they are easy to test.
 */
import type { UpsertOp } from './backend'
import { ENTITY_ORDER, type BaseRow, type EntityName } from './types'

/** One unsent local change. `row` is the full row as it was when written. */
export interface OutboxEntry {
  seq: number
  entity: EntityName
  id: string
  row: BaseRow
  at: string
}

/** Server limit per op (gas/Api.js MAX_ROWS_PER_OP). */
export const MAX_ROWS_PER_OP = 500

/**
 * Collapses the outbox into ordered upsert ops: only the newest change per
 * (entity, id) is sent, parents before children, at most MAX_ROWS_PER_OP rows per op.
 * `seqs` lists every entry the batch covers, so all of them can be cleared on success.
 */
export function buildBatch(entries: OutboxEntry[]): { ops: UpsertOp[]; seqs: number[] } {
  const latest = new Map<string, OutboxEntry>()
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) latest.set(`${e.entity}\u0000${e.id}`, e)

  const byEntity = new Map<EntityName, BaseRow[]>()
  for (const e of latest.values()) {
    const list = byEntity.get(e.entity) ?? []
    list.push(e.row)
    byEntity.set(e.entity, list)
  }

  const ops: UpsertOp[] = []
  for (const entity of ENTITY_ORDER) {
    const rows = byEntity.get(entity)
    if (!rows) continue
    for (let i = 0; i < rows.length; i += MAX_ROWS_PER_OP) {
      ops.push({ op: 'upsert', entity, rows: rows.slice(i, i + MAX_ROWS_PER_OP) })
    }
  }
  return { ops, seqs: entries.map((e) => e.seq) }
}

/**
 * Should a row pulled from the server replace the local copy?
 * A row with an unsent local change is never overwritten here — the push
 * either wins or comes back as a conflict, which is handled there.
 */
export function shouldApplyServerRow(local: BaseRow | undefined, server: BaseRow, hasPendingChange: boolean): boolean {
  if (hasPendingChange) return false
  if (!local) return true
  return server.updated_at >= local.updated_at
}

/**
 * Next retry delay after `failures` consecutive failed syncs:
 * 2s, 4s, 8s … capped at 5 minutes.
 */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(2000 * 2 ** (failures - 1), 5 * 60 * 1000)
}
