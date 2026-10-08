import { beforeEach, describe, expect, it } from 'vitest'
import { loadGas, type FakeGas } from './fakeGas'

const SECRET = 'test-secret'
const T0 = '2026-10-01T00:00:00.000Z'

let gas: FakeGas
const api = (req: Record<string, unknown>) => gas.call('handleRequest', { secret: SECRET, ...req })

function position(id: string, updated_at = T0, extra: Record<string, unknown> = {}) {
  return { id, created_at: T0, updated_at, ticker: '042700', market: 'KR', direction: 'long', status: 'open', ...extra }
}
function fill(id: string, position_id: string, extra: Record<string, unknown> = {}) {
  return { id, created_at: T0, updated_at: T0, position_id, ts: T0, side: 'buy', price: 98500, qty: 10, ...extra }
}

beforeEach(() => {
  gas = loadGas()
  gas.call('setupSheets')
  gas.props.set('API_SECRET', SECRET)
})

describe('setupSheets', () => {
  it('creates every entity sheet with headers and removes the default sheet', () => {
    const ss = [...gas.spreadsheets.values()][0]
    const names = ss.getSheets().map((s) => s.getName())
    expect(names).not.toContain('Sheet1')
    expect(names).toEqual(expect.arrayContaining(['Positions', 'Fills', 'Reviews', 'ChartImages', 'Settings']))
    const header = ss.getSheetByName('Fills')!.getRange(1, 1, 1, 6).getValues()[0]
    expect(header).toEqual(['id', 'created_at', 'updated_at', 'deleted', 'schema_version', 'position_id'])
  })

  it('is idempotent', () => {
    const second = gas.call('setupSheets')
    expect(second.createdSheets).toEqual([])
    expect(second.addedColumns).toEqual({})
    expect(second.addedSettings).toEqual([])
  })

  it('adds a missing column without touching existing data', () => {
    api({ action: 'upsert', entity: 'Positions', rows: [position('p1')] })
    const sheet = [...gas.spreadsheets.values()][0].getSheetByName('Positions')!
    // Simulate an older sheet that lacks the last column.
    const lastCol = sheet.getLastColumn()
    sheet.data.forEach((row) => row.splice(lastCol - 1, 1))
    const res = gas.call('setupSheets')
    expect(res.addedColumns.Positions).toEqual(['legacy_id'])
    const pulled = api({ action: 'pullAll' })
    expect(pulled.data.Positions[0].ticker).toBe('042700')
  })

  it('seeds default settings once', () => {
    const res = api({ action: 'getSettings' })
    expect(res.settings.default_rpt_pct).toBe(1.25)
    expect(res.settings.grade_bands).toEqual({ A: 1, B: 0.8, C: 0.6 })
  })

  it('generates an API secret when none exists', () => {
    const fresh = loadGas()
    fresh.call('setupSheets')
    expect(fresh.props.get('API_SECRET')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('auth and routing', () => {
  it('rejects a wrong or missing secret', () => {
    expect(gas.call('handleRequest', { secret: 'nope', action: 'ping' }).error.code).toBe('unauthorized')
    expect(gas.call('handleRequest', { action: 'ping' }).error.code).toBe('unauthorized')
  })

  it('answers ping', () => {
    const res = api({ action: 'ping' })
    expect(res.ok).toBe(true)
    expect(res.schemaVersion).toBe(1)
  })

  it('rejects unknown actions and entities', () => {
    expect(api({ action: 'drop' }).error.code).toBe('unknown_action')
    expect(api({ action: 'upsert', entity: 'Nope', rows: [] }).error.code).toBe('unknown_entity')
  })

  it('doPost parses the body and returns JSON text', () => {
    const out = (gas.context as any).doPost({ postData: { contents: JSON.stringify({ secret: SECRET, action: 'ping' }) } })
    expect(JSON.parse(out.content).ok).toBe(true)
    const bad = (gas.context as any).doPost({ postData: { contents: 'not json' } })
    expect(JSON.parse(bad.content).error.code).toBe('bad_request')
  })
})

describe('upsert and pullAll', () => {
  it('round-trips a row and keeps text like leading zeros', () => {
    const res = api({ action: 'upsert', entity: 'Positions', rows: [position('p1')] })
    expect(res.results[0]).toMatchObject({ inserted: 1, updated: 0, rejected: [], conflicts: [] })
    const pulled = api({ action: 'pullAll' })
    expect(pulled.data.Positions).toHaveLength(1)
    expect(pulled.data.Positions[0]).toMatchObject({ id: 'p1', ticker: '042700', deleted: false, schema_version: 1 })
  })

  it('stores JSON fields as text and returns them parsed', () => {
    api({ action: 'upsert', entity: 'Positions', rows: [position('p1')] })
    const plan = { id: 'pl1', created_at: T0, updated_at: T0, position_id: 'p1', pyramid_plan: { stages: [50, 30, 20] } }
    api({ action: 'upsert', entity: 'Plans', rows: [plan] })
    const raw = [...gas.spreadsheets.values()][0].getSheetByName('Plans')!.data[1]
    expect(raw).toContain('{"stages":[50,30,20]}')
    expect(api({ action: 'pullAll' }).data.Plans[0].pyramid_plan).toEqual({ stages: [50, 30, 20] })
  })

  it('pullAll(since) returns only rows changed after since', () => {
    api({ action: 'upsert', entity: 'Positions', rows: [position('p1'), position('p2', '2026-10-03T00:00:00Z')] })
    const res = api({ action: 'pullAll', since: '2026-10-02T00:00:00Z' })
    expect(res.data.Positions.map((p: any) => p.id)).toEqual(['p2'])
    expect(api({ action: 'pullAll', since: 'yesterday' }).error.code).toBe('bad_request')
  })

  it('updates in place when updated_at is newer and keeps created_at', () => {
    api({ action: 'upsert', entity: 'Positions', rows: [position('p1')] })
    const res = api({
      action: 'upsert',
      entity: 'Positions',
      rows: [{ ...position('p1', '2026-10-02T00:00:00Z', { status: 'done' }), created_at: '2026-10-02T00:00:00Z' }],
    })
    expect(res.results[0].updated).toBe(1)
    const p = api({ action: 'pullAll' }).data.Positions
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ status: 'done', created_at: T0 })
  })

  it('reports a conflict instead of overwriting with an older row', () => {
    api({ action: 'upsert', entity: 'Positions', rows: [position('p1', '2026-10-05T00:00:00Z', { status: 'done' })] })
    const res = api({ action: 'upsert', entity: 'Positions', rows: [position('p1', '2026-10-04T00:00:00Z')] })
    expect(res.results[0].updated).toBe(0)
    expect(res.results[0].conflicts).toEqual([{ id: 'p1', server: expect.objectContaining({ status: 'done' }) }])
  })

  it('treats a resend with the same updated_at as unchanged (idempotent outbox retries)', () => {
    api({ action: 'upsert', entity: 'Positions', rows: [position('p1')] })
    const res = api({ action: 'upsert', entity: 'Positions', rows: [position('p1')] })
    expect(res.results[0]).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 })
  })

  it('rejects invalid rows field by field and still writes the valid ones', () => {
    api({ action: 'upsert', entity: 'Positions', rows: [position('p1')] })
    const res = api({
      action: 'upsert',
      entity: 'Fills',
      rows: [
        fill('f1', 'p1'),
        fill('f2', 'p1', { price: 0, side: 'hold' }),
        fill('f3', 'ghost'),
        { ...fill('f4', 'p1'), surprise: 1 },
        { id: 'f5' },
      ],
    })
    const r = res.results[0]
    expect(r.inserted).toBe(1)
    const byId = Object.fromEntries(r.rejected.map((x: any) => [x.id, x.errors.map((e: any) => `${e.field}:${e.code}`)]))
    expect(byId.f2).toEqual(expect.arrayContaining(['price:range', 'side:enum']))
    expect(byId.f3).toEqual(['position_id:ref_missing'])
    expect(byId.f4).toEqual(['surprise:unknown_field'])
    expect(byId.f5).toEqual(expect.arrayContaining(['created_at:required', 'position_id:required', 'price:required']))
  })

  it('validates dates and timestamps', () => {
    const res = api({
      action: 'upsert',
      entity: 'DailyNotes',
      rows: [
        { id: 'n1', created_at: T0, updated_at: T0, date: '2026-10-07' },
        { id: 'n2', created_at: T0, updated_at: T0, date: '10/7' },
        { id: 'n3', created_at: 'soon', updated_at: T0, date: '2026-10-07' },
      ],
    })
    expect(res.results[0].inserted).toBe(1)
    expect(res.results[0].rejected.map((x: any) => x.id)).toEqual(['n2', 'n3'])
  })

  it('caps rows per op', () => {
    const rows = Array.from({ length: 501 }, (_, i) => position('p' + i))
    expect(api({ action: 'upsert', entity: 'Positions', rows }).error.code).toBe('too_many_rows')
  })
})

describe('softDelete and batch', () => {
  it('soft-deletes, bumps updated_at, and lists unknown ids', () => {
    api({ action: 'upsert', entity: 'Positions', rows: [position('p1')] })
    const res = api({ action: 'softDelete', entity: 'Positions', ids: ['p1', 'nope'] })
    expect(res.results[0]).toMatchObject({ deleted: 1, notFound: ['nope'] })
    const p = api({ action: 'pullAll', since: T0 }).data.Positions
    expect(p).toHaveLength(1)
    expect(p[0].deleted).toBe(true)
  })

  it('runs ops in order so a child can reference a parent from the same batch', () => {
    const res = api({
      action: 'batch',
      ops: [
        { op: 'upsert', entity: 'Positions', rows: [position('p1')] },
        { op: 'upsert', entity: 'Fills', rows: [fill('f1', 'p1')] },
        { op: 'softDelete', entity: 'Fills', ids: ['f1'] },
      ],
    })
    expect(res.results.map((r: any) => r.inserted ?? r.deleted)).toEqual([1, 1, 1])
  })
})

describe('in-editor test suite', () => {
  it('testApi_all passes against the fake services', () => {
    expect(() => gas.call('testApi_all')).not.toThrow()
  })
})
