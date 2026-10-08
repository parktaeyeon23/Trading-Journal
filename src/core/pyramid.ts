/**
 * Pyramiding: one planned position split into staged entries (e.g. 50/30/20).
 */

export interface PyramidStage {
  stage: number
  /** Percent of the planned total. */
  weight: number
  targetQty: number
  filledQty: number
}

export interface PyramidState {
  stages: PyramidStage[]
  /** Highest stage with any fill, 0 before the first entry. */
  currentStage: number
  /** Next stage to buy, or null when every stage is filled. */
  nextStage: number | null
  /** Shares still to buy to complete the next stage. */
  nextQty: number
  filledTotal: number
}

export interface EntryFill {
  qty: number
  /** Stage the fill was booked to; missing → the earliest unfilled stage. */
  pyramid_stage?: number | null
}

export const PYRAMID_PRESETS: Record<string, number[]> = {
  '100': [100],
  '50/50': [50, 50],
  '50/30/20': [50, 30, 20],
  '33/33/34': [33, 33, 34],
}

/**
 * Splits totalQty by weights. Rounding happens on the running total, so the
 * stages always add up to exactly totalQty and no stage is short by more than one share.
 */
export function splitStages(totalQty: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!(totalQty > 0) || !(sum > 0)) return weights.map(() => 0)
  let cumW = 0
  let prev = 0
  return weights.map((w, i) => {
    cumW += w
    const cum = i === weights.length - 1 ? totalQty : Math.floor((totalQty * cumW) / sum + 1e-9)
    const q = cum - prev
    prev = cum
    return q
  })
}

export function pyramidState(totalQty: number, weights: number[], entries: EntryFill[]): PyramidState {
  const targets = splitStages(totalQty, weights)
  const filled = weights.map(() => 0)
  for (const f of entries) {
    let idx = f.pyramid_stage ? f.pyramid_stage - 1 : filled.findIndex((q, i) => q < targets[i])
    if (idx < 0) idx = weights.length - 1
    idx = Math.min(Math.max(idx, 0), weights.length - 1)
    filled[idx] += f.qty
  }
  const stages = weights.map((w, i) => ({ stage: i + 1, weight: w, targetQty: targets[i], filledQty: filled[i] }))
  const currentStage = stages.reduce((m, s) => (s.filledQty > 0 ? s.stage : m), 0)
  const next = stages.find((s) => s.filledQty < s.targetQty)
  return {
    stages,
    currentStage,
    nextStage: next ? next.stage : null,
    nextQty: next ? next.targetQty - next.filledQty : 0,
    filledTotal: filled.reduce((a, b) => a + b, 0),
  }
}
