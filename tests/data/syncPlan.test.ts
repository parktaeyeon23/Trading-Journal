import { describe, expect, it } from 'vitest'
import { backoffMs, buildBatch, MAX_ROWS_PER_OP, shouldApplyServerRow, type OutboxEntry } from '../../src/data/syncPlan'
import type { BaseRow, EntityName } from '../../src/data/types'

const row = (id: string, updated_at = '2026-10-08T00:00:00.000Z', extra: Record<string, unknown> = {}): BaseRow =>
  ({ id, created_at: '2026-10-08T00:00:00.000Z', updated_at, ...extra }) as BaseRow

let seq = 0
const entry = (entity: EntityName, r: BaseRow): OutboxEntry => ({ seq: ++seq, entity, id: r.id, row: r, at: r.updated_at })

describe('buildBatch', () => {
  it('sends only the newest change per row', () => {
    const { ops, seqs } = buildBatch([
      entry('Positions', row('p1', '2026-10-08T00:00:01.000Z', { status: 'open' })),
      entry('Positions', row('p1', '2026-10-08T00:00:02.000Z', { status: 'done' })),
    ])
    expect(ops).toHaveLength(1)
    expect(ops[0].rows).toEqual([expect.objectContaining({ id: 'p1', status: 'done' })])
    expect(seqs).toHaveLength(2)
  })

  it('orders parents before children regardless of write order', () => {
    const { ops } = buildBatch([entry('Fills', row('f1')), entry('Reviews', row('r1')), entry('Positions', row('p1')), entry('Accounts', row('a1'))])
    expect(ops.map((o) => o.entity)).toEqual(['Accounts', 'Positions', 'Fills', 'Reviews'])
  })

  it('splits large entities into ops of at most the server limit', () => {
    const entries = Array.from({ length: MAX_ROWS_PER_OP + 3 }, (_, i) => entry('MarketCache', row('m' + i)))
    const { ops } = buildBatch(entries)
    expect(ops.map((o) => o.rows.length)).toEqual([MAX_ROWS_PER_OP, 3])
  })

  it('returns nothing for an empty outbox', () => {
    expect(buildBatch([])).toEqual({ ops: [], seqs: [] })
  })
})

describe('shouldApplyServerRow', () => {
  const server = row('p1', '2026-10-08T00:00:05.000Z')
  it('applies new rows and newer versions', () => {
    expect(shouldApplyServerRow(undefined, server, false)).toBe(true)
    expect(shouldApplyServerRow(row('p1', '2026-10-08T00:00:01.000Z'), server, false)).toBe(true)
    expect(shouldApplyServerRow(row('p1', '2026-10-08T00:00:05.000Z'), server, false)).toBe(true)
  })
  it('never overwrites a newer local copy or an unsent local change', () => {
    expect(shouldApplyServerRow(row('p1', '2026-10-08T00:00:09.000Z'), server, false)).toBe(false)
    expect(shouldApplyServerRow(row('p1', '2026-10-08T00:00:01.000Z'), server, true)).toBe(false)
  })
})

describe('backoffMs', () => {
  it('doubles from 2s and caps at 5 minutes', () => {
    expect([0, 1, 2, 3].map(backoffMs)).toEqual([0, 2000, 4000, 8000])
    expect(backoffMs(20)).toBe(300000)
  })
})
