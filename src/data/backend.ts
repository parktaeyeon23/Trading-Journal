import type { BaseRow, EntityName } from './types'

/** One field-level validation failure reported by the server. */
export interface RowError {
  field: string
  code: string
}

export interface UpsertResult {
  op: 'upsert'
  entity: EntityName
  inserted: number
  updated: number
  unchanged: number
  /** The server already had a newer version; `server` is that version. */
  conflicts: { id: string; server: BaseRow }[]
  /** Rows the server refused, with the index into the sent rows. */
  rejected: { index: number; id: string | null; errors: RowError[] }[]
}

export interface PullResult {
  serverTime: string
  data: Partial<Record<EntityName, BaseRow[]>>
}

export interface UpsertOp {
  op: 'upsert'
  entity: EntityName
  rows: BaseRow[]
}

export interface QuoteBar {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
}

export interface QuoteResult {
  /** Source symbol, e.g. 042700.KQ. */
  symbol: string
  /** MarketCache symbol, e.g. KR:042700. */
  cacheSymbol: string
  name: string | null
  currency: string | null
  price: number | null
  asOf: string | null
  /** Daily bars, oldest first (about 3 months). */
  bars: QuoteBar[]
}

export interface UploadImageRequest {
  id: string
  position_id: string
  slot: 'setup' | 'entry' | 'exit' | 'post' | 'free'
  sort: number | null
  mime: string
  /** base64 image data */
  data: string
  /** base64 thumbnail, optional */
  thumb: string | null
  created_at: string
  updated_at: string
}

/**
 * Everything the app needs from a backend. The app depends on this interface
 * only, so moving off Apps Script later means writing one new adapter.
 */
export interface BackendAdapter {
  ping(): Promise<{ serverTime: string; schemaVersion: number }>
  pullAll(since?: string | null): Promise<PullResult>
  /** Runs ops in order (parents first) and returns one result per op. */
  batch(ops: UpsertOp[]): Promise<UpsertResult[]>
  getSettings(): Promise<Record<string, unknown>>
  /** Live daily quote; also caches the bars server-side (they arrive in MarketCache by sync). */
  getQuote(symbol: string, market: 'KR' | 'US'): Promise<QuoteResult>
  /** Stores a chart image (idempotent by id) and returns the saved ChartImages row. */
  uploadImage(req: UploadImageRequest): Promise<BaseRow>
}

export type BackendErrorCode =
  | 'network'
  | 'bad_response'
  | 'bad_request'
  | 'unauthorized'
  | 'not_setup'
  | 'unknown_action'
  | 'unknown_entity'
  | 'too_many_rows'
  | 'busy'
  | 'quote_not_found'
  | 'quote_failed'
  | 'too_large'
  | 'internal'

export class BackendError extends Error {
  readonly code: BackendErrorCode
  constructor(code: BackendErrorCode, message: string) {
    super(message)
    this.name = 'BackendError'
    this.code = code
  }
  /** Worth retrying later without the user changing anything. */
  get retryable() {
    return this.code === 'network' || this.code === 'busy' || this.code === 'internal' || this.code === 'bad_response'
  }
}
