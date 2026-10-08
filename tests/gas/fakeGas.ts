/**
 * Minimal in-memory stand-ins for the Apps Script services the /gas code uses,
 * plus a loader that runs the real /gas/*.js files in a vm context.
 * Cells keep whatever JS value was written (like a column formatted as plain text).
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

type Cell = unknown

class FakeRange {
  constructor(
    private sheet: FakeSheet,
    private row: number,
    private col: number,
    private numRows: number,
    private numCols: number,
  ) {}
  getValues(): Cell[][] {
    const out: Cell[][] = []
    for (let r = 0; r < this.numRows; r++) {
      const line: Cell[] = []
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.cell(this.row + r, this.col + c))
      out.push(line)
    }
    return out
  }
  setValues(values: Cell[][]) {
    if (values.length !== this.numRows || values.some((l) => l.length !== this.numCols)) {
      throw new Error(`setValues size mismatch: range ${this.numRows}x${this.numCols}`)
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)))
    return this
  }
  setNumberFormat() {
    return this
  }
}

export class FakeSheet {
  /** 1-based rows/cols in the API; stored 0-based. */
  data: Cell[][] = []
  writes = 0
  constructor(private name: string) {}
  getName() {
    return this.name
  }
  cell(r: number, c: number): Cell {
    const v = this.data[r - 1]?.[c - 1]
    return v === undefined || v === null ? '' : v
  }
  set(r: number, c: number, v: Cell) {
    while (this.data.length < r) this.data.push([])
    const line = this.data[r - 1]
    while (line.length < c) line.push('')
    line[c - 1] = v
    this.writes++
  }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if (this.data[r - 1].some((v) => v !== '' && v !== null)) return r
    return 0
  }
  getLastColumn() {
    return this.data.reduce((m, l) => {
      let last = 0
      l.forEach((v, i) => {
        if (v !== '' && v !== null) last = i + 1
      })
      return Math.max(m, last)
    }, 0)
  }
  getMaxRows() {
    return 1000
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols)
  }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1))
  }
  setFrozenRows() {
    return this
  }
}

class FakeSpreadsheet {
  sheets: FakeSheet[] = [new FakeSheet('Sheet1')]
  constructor(private id: string) {}
  getId() {
    return this.id
  }
  getSheetByName(name: string) {
    return this.sheets.find((s) => s.getName() === name) ?? null
  }
  insertSheet(name: string) {
    const s = new FakeSheet(name)
    this.sheets.push(s)
    return s
  }
  getSheets() {
    return [...this.sheets]
  }
  deleteSheet(sheet: FakeSheet) {
    this.sheets = this.sheets.filter((s) => s !== sheet)
  }
}

export interface FakeFile {
  id: string
  name: string
  created: Date
  trashed: boolean
}

export interface FakeGas {
  context: vm.Context
  spreadsheets: Map<string, FakeSpreadsheet>
  props: Map<string, string>
  /** Files copied by makeCopy, newest last. */
  files: FakeFile[]
  triggers: { handler: string; hour: number }[]
  /** Overrides "now" for files created by makeCopy. */
  setNow(d: Date): void
  /** Calls a global function defined by the /gas files. */
  call<T = any>(fn: string, ...args: unknown[]): T
}

const GAS_FILES = ['Config.js', 'Validate.js', 'Merge.js', 'Sheets.js', 'Api.js', 'Setup.js', 'Backup.js', 'Tests.js']

export function loadGas(): FakeGas {
  const spreadsheets = new Map<string, FakeSpreadsheet>()
  const props = new Map<string, string>()
  const files: FakeFile[] = []
  const triggers: { handler: string; hour: number }[] = []
  let now = () => new Date()
  const asDriveFile = (f: FakeFile) => ({
    getId: () => f.id,
    getName: () => f.name,
    getDateCreated: () => f.created,
    setTrashed: (v: boolean) => {
      f.trashed = v
    },
  })
  const folder = () => {
    const children = new Map<string, unknown>()
    const own: FakeFile[] = []
    const f: any = {
      own,
      getFoldersByName: (name: string) => {
        const hit = children.get(name)
        return { hasNext: () => !!hit, next: () => hit }
      },
      createFolder: (name: string) => {
        const c = folder()
        children.set(name, c)
        return c
      },
      getFiles: () => {
        const list = own.filter((x) => !x.trashed)
        let i = 0
        return { hasNext: () => i < list.length, next: () => asDriveFile(list[i++]) }
      },
    }
    return f
  }
  const root = folder()

  const services = {
    SpreadsheetApp: {
      create: () => {
        const ss = new FakeSpreadsheet(randomUUID())
        spreadsheets.set(ss.getId(), ss)
        return ss
      },
      openById: (id: string) => {
        const ss = spreadsheets.get(id)
        if (!ss) throw new Error('No spreadsheet ' + id)
        return ss
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => props.set(k, v),
        deleteProperty: (k: string) => props.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s: string) => ({ content: s, setMimeType() { return this } }),
    },
    Utilities: {
      getUuid: () => randomUUID(),
      formatDate: (d: Date) => d.toISOString(),
    },
    DriveApp: {
      getRootFolder: () => root,
      getFileById: (_id: string) => ({
        moveTo: () => {},
        setTrashed: () => {},
        makeCopy: (name: string, into: any) => {
          const file: FakeFile = { id: randomUUID(), name, created: now(), trashed: false }
          files.push(file)
          into?.own?.push(file)
          return asDriveFile(file)
        },
      }),
    },
    ScriptApp: {
      getProjectTriggers: () =>
        triggers.map((t) => ({ getHandlerFunction: () => t.handler, _t: t })),
      deleteTrigger: (t: any) => {
        triggers.splice(triggers.indexOf(t._t), 1)
      },
      newTrigger: (handler: string) => {
        let hour = -1
        const b: any = {
          timeBased: () => b,
          everyDays: () => b,
          atHour: (h: number) => {
            hour = h
            return b
          },
          create: () => triggers.push({ handler, hour }),
        }
        return b
      },
    },
    Logger: { log: () => {} },
  }

  const context = vm.createContext({ ...services })
  for (const f of GAS_FILES) {
    const src = readFileSync(resolve(__dirname, '../../gas', f), 'utf8')
    vm.runInContext(src, context, { filename: f })
  }
  return {
    context,
    spreadsheets,
    props,
    files,
    triggers,
    setNow: (d) => {
      now = () => d
    },
    call: (fn, ...args) => {
      const target = (context as any)[fn]
      if (typeof target !== 'function') throw new Error('No gas function ' + fn)
      // Round-trip through JSON so results are plain objects from this realm.
      return JSON.parse(JSON.stringify(target(...args) ?? null))
    },
  }
}
