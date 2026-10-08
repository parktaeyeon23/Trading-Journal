import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDump, dumpFileName, DumpError, parseDump, toCsv } from '../../src/data/backup'
import { openAppDb } from '../../src/data/db'
import { GasAdapter } from '../../src/data/gasAdapter'
import { LocalRepo } from '../../src/data/repo'
import { SyncEngine } from '../../src/data/sync'
import { loadGas, type FakeGas } from '../gas/fakeGas'

describe('dump format', () => {
  it('round-trips through JSON and counts rows per entity', () => {
    const row = { id: 'p1', created_at: 'a', updated_at: 'b' }
    const dump = buildDump({ Positions: [row] }, '2026-10-08T00:00:00.000Z')
    expect(dump.counts.Positions).toBe(1)
    expect(dump.counts.Fills).toBe(0)
    expect(parseDump(JSON.stringify(dump)).data.Positions).toEqual([row])
  })

  it('rejects files that are not ours, from the future, or malformed', () => {
    expect(() => parseDump('nope')).toThrow(DumpError)
    expect(() => parseDump(JSON.stringify({ format: 'other' }))).toThrow(/내보내기 파일이 아닙니다/)
    expect(() => parseDump(JSON.stringify({ format: 'alpha-journal-dump', version: 99, data: {} }))).toThrow(/새 버전/)
    expect(() => parseDump(JSON.stringify({ format: 'alpha-journal-dump', version: 1, data: { Hacks: [] } }))).toThrow(/알 수 없는/)
    expect(() => parseDump(JSON.stringify({ format: 'alpha-journal-dump', version: 1, data: { Positions: [{ id: 1 }] } }))).toThrow(/id나 시각/)
  })

  it('writes CSV that survives commas, quotes, newlines and Korean in Excel', () => {
    const csv = toCsv([{ a: '추격매수, 손절 지연', b: 'say "hi"\nnext', c: null, d: { x: 1 } }], ['a', 'b', 'c', 'd'])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toBe('﻿a,b,c,d\r\n"추격매수, 손절 지연","say ""hi""\nnext",,"{""x"":1}"\r\n')
  })

  it('names files by local date and time', () => {
    expect(dumpFileName(new Date(2026, 9, 8, 16, 52))).toBe('alpha-journal-20261008-1652.json')
  })
})

describe('restore on a new device', () => {
  let gas: FakeGas
  let n = 0
  const engines: SyncEngine[] = []
  beforeEach(() => {
    gas = loadGas()
    gas.call('setupSheets')
    gas.props.set('API_SECRET', 's')
  })
  afterEach(() => engines.splice(0).forEach((e) => e.stop()))

  async function device() {
    const repo = new LocalRepo(await openAppDb(`backup-${++n}`))
    const engine = new SyncEngine(repo, { isOnline: () => true })
    engine.setAdapter(new GasAdapter({ url: 'u', secret: 's' }, async (body) => gas.call('handleRequest', JSON.parse(body))))
    engines.push(engine)
    return { repo, engine }
  }

  it('rebuilds the same data, keeps deletions, and re-syncs without duplicating anything', async () => {
    const a = await device()
    const p = await a.repo.put('Positions', { ticker: '042700', market: 'KR', direction: 'long', status: 'done' })
    await a.repo.put('Fills', { position_id: p.id, ts: '2026-10-07T01:00:00.000Z', side: 'buy', price: 98500, qty: 85 })
    const gone = await a.repo.put('Tags', { family: 'mistake', name: '지울 태그' })
    await a.repo.remove('Tags', gone.id)
    await a.engine.syncNow()
    const file = JSON.stringify(buildDump(await a.repo.exportAll(), new Date().toISOString()))

    const b = await device()
    await b.repo.put('Rules', { text: '복원 전에 있던 규칙' }) // dropped by the restore
    const dump = parseDump(file)
    const restored = await b.repo.importAll(dump.data)
    // 3 rows written above + the default Settings rows device A pulled from the server.
    expect(dump.counts.Settings).toBeGreaterThan(0)
    expect(restored).toBe(Object.values(dump.counts).reduce((s, c) => s + (c ?? 0), 0))
    expect(await b.repo.list('Rules', { includeDeleted: true })).toEqual([])
    expect(await b.repo.get('Positions', p.id)).toMatchObject({ ticker: '042700' })
    expect((await b.repo.get('Tags', gone.id))?.deleted).toBe(true)
    expect(await b.repo.pendingCount()).toBe(restored)

    await b.engine.resetCheckpoint()
    const report = await b.engine.syncNow()
    expect(report).toMatchObject({ conflicts: 0, rejected: 0 })
    const server = gas.call('handleRequest', { secret: 's', action: 'pullAll' }).data
    expect(server.Positions).toHaveLength(1)
    expect(server.Fills).toHaveLength(1)
    expect(server.Rules).toHaveLength(0)
  })
})
