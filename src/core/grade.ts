/**
 * Execution grade from the review checklist — independent of P&L.
 * 100% → A, ≥ 80% → B, ≥ 60% → C, else D. A no-plan entry is capped at C.
 */

export type Grade = 'A' | 'B' | 'C' | 'D'

export interface GradeBands {
  A: number
  B: number
  C: number
}

export const DEFAULT_GRADE_BANDS: GradeBands = { A: 1, B: 0.8, C: 0.6 }

export interface GradeResult {
  grade: Grade | null
  /** Share of rules followed, 0–1. null with an empty checklist. */
  ratio: number | null
  passed: number
  total: number
  /** The no-plan cap lowered the grade. */
  capped: boolean
}

export function gradeExecution(checklist: Record<string, boolean> | boolean[], noPlan: boolean, bands: GradeBands = DEFAULT_GRADE_BANDS): GradeResult {
  const values = Array.isArray(checklist) ? checklist : Object.values(checklist)
  const total = values.length
  const passed = values.filter(Boolean).length
  if (!total) return { grade: null, ratio: null, passed, total, capped: false }
  const ratio = passed / total
  // Tolerance so 4/5 = 0.8 is not lost to float error.
  const eps = 1e-9
  let grade: Grade = ratio + eps >= bands.A ? 'A' : ratio + eps >= bands.B ? 'B' : ratio + eps >= bands.C ? 'C' : 'D'
  let capped = false
  if (noPlan && (grade === 'A' || grade === 'B')) {
    grade = 'C'
    capped = true
  }
  return { grade, ratio, passed, total, capped }
}
