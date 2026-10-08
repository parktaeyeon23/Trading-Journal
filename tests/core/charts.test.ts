import { describe, expect, it } from 'vitest'
import { fitWithin, postChartDue, tradingDaysBetween, tradingViewSnapshotImage } from '../../src/core/charts'

describe('fitWithin', () => {
  it('scales the long side down to the max and keeps the aspect ratio', () => {
    expect(fitWithin(4800, 2700, 2400)).toEqual({ w: 2400, h: 1350 })
    expect(fitWithin(1170, 2532, 400)).toEqual({ w: 185, h: 400 })
  })
  it('never scales up and handles bad input', () => {
    expect(fitWithin(800, 600, 2400)).toEqual({ w: 800, h: 600 })
    expect(fitWithin(0, 600, 400)).toEqual({ w: 0, h: 0 })
    expect(fitWithin(10000, 1, 400)).toEqual({ w: 400, h: 1 })
  })
})

describe('tradingViewSnapshotImage', () => {
  it('maps snapshot links to the PNG', () => {
    expect(tradingViewSnapshotImage('https://www.tradingview.com/x/AbCd1234/')).toBe('https://s3.tradingview.com/snapshots/a/AbCd1234.png')
    expect(tradingViewSnapshotImage(' https://kr.tradingview.com/x/Zq9/?t=1 ')).toBe('https://s3.tradingview.com/snapshots/z/Zq9.png')
  })
  it('rejects other links', () => {
    expect(tradingViewSnapshotImage('https://www.tradingview.com/chart/abc/')).toBeNull()
    expect(tradingViewSnapshotImage('https://evil.com/x/abc/')).toBeNull()
    expect(tradingViewSnapshotImage('https://tradingview.com.evil.com/x/abc/')).toBeNull()
  })
})

describe('tradingDaysBetween', () => {
  it('counts weekdays after the start date', () => {
    expect(tradingDaysBetween('2026-10-07', '2026-10-08')).toBe(1) // Wed → Thu
    expect(tradingDaysBetween('2026-10-09', '2026-10-12')).toBe(1) // Fri → Mon
    expect(tradingDaysBetween('2026-10-07', '2026-10-21')).toBe(10)
    expect(tradingDaysBetween('2026-10-08', '2026-10-08')).toBe(0)
    expect(tradingDaysBetween('2026-10-09', '2026-10-01')).toBe(0)
  })
})

describe('postChartDue', () => {
  it('is due from 10 trading days after the exit until a post chart exists', () => {
    // Fri 2026-10-02 exit → Fri 2026-10-16 is the 10th weekday after.
    expect(postChartDue('2026-10-02', '2026-10-15', false)).toBeNull()
    expect(postChartDue('2026-10-02', '2026-10-16', false)).toBe(10)
    expect(postChartDue('2026-10-02', '2026-10-20', false)).toBe(12)
    expect(postChartDue('2026-10-02', '2026-10-20', true)).toBeNull()
    expect(postChartDue(null, '2026-10-20', false)).toBeNull()
  })
})
