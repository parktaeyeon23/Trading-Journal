import { describe, expect, it } from 'vitest'
import { formatMoney, formatR, pnlTone } from '../../src/core/format'

describe('formatR', () => {
  it('signs positive and negative values', () => {
    expect(formatR(1.9)).toBe('+1.9R')
    expect(formatR(-0.6)).toBe('−0.6R')
  })
  it('shows zero (and values that round to zero) without a sign', () => {
    expect(formatR(0)).toBe('0.0R')
    expect(formatR(-0.04)).toBe('0.0R')
  })
  it('respects digits', () => {
    expect(formatR(0.314, 2)).toBe('+0.31R')
  })
})

describe('formatMoney', () => {
  it('formats KRW without decimals', () => {
    expect(formatMoney(1011000, 'KRW')).toBe('+₩1,011,000')
    expect(formatMoney(-310000, 'KRW')).toBe('−₩310,000')
  })
  it('formats USD with two decimals', () => {
    expect(formatMoney(-84.6, 'USD')).toBe('−$84.60')
  })
  it('can drop the plus sign but keeps the minus', () => {
    expect(formatMoney(8372500, 'KRW', false)).toBe('₩8,372,500')
    expect(formatMoney(-5, 'USD', false)).toBe('−$5.00')
  })
})

describe('pnlTone', () => {
  it('maps sign to KR-convention tone', () => {
    expect(pnlTone(1)).toBe('profit')
    expect(pnlTone(-1)).toBe('loss')
    expect(pnlTone(0)).toBe('flat')
  })
})
