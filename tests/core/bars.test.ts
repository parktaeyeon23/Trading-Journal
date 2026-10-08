import { describe, expect, it } from 'vitest'
import { covered, windowsToFetch } from '../../src/core/bars'

describe('covered', () => {
  it('needs a bar near each end, allowing for holidays', () => {
    expect(covered({ from: '2026-09-02', to: '2026-09-10' }, ['2026-09-04', '2026-09-08'])).toBe(true)
    expect(covered({ from: '2026-09-02', to: '2026-09-10' }, ['2026-09-04'])).toBe(false)
    expect(covered({ from: '2026-09-02', to: '2026-09-10' }, ['2026-09-07', '2026-09-08'])).toBe(false)
    expect(covered({ from: '2026-09-02', to: '2026-09-02' }, ['2026-09-02'])).toBe(true)
  })
})

describe('windowsToFetch', () => {
  it('merges a symbol’s uncovered trades and skips covered ones', () => {
    const have = new Map([['US:CRDO', ['2026-03-02', '2026-03-10']]])
    const w = windowsToFetch(
      [
        { cacheSymbol: 'US:CRDO', from: '2026-03-02', to: '2026-03-10' }, // covered
        { cacheSymbol: 'US:CRDO', from: '2026-05-04', to: '2026-05-12' },
        { cacheSymbol: 'US:CRDO', from: '2026-04-01', to: '2026-04-20' },
        { cacheSymbol: 'KR:042700', from: '2026-01-05', to: '2026-01-09' },
        { cacheSymbol: 'KR:042700', from: '2026-01-09', to: '2026-01-05' }, // bad window ignored
      ],
      have,
    )
    expect(w).toEqual([
      { cacheSymbol: 'KR:042700', from: '2026-01-05', to: '2026-01-09' },
      { cacheSymbol: 'US:CRDO', from: '2026-04-01', to: '2026-05-12' },
    ])
  })
  it('splits windows longer than one request allows', () => {
    const w = windowsToFetch(
      [
        { cacheSymbol: 'US:A', from: '2023-01-02', to: '2023-01-10' },
        { cacheSymbol: 'US:A', from: '2023-06-01', to: '2023-06-10' },
        { cacheSymbol: 'US:A', from: '2025-06-01', to: '2025-06-10' },
      ],
      new Map(),
    )
    expect(w).toEqual([
      { cacheSymbol: 'US:A', from: '2023-01-02', to: '2023-06-10' },
      { cacheSymbol: 'US:A', from: '2025-06-01', to: '2025-06-10' },
    ])
  })
})
