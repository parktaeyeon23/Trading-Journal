import { describe, expect, it } from 'vitest'
import { formatCompact, formatMoney, formatPct, formatPrice, formatR, formatSignedPct, formatUnit, parseAmount, pnlTone } from '../../src/core/format'

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

describe('parseAmount / formatPrice / formatPct', () => {
  it('parses typed numbers with separators and symbols', () => {
    expect(parseAmount('98,500')).toBe(98500)
    expect(parseAmount(' 72.40 ')).toBe(72.4)
    expect(parseAmount('₩30,000,000')).toBe(30_000_000)
    expect(parseAmount('$1,234.5')).toBe(1234.5)
    expect(parseAmount('.5')).toBe(0.5)
    expect(parseAmount('3.')).toBe(3)
  })
  it('rejects empty and non-numeric text', () => {
    expect(parseAmount('')).toBeNaN()
    expect(parseAmount('12a')).toBeNaN()
    expect(parseAmount('1.2.3')).toBeNaN()
  })
  it('formats prices per currency', () => {
    expect(formatPrice(94100.4, 'KRW')).toBe('94,100')
    expect(formatPrice(69.8, 'USD')).toBe('69.8')
    expect(formatPrice(69.123456, 'USD')).toBe('69.1235')
    expect(formatPrice(NaN, 'USD')).toBe('')
  })
  it('formats percents', () => {
    expect(formatPct(27.9771)).toBe('27.98%')
    expect(formatPct(4.4670, 1)).toBe('4.5%')
  })
})

describe('pnlTone', () => {
  it('maps sign to KR-convention tone', () => {
    expect(pnlTone(1)).toBe('profit')
    expect(pnlTone(-1)).toBe('loss')
    expect(pnlTone(0)).toBe('flat')
  })
})

describe('calendar formats', () => {
  it('shortens KRW to 만/억 and USD to K/M', () => {
    expect(formatCompact(523_000, 'KRW')).toBe('+52.3만')
    expect(formatCompact(-1_240_000, 'KRW')).toBe('−124만')
    expect(formatCompact(-124_000_000, 'KRW')).toBe('−1.24억')
    expect(formatCompact(9_800, 'KRW')).toBe('+₩9,800')
    expect(formatCompact(1_250, 'USD')).toBe('+$1.3K')
    expect(formatCompact(-2_500_000, 'USD')).toBe('−$2.5M')
    expect(formatCompact(-84.6, 'USD')).toBe('−$85')
    expect(formatCompact(0.2, 'USD')).toBe('$0')
    expect(formatCompact(1.26, 'R')).toBe('+1.3R')
    expect(formatCompact(-0.42, 'PCT')).toBe('−0.4%')
  })
  it('has a shorter form for phone-width cells', () => {
    expect(formatCompact(-185_000, 'KRW', true)).toBe('−19만')
    expect(formatCompact(4_183_000, 'KRW', true)).toBe('+418만')
    expect(formatCompact(-124_000_000, 'KRW', true)).toBe('−1.2억')
    expect(formatCompact(3_000, 'KRW', true)).toBe('+0.3만')
    expect(formatCompact(12_345, 'USD', true)).toBe('+$12K')
    expect(formatCompact(1_250, 'USD', true)).toBe('+$1.3K')
    expect(formatCompact(2_540_000, 'USD', true)).toBe('+$2.5M')
  })
  it('prints full values with signs', () => {
    expect(formatUnit(1.256, 'R')).toBe('+1.26R')
    expect(formatUnit(-0.4, 'PCT')).toBe('−0.40%')
    expect(formatUnit(0, 'PCT')).toBe('0.00%')
    expect(formatUnit(1500, 'KRW')).toBe('+₩1,500')
    expect(formatSignedPct(2.5, 1)).toBe('+2.5%')
  })
})
