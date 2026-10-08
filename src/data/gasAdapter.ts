import {
  BackendError,
  type BackendAdapter,
  type BackendErrorCode,
  type PullResult,
  type QuoteResult,
  type QuoteMarket,
  type UploadImageRequest,
  type UpsertOp,
  type UpsertResult,
} from './backend'
import type { BaseRow } from './types'

export interface GasConfig {
  /** Web app URL ending in /exec. */
  url: string
  secret: string
}

type Transport = (body: string) => Promise<unknown>

/** Default transport: POST as text/plain so the browser skips the CORS preflight. */
function fetchTransport(url: string, timeoutMs = 30000): Transport {
  return async (body) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        redirect: 'follow',
        signal: ctrl.signal,
      })
    } catch (err) {
      throw new BackendError('network', err instanceof Error ? err.message : String(err))
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      // An HTML page here usually means a wrong URL or a deployment without "anyone" access.
      throw new BackendError('bad_response', `서버 응답이 JSON이 아닙니다 (HTTP ${res.status}). 웹앱 URL과 배포 권한을 확인하세요.`)
    }
  }
}

const KNOWN_CODES: BackendErrorCode[] = [
  'bad_request',
  'unauthorized',
  'not_setup',
  'unknown_action',
  'unknown_entity',
  'too_many_rows',
  'busy',
  'quote_not_found',
  'quote_failed',
  'too_large',
  'internal',
]

export class GasAdapter implements BackendAdapter {
  private config: GasConfig
  private transport: Transport
  constructor(config: GasConfig, transport?: Transport) {
    this.config = config
    this.transport = transport ?? fetchTransport(config.url)
  }

  private async call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const raw = (await this.transport(JSON.stringify({ secret: this.config.secret, action, ...params }))) as {
      ok?: boolean
      error?: { code?: string; message?: string }
    }
    if (!raw || typeof raw !== 'object') throw new BackendError('bad_response', '빈 응답')
    if (raw.ok !== true) {
      const code = (KNOWN_CODES as string[]).includes(raw.error?.code ?? '') ? (raw.error!.code as BackendErrorCode) : 'internal'
      throw new BackendError(code, raw.error?.message ?? '알 수 없는 오류')
    }
    return raw as T
  }

  async ping() {
    const r = await this.call<{ serverTime: string; schemaVersion: number }>('ping')
    return { serverTime: r.serverTime, schemaVersion: r.schemaVersion }
  }

  async pullAll(since?: string | null): Promise<PullResult> {
    const r = await this.call<PullResult>('pullAll', since ? { since } : {})
    return { serverTime: r.serverTime, data: r.data }
  }

  async batch(ops: UpsertOp[]): Promise<UpsertResult[]> {
    if (!ops.length) return []
    const r = await this.call<{ results: UpsertResult[] }>('batch', { ops })
    return r.results
  }

  async getQuote(symbol: string, market: QuoteMarket): Promise<QuoteResult> {
    const r = await this.call<QuoteResult>('getQuote', { symbol, market })
    return { symbol: r.symbol, cacheSymbol: r.cacheSymbol, name: r.name, currency: r.currency, price: r.price, asOf: r.asOf, bars: r.bars }
  }

  async uploadImage(req: UploadImageRequest): Promise<BaseRow> {
    const r = await this.call<{ row: BaseRow }>('uploadImage', { ...req })
    return r.row
  }

  async getSettings() {
    const r = await this.call<{ settings: Record<string, unknown> }>('getSettings')
    return r.settings
  }
}
