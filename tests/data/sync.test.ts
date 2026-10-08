import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendError } from '../../src/data/backend'
import { openAppDb } from '../../src/data/db'
import { GasAdapter } from '../../src/data/gasAdapter'
import { LocalRepo } from '../../src/data/repo'
import { SyncEngine } from '../../src/data/sync'
import { loadGas, type FakeGas } from '../gas/fakeGas'

const SECRET = 'test-secret'
let dbCounter = 0
let gas: FakeGas
const engines: SyncEngine[] = []

/** A "device": its own IndexedDB, clock offset and sync engine, all talking to one fake server. */
async function device(opts: { clockOffsetMs?: number; online?: () => boolean } = {}) {
  const db = await openAppDb(`test-${++dbCounter}`)
  const offset = opts.clockOffsetMs ?? 0
  const now = () => new Date(Date.now() + offset)
  const repo = new LocalRepo(db, now)
  const calls: string[] = []
  const transport = async (body: string) => {
    const req = JSON.parse(body)
    calls.push(req.action)
    return gas.call('handleRequest', req)
  }
  const engine = new SyncEngine(repo, { isOnline: opts.online ?? (() => true), now })
  engine.setAdapter(new GasAdapter({ url: 'https://example.test/exec', secret: SECRET }, transport))
  engines.push(engine)
  return { repo, engine, calls }
}

const serverRows = (entity: string) => gas.call('handleRequest', { secret: SECRET, action: 'pullAll' }).data[entity] as any[]
const tick = () => new Promise((r) => setTimeout(r, 3))

beforeEach(() => {
  gas = loadGas()
  gas.call('setupSheets')
  gas.props.set('API_SECRET', SECRET)
})

afterEach(() => {
  engines.splice(0).forEach((e) => e.stop())
})

describe('local writes', () => {
  it('saves locally first and queues the change', async () => {
    const { repo } = await device()
    const p = await repo.put('Positions', { ticker: '042700', market: 'KR', direction: 'long', status: 'open' })
    expect(p.id).toMatch(/[0-9a-f-]{36}/)
    expect(p.deleted).toBe(false)
    expect(await repo.get('Positions', p.id)).toEqual(p)
    expect(await repo.pendingCount()).toBe(1)
  })

  it('patches existing rows and keeps updated_at strictly increasing', async () => {
    const { repo } = await device()
    const a = await repo.put('Positions', { ticker: 'CRDO', market: 'US', direction: 'long', status: 'open' })
    const b = await repo.put('Positions', { id: a.id, status: 'done' })
    expect(b).toMatchObject({ ticker: 'CRDO', status: 'done', created_at: a.created_at })
    expect(b.updated_at > a.updated_at).toBe(true)
  })

  it('soft-deletes and hides deleted rows from list()', async () => {
    const { repo } = await device()
    const a = await repo.put('Tags', { family: 'mistake', name: '추격매수' })
    await repo.remove('Tags', a.id)
    expect(await repo.list('Tags')).toEqual([])
    expect(await repo.list('Tags', { includeDeleted: true })).toHaveLength(1)
  })
})

