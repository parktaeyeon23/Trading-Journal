import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackendError } from '../../src/data/backend'
import { openAppDb } from '../../src/data/db'
import { GasAdapter } from '../../src/data/gasAdapter'
import { LocalRepo } from '../../src/data/repo'
import { arrayBufferToBase64, UploadQueue } from '../../src/data/uploads'
import { loadGas, type FakeGas } from '../gas/fakeGas'

let gas: FakeGas
let repo: LocalRepo
let queue: UploadQueue
let online = true
let n = 0
let failNext: BackendError | null = null

const bytes = (len: number, v = 7) => new Uint8Array(len).fill(v).buffer

beforeEach(async () => {
  gas = loadGas()
  gas.call('setupSheets')
  gas.props.set('API_SECRET', 's')
  repo = new LocalRepo(await openAppDb(`uploads-${++n}`))
  const adapter = new GasAdapter({ url: 'u', secret: 's' }, async (body) => {
    if (failNext) {
      const e = failNext
      failNext = null
      throw e
    }
    return gas.call('handleRequest', JSON.parse(body))
  })
  online = true
  queue = new UploadQueue(repo, () => adapter, () => online)
  // The position must exist on the server for the upload to be accepted.
  const p = await repo.put('Positions', { id: 'p1', ticker: 'CRDO', market: 'US', direction: 'long', status: 'done' })
  gas.call('handleRequest', { secret: 's', action: 'upsert', entity: 'Positions', rows: [p] })
})
afterEach(() => queue.stop())

describe('arrayBufferToBase64', () => {
  it('matches Node for small and multi-chunk buffers', () => {
    for (const len of [0, 3, 0x8000 + 5, 200_000]) {
      const b = new Uint8Array(len).map((_, i) => i % 251).buffer
      expect(arrayBufferToBase64(b)).toBe(Buffer.from(b).toString('base64'))
    }
  })
})

describe('UploadQueue', () => {
  it('uploads, stores the server row locally, and empties the queue', async () => {
    await queue.add({ id: 'img1', position_id: 'p1', slot: 'exit', sort: null, mime: 'image/webp', data: bytes(500), thumb: bytes(50) })
    await queue.run()
    expect(await queue.list()).toEqual([])
    const row = await repo.get('ChartImages', 'img1')
    expect(row).toMatchObject({ slot: 'exit', position_id: 'p1' })
    expect(row!.file_id).toBe(gas.files[0].id)
    expect(gas.files.map((f) => f.size)).toEqual([500, 50])
  })

  it('keeps images while offline and sends them in order when back', async () => {
    online = false
    await queue.add({ id: 'a', position_id: 'p1', slot: 'setup', sort: null, mime: 'image/webp', data: bytes(10), thumb: null })
    await queue.add({ id: 'b', position_id: 'p1', slot: 'entry', sort: null, mime: 'image/webp', data: bytes(20), thumb: null })
    await queue.run()
    expect((await queue.list()).map((x) => x.id)).toEqual(['a', 'b'])
    online = true
    await queue.run()
    expect(await queue.list()).toEqual([])
    expect(gas.files.map((f) => f.size)).toEqual([10, 20])
  })

  it('stops and keeps the item on a network error (retry later)', async () => {
    failNext = new BackendError('network', 'offline')
    await queue.add({ id: 'x', position_id: 'p1', slot: 'exit', sort: null, mime: 'image/webp', data: bytes(10), thumb: null })
    await queue.run()
    expect((await queue.list())[0]).toMatchObject({ id: 'x', state: 'waiting' })
    await queue.run()
    expect(await queue.list()).toEqual([])
  })

  it('marks a refused image as failed, moves on, and can retry it', async () => {
    await queue.add({ id: 'bad', position_id: 'ghost', slot: 'exit', sort: null, mime: 'image/webp', data: bytes(10), thumb: null })
    await queue.add({ id: 'good', position_id: 'p1', slot: 'exit', sort: null, mime: 'image/webp', data: bytes(10), thumb: null })
    await queue.run()
    const left = await queue.list()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ id: 'bad', state: 'failed' })
    expect(left[0].error).toMatch(/position_id/)
    expect(await repo.get('ChartImages', 'good')).toBeTruthy()
    await queue.remove('bad')
    expect(await queue.list()).toEqual([])
  })

  it('does nothing without a backend', async () => {
    const q = new UploadQueue(repo, () => null, () => true)
    await q.add({ id: 'z', position_id: 'p1', slot: 'exit', sort: null, mime: 'image/webp', data: bytes(1), thumb: null })
    await q.run()
    expect(await q.list(  'p1')).toHaveLength(1)
  })
})
