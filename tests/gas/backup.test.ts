import { beforeEach, describe, expect, it } from 'vitest'
import { loadGas, type FakeGas } from './fakeGas'

const DAY = 24 * 3600 * 1000
let gas: FakeGas

beforeEach(() => {
  gas = loadGas()
  gas.call('setupSheets')
})

describe('selectBackupsToTrash', () => {
  const now = Date.parse('2026-10-08T03:00:00+09:00')
  const kst = (s: string) => Date.parse(s + 'T03:00:00+09:00')
  const pick = (files: { id: string; created: number }[]) => gas.call<string[]>('selectBackupsToTrash', files, now, 30).sort()

  it('keeps everything from the last 30 days', () => {
    const files = Array.from({ length: 30 }, (_, i) => ({ id: 'd' + i, created: now - i * DAY }))
    expect(pick(files)).toEqual([])
  })

  it('keeps only the last copy of each older month', () => {
    const files = [
      { id: 'aug-01', created: kst('2026-08-01') },
      { id: 'aug-15', created: kst('2026-08-15') },
      { id: 'aug-31', created: kst('2026-08-31') },
      { id: 'sep-01', created: kst('2026-09-01') },
      { id: 'sep-07', created: kst('2026-09-07') },
      { id: 'sep-20', created: kst('2026-09-20') }, // inside 30 days
      { id: 'sep-30', created: kst('2026-09-30') }, // inside 30 days, last of September
    ]
    expect(pick(files)).toEqual(['aug-01', 'aug-15', 'sep-01', 'sep-07'])
  })

  it('uses the Korean calendar for month boundaries', () => {
    // 2026-07-31 23:30 KST is 14:30 UTC on the 31st; 2026-08-01 00:30 KST is still July 31 in UTC.
    const files = [
      { id: 'jul-end', created: Date.parse('2026-07-31T23:30:00+09:00') },
      { id: 'aug-start', created: Date.parse('2026-08-01T00:30:00+09:00') },
      { id: 'aug-later', created: Date.parse('2026-08-20T00:30:00+09:00') },
    ]
    expect(pick(files)).toEqual(['aug-start'])
  })
})

describe('backupDaily and the trigger', () => {
  it('copies the database and trashes copies past the keep window', () => {
    // Two copies in the same month, both well over 30 days old (KST noon on the 5th and 10th).
    const old = new Date(Date.now() - 100 * DAY)
    const ym = new Date(old.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7)
    gas.setNow(new Date(`${ym}-05T12:00:00+09:00`))
    gas.call('backupSpreadsheet')
    gas.setNow(new Date(`${ym}-10T12:00:00+09:00`))
    gas.call('backupSpreadsheet')
    gas.setNow(new Date())
    const trashed = gas.call<number>('backupDaily')

    expect(trashed).toBe(1)
    const live = gas.files.filter((f) => !f.trashed)
    expect(live.map((f) => f.created.toISOString())).toEqual([new Date(`${ym}-10T12:00:00+09:00`).toISOString(), expect.any(String)])
    expect(live.at(-1)!.name.startsWith('ALPHA JOURNAL DB backup ')).toBe(true)
  })

  it('installs exactly one daily trigger even when run twice', () => {
    gas.call('installBackupTrigger')
    gas.call('installBackupTrigger')
    expect(gas.triggers).toEqual([{ handler: 'backupDaily', hour: 3 }])
  })
})
