import { beforeEach, describe, expect, it } from 'vitest'
import { loadGas, type FakeGas } from './fakeGas'

const S = 's'
let gas: FakeGas
const api = (req: Record<string, unknown>) => gas.call('handleRequest', { secret: S, ...req })
const T = '2026-10-08T08:00:00.000Z'
const b64 = (n: number) => Buffer.alloc(n, 7).toString('base64')

function upload(extra: Record<string, unknown> = {}) {
  return api({ action: 'uploadImage', id: 'img-1', position_id: 'p1', slot: 'exit', mime: 'image/webp', data: b64(2000), thumb: b64(200), created_at: T, updated_at: T, ...extra })
}

beforeEach(() => {
  gas = loadGas()
  gas.call('setupSheets')
  gas.props.set('API_SECRET', S)
  api({ action: 'upsert', entity: 'Positions', rows: [{ id: 'p1', created_at: T, updated_at: T, ticker: 'CRDO', market: 'US', direction: 'long', status: 'done' }] })
})

describe('uploadImage', () => {
  it('stores image and thumbnail in a dated folder, shared view-only, and writes the row', () => {
    const r = upload()
    expect(r.ok).toBe(true)
    const [img, thumb] = gas.files
    expect(img).toMatchObject({ mime: 'image/webp', size: 2000, sharing: 'ANYONE_WITH_LINK:VIEW' })
    expect(thumb).toMatchObject({ size: 200, sharing: 'ANYONE_WITH_LINK:VIEW' })
    expect(img.path).toMatch(/^ALPHA JOURNAL\/charts\/\d{4}\/\d{2}$/)
    expect(img.name).toMatch(/^p1_exit_img-1\.webp$/)
    expect(r.row).toMatchObject({ id: 'img-1', position_id: 'p1', slot: 'exit', file_id: img.id, thumb_file_id: thumb.id, deleted: false })
    expect(r.row.synced_at).toBeTruthy()
    expect(api({ action: 'pullAll' }).data.ChartImages).toHaveLength(1)
  })

  it('is idempotent: a retry with the same id returns the stored row without new files', () => {
    upload()
    const again = upload()
    expect(again).toMatchObject({ ok: true, duplicate: true })
    expect(gas.files).toHaveLength(2)
    expect(api({ action: 'pullAll' }).data.ChartImages).toHaveLength(1)
  })

  it('rejects unknown positions, bad slots, bad mime types and missing data', () => {
    expect(upload({ position_id: 'ghost' }).error.code).toBe('bad_request')
    expect(upload({ slot: 'banner' }).error.code).toBe('bad_request')
    expect(upload({ mime: 'image/gif' }).error.code).toBe('bad_request')
    expect(upload({ data: '' }).error.code).toBe('bad_request')
    expect(upload({ id: '' }).error.code).toBe('bad_request')
    expect(gas.files).toHaveLength(0)
  })

  it('works without a thumbnail', () => {
    const r = upload({ thumb: null })
    expect(r.row.thumb_file_id).toBeNull()
    expect(gas.files).toHaveLength(1)
  })
})

describe('deleting a chart', () => {
  it('moves both Drive files to the trash when the app syncs deleted=true', () => {
    const { row } = upload()
    api({ action: 'upsert', entity: 'ChartImages', rows: [{ ...row, synced_at: undefined, deleted: true, updated_at: '2026-10-08T09:00:00.000Z' }] })
    expect(gas.files.map((f) => f.trashed)).toEqual([true, true])
    // A second sync of the same deletion does nothing more.
    api({ action: 'upsert', entity: 'ChartImages', rows: [{ ...row, synced_at: undefined, deleted: true, updated_at: '2026-10-08T09:00:01.000Z' }] })
    expect(gas.files.filter((f) => f.trashed)).toHaveLength(2)
  })

  it('also trashes on softDelete', () => {
    upload()
    api({ action: 'softDelete', entity: 'ChartImages', ids: ['img-1'] })
    expect(gas.files.every((f) => f.trashed)).toBe(true)
  })

  it('leaves files alone for ordinary edits', () => {
    const { row } = upload()
    api({ action: 'upsert', entity: 'ChartImages', rows: [{ ...row, synced_at: undefined, sort: 3, updated_at: '2026-10-08T09:00:00.000Z' }] })
    expect(gas.files.some((f) => f.trashed)).toBe(false)
  })
})