describe('sync with the Apps Script backend', () => {
  it('pushes a position and its fills in one batch (parents first) and clears the outbox', async () => {
    const { repo, engine } = await device()
    const fillFirst = await repo.put('Positions', { ticker: 'CRDO', market: 'US', direction: 'long', status: 'open' })
    await repo.put('Fills', { position_id: fillFirst.id, ts: new Date().toISOString(), side: 'buy', price: 72.55, qty: 81 })
    const report = await engine.syncNow()
    expect(report).toMatchObject({ pushed: 2, conflicts: 0, rejected: 0 })
    expect(await repo.pendingCount()).toBe(0)
    expect(serverRows('Fills')).toHaveLength(1)
    expect(engine.status).toMatchObject({ state: 'idle', pending: 0 })
  })

  it('does nothing while offline and catches up when back online', async () => {
    let online = false
    const { repo, engine, calls } = await device({ online: () => online })
    await repo.put('DailyNotes', { date: '2026-10-08', premarket: '반도체 약세' })
    expect(await engine.syncNow()).toBeNull()
    expect(engine.status).toMatchObject({ state: 'offline', pending: 1 })
    expect(calls).toEqual([])
    online = true
    await engine.syncNow()
    expect(serverRows('DailyNotes')).toHaveLength(1)
    expect(engine.status.pending).toBe(0)
  })

  it('gets rows from another device, including ones edited offline long before upload', async () => {
    const a = await device()
    const b = await device()
    await b.engine.syncNow() // B's checkpoint is now "now"
    await tick()
    // A wrote this an hour "ago" by its own clock, and uploads only now.
    const old = await device({ clockOffsetMs: -3600_000 })
    const row = await old.repo.put('Positions', { ticker: 'OLD', market: 'KR', direction: 'long', status: 'done' })
    await old.engine.syncNow()
    await a.engine.syncNow()
    await b.engine.syncNow()
    expect(await b.repo.get('Positions', row.id)).toMatchObject({ ticker: 'OLD' })
    expect(await a.repo.get('Positions', row.id)).toMatchObject({ ticker: 'OLD' })
  })

  it('resolves an edit-edit conflict by last write and keeps the losing version in the log', async () => {
    const a = await device()
    const b = await device()
    const p = await a.repo.put('Positions', { ticker: 'CRDO', market: 'US', direction: 'long', status: 'open' })
    await a.engine.syncNow()
    await b.engine.syncNow()
    expect(await b.repo.get('Positions', p.id)).toBeTruthy()

    await b.repo.put('Positions', { id: p.id, setup: 'B가 먼저 고침' })
    await tick()
    await a.repo.put('Positions', { id: p.id, setup: 'A가 나중에 고침' })
    await a.engine.syncNow() // A's newer edit reaches the server first
    const report = await b.engine.syncNow() // B's older edit comes back as a conflict

    expect(report?.conflicts).toBe(1)
    expect(await b.repo.get('Positions', p.id)).toMatchObject({ setup: 'A가 나중에 고침' })
    const log = await b.repo.listConflicts()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ kind: 'conflict', entity: 'Positions', id: p.id, local: expect.objectContaining({ setup: 'B가 먼저 고침' }) })
    expect(b.engine.status.conflicts).toBe(1)
    expect(serverRows('Positions')[0].setup).toBe('A가 나중에 고침')
  })

  it('records rows the server rejects and does not retry them forever', async () => {
    const { repo, engine } = await device()
    await repo.put('Fills', { position_id: 'no-such-position', ts: new Date().toISOString(), side: 'buy', price: 1, qty: 1 })
    const report = await engine.syncNow()
    expect(report?.rejected).toBe(1)
    expect(await repo.pendingCount()).toBe(0)
    const [rec] = await repo.listConflicts()
    expect(rec).toMatchObject({ kind: 'rejected', entity: 'Fills', errors: [{ field: 'position_id', code: 'ref_missing' }] })
  })

  it('keeps an edit made while a sync is in flight queued for the next sync', async () => {
    const { repo, engine } = await device()
    const p = await repo.put('Positions', { ticker: 'CRDO', market: 'US', direction: 'long', status: 'open' })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const realBatch = (engine as any).adapter.batch.bind((engine as any).adapter)
    ;(engine as any).adapter.batch = async (ops: any) => {
      await gate
      return realBatch(ops)
    }
    const running = engine.syncNow()
    await tick()
    await repo.put('Positions', { id: p.id, status: 'done' })
    release()
    await running
    expect(await repo.pendingCount()).toBe(1)
    expect((await repo.get('Positions', p.id))?.status).toBe('done')
    await engine.syncNow()
    expect(serverRows('Positions')[0].status).toBe('done')
  })

  it('joins concurrent syncNow() calls into one run', async () => {
    const { repo, engine, calls } = await device()
    await repo.put('Tags', { family: 'setup', name: 'VCP 돌파' })
    await Promise.all([engine.syncNow(), engine.syncNow(), engine.syncNow()])
    expect(calls.filter((c) => c === 'batch')).toHaveLength(1)
  })

  it('reports a wrong secret as an error without losing local changes', async () => {
    const { repo, engine } = await device()
    gas.props.set('API_SECRET', 'rotated')
    await repo.put('Tags', { family: 'setup', name: 'EP' })
    expect(await engine.syncNow()).toBeNull()
    expect(engine.status).toMatchObject({ state: 'error', lastErrorCode: 'unauthorized', pending: 1 })
  })

  it('reports an unconfigured backend', async () => {
    const { engine } = await device()
    engine.setAdapter(null)
    expect(await engine.syncNow()).toBeNull()
    expect(engine.status.state).toBe('unconfigured')
  })
})

describe('GasAdapter over fetch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts text/plain JSON including the secret', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, serverTime: 't', schemaVersion: 1 })))
    vi.stubGlobal('fetch', fetchMock)
    await new GasAdapter({ url: 'https://example.test/exec', secret: 's3' }).ping()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.test/exec')
    expect((init.headers as Record<string, string>)['Content-Type']).toMatch(/^text\/plain/)
    expect(JSON.parse(init.body as string)).toEqual({ secret: 's3', action: 'ping' })
  })

  it('maps an HTML page (wrong URL or access) to bad_response and a fetch failure to network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Sign in</html>', { status: 200 })))
    await expect(new GasAdapter({ url: 'u', secret: 's' }).ping()).rejects.toMatchObject({ code: 'bad_response' })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const err = await new GasAdapter({ url: 'u', secret: 's' }).ping().catch((e) => e)
    expect(err).toBeInstanceOf(BackendError)
    expect(err.code).toBe('network')
    expect(err.retryable).toBe(true)
  })

  it('maps server error codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'x' } }))))
    await expect(new GasAdapter({ url: 'u', secret: 's' }).ping()).rejects.toMatchObject({ code: 'unauthorized', retryable: false })
  })
})
