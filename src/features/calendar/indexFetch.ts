import { useSyncExternalStore } from 'react'
import { BackendError, type QuoteMarket, type QuoteResult } from '../../data/backend'

/**
 * Index/FX series the day detail asked the backend for this session, and how
 * that went — so a failure is shown with its reason instead of a silent "—",
 * and a missing day isn't refetched on every render.
 */
export type FetchState = { state: 'loading' } | { state: 'done' } | { state: 'failed'; message: string }

const states = new Map<string, FetchState>()
const listeners = new Set<() => void>()
let snapshot: ReadonlyMap<string, FetchState> = new Map()

function setState(key: string, s: FetchState) {
  states.set(key, s)
  snapshot = new Map(states)
  listeners.forEach((fn) => fn())
}

export function useIndexFetchStates(): ReadonlyMap<string, FetchState> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => snapshot,
  )
}

/** Plain-language reason for a failed index lookup, with what to do about it. */
export function explainQuoteError(err: unknown): string {
  if (!(err instanceof BackendError)) return '알 수 없는 오류로 지수를 불러오지 못했습니다.'
  switch (err.code) {
    case 'bad_request':
      return /KR or US/.test(err.message)
        ? 'GAS가 이전 버전이라 지수를 모릅니다. Apps Script에서 Quote.js를 저장소 최신본으로 바꾸고 "새 버전"으로 배포하세요.'
        : `요청이 거부됐습니다: ${err.message}`
    case 'unknown_action':
      return 'GAS가 이전 버전입니다. 저장소의 GAS 파일로 바꾸고 "새 버전"으로 배포하세요.'
    case 'quote_failed':
      return `시세 서버(Yahoo)에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요. (${err.message})`
    case 'quote_not_found':
      return '시세 서버에서 이 지수를 찾지 못했습니다.'
    case 'unauthorized':
      return '백엔드 secret이 맞지 않습니다. 설정에서 API_SECRET을 확인하세요.'
    case 'not_setup':
      return '설정에서 백엔드를 연결하면 지수를 불러옵니다.'
    case 'network':
      return '백엔드에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'
    default:
      return `지수를 불러오지 못했습니다: ${err.message}`
  }
}

/** Asks the backend for a series once per session (again after `retry`). */
export function requestSeries(key: string, getQuote: (s: string, m: QuoteMarket) => Promise<QuoteResult>) {
  // Already asked this session; a failure stays visible until the user retries.
  if (states.has(key)) return
  setState(key, { state: 'loading' })
  getQuote(key, 'IDX').then(
    () => setState(key, { state: 'done' }),
    (err) => setState(key, { state: 'failed', message: explainQuoteError(err) }),
  )
}

export function retrySeries(keys: string[], getQuote: (s: string, m: QuoteMarket) => Promise<QuoteResult>) {
  for (const k of keys) states.delete(k)
  for (const k of keys) requestSeries(k, getQuote)
}
