import { describe, expect, it } from 'vitest'
import { pyramidState, splitStages } from '../../src/core/pyramid'

describe('splitStages', () => {
  it('splits by weights and always sums to the total', () => {
    expect(splitStages(85, [50, 30, 20])).toEqual([42, 26, 17])
    expect(splitStages(100, [33, 33, 34])).toEqual([33, 33, 34])
    expect(splitStages(7, [50, 50])).toEqual([3, 4])
    for (const total of [1, 2, 3, 17, 99, 1001]) {
      expect(splitStages(total, [50, 30, 20]).reduce((a, b) => a + b, 0)).toBe(total)
    }
  })
  it('handles empty input', () => {
    expect(splitStages(0, [50, 50])).toEqual([0, 0])
    expect(splitStages(10, [0, 0])).toEqual([0, 0])
  })
})

describe('pyramidState', () => {
  it('starts at stage 0 with the first stage next', () => {
    expect(pyramidState(85, [50, 30, 20], [])).toMatchObject({ currentStage: 0, nextStage: 1, nextQty: 42, filledTotal: 0 })
  })
  it('tracks stages by the booked stage number', () => {
    const s = pyramidState(85, [50, 30, 20], [
      { qty: 42, pyramid_stage: 1 },
      { qty: 10, pyramid_stage: 2 },
    ])
    expect(s).toMatchObject({ currentStage: 2, nextStage: 2, nextQty: 16, filledTotal: 52 })
  })
  it('books unstaged fills to the earliest unfilled stage', () => {
    const s = pyramidState(100, [50, 50], [{ qty: 50 }, { qty: 20 }])
    expect(s.stages.map((x) => x.filledQty)).toEqual([50, 20])
    expect(s.nextQty).toBe(30)
  })
  it('reports done when every stage is filled, and folds overflow into the last stage', () => {
    const s = pyramidState(10, [50, 50], [{ qty: 5 }, { qty: 5 }, { qty: 3 }])
    expect(s).toMatchObject({ nextStage: null, nextQty: 0, filledTotal: 13 })
    expect(s.stages[1].filledQty).toBe(8)
  })
  it('clamps out-of-range stage numbers', () => {
    const s = pyramidState(10, [50, 50], [{ qty: 1, pyramid_stage: 9 }])
    expect(s.stages[1].filledQty).toBe(1)
  })
})
