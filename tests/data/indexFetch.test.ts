import { describe, expect, it } from 'vitest'
import { BackendError } from '../../src/data/backend'
import { explainQuoteError } from '../../src/features/calendar/indexFetch'

describe('explainQuoteError', () => {
  it('points an old GAS deployment at the redeploy', () => {
    expect(explainQuoteError(new BackendError('bad_request', 'market must be KR or US.'))).toMatch(/Quote\.js.*새 버전/)
    expect(explainQuoteError(new BackendError('unknown_action', 'x'))).toMatch(/새 버전/)
  })
  it('names the other failures plainly', () => {
    expect(explainQuoteError(new BackendError('quote_failed', 'HTTP 429'))).toMatch(/Yahoo.*HTTP 429/)
    expect(explainQuoteError(new BackendError('unauthorized', 'x'))).toMatch(/API_SECRET/)
    expect(explainQuoteError(new BackendError('network', 'x'))).toMatch(/인터넷/)
    expect(explainQuoteError(new Error('boom'))).toMatch(/알 수 없는/)
  })
})
