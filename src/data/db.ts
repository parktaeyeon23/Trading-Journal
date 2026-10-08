import { openDB, type IDBPDatabase } from 'idb'
import { ENTITY_ORDER, POSITION_CHILDREN } from './types'

export const DB_NAME = 'alpha-journal'
export const DB_VERSION = 1

/** Non-entity stores. */
export const OUTBOX = 'outbox'
export const CONFLICTS = 'conflicts'
export const META = 'meta'

export type AppDb = IDBPDatabase

/**
 * Opens (and on first run creates) the local database: one store per entity,
 * keyed by id, plus the outbox of unsent changes, a conflicts log and a meta
 * key-value store. Bump DB_VERSION and add a branch here for schema changes.
 */
export function openAppDb(name = DB_NAME): Promise<AppDb> {
  return openDB(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        for (const entity of ENTITY_ORDER) {
          const store = db.createObjectStore(entity, { keyPath: 'id' })
          if (POSITION_CHILDREN.includes(entity)) store.createIndex('position_id', 'position_id')
          if (entity === 'Positions') store.createIndex('status', 'status')
          if (entity === 'DailyNotes') store.createIndex('date', 'date')
          if (entity === 'MarketCache') store.createIndex('symbol_date', ['symbol', 'date'])
        }
        db.createObjectStore(OUTBOX, { keyPath: 'seq', autoIncrement: true }).createIndex('entity_id', ['entity', 'id'])
        db.createObjectStore(CONFLICTS, { keyPath: 'seq', autoIncrement: true })
        db.createObjectStore(META)
      }
    },
  })
}
