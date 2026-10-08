/**
 * Export / restore format. Pure functions — the repo does the IndexedDB part.
 *
 * A dump is one JSON file holding every row of every entity (deleted rows too,
 * so a restore keeps deletions). It is the "take my data and leave" format:
 * readable, versioned, and enough to rebuild the app's data anywhere.
 */
import { ENTITY_ORDER, type BaseRow, type EntityName } from './types'

export const DUMP_FORMAT = 'alpha-journal-dump'
export const DUMP_VERSION = 1

export interface Dump {
  format: typeof DUMP_FORMAT
  version: number
  exportedAt: string
  counts: Partial<Record<EntityName, number>>
  data: Partial<Record<EntityName, BaseRow[]>>
}

export function buildDump(data: Partial<Record<EntityName, BaseRow[]>>, exportedAt: string): Dump {
  const out: Partial<Record<EntityName, BaseRow[]>> = {}
  const counts: Partial<Record<EntityName, number>> = {}
  for (const e of ENTITY_ORDER) {
    const rows = data[e] ?? []
    out[e] = rows
    counts[e] = rows.length
  }
  return { format: DUMP_FORMAT, version: DUMP_VERSION, exportedAt, counts, data: out }
}

export class DumpError extends Error {}

/** Parses and checks a dump file. Throws DumpError with a message fit for the user. */
export function parseDump(text: string): Dump {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new DumpError('JSON 파일이 아닙니다.')
  }
  const d = raw as Partial<Dump>
  if (!d || d.format !== DUMP_FORMAT) throw new DumpError('ALPHA JOURNAL 내보내기 파일이 아닙니다.')
  if (typeof d.version !== 'number' || d.version > DUMP_VERSION) {
    throw new DumpError(`이 앱보다 새 버전(v${d.version})에서 만든 파일입니다. 앱을 업데이트한 뒤 복원하세요.`)
  }
  if (!d.data || typeof d.data !== 'object') throw new DumpError('데이터가 비어 있습니다.')
  for (const [entity, rows] of Object.entries(d.data)) {
    if (!(ENTITY_ORDER as string[]).includes(entity)) throw new DumpError(`알 수 없는 항목: ${entity}`)
    if (!Array.isArray(rows)) throw new DumpError(`${entity} 형식이 잘못됐습니다.`)
    for (const r of rows as BaseRow[]) {
      if (!r || typeof r.id !== 'string' || typeof r.updated_at !== 'string' || typeof r.created_at !== 'string') {
        throw new DumpError(`${entity}에 id나 시각이 없는 행이 있습니다.`)
      }
    }
  }
  return d as Dump
}

/** RFC 4180 CSV. Objects/arrays become JSON text; null/undefined become empty cells. */
export function toCsv(rows: object[], columns: string[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => cell((r as Record<string, unknown>)[c])).join(','))]
  // BOM so Excel opens Korean text correctly.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** alpha-journal-20261008-1652.json in the viewer's local time. */
export function dumpFileName(d: Date, ext = 'json'): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `alpha-journal-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`
}

export const POSITION_CSV_COLUMNS = ['id', 'created_at', 'updated_at', 'deleted', 'market', 'ticker', 'ticker_name', 'direction', 'setup', 'status', 'original_stop', 'regime', 'no_plan']
export const FILL_CSV_COLUMNS = ['id', 'position_id', 'ts', 'side', 'price', 'qty', 'fee', 'tax', 'pyramid_stage', 'memo', 'deleted']
