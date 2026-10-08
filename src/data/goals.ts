import type { Goals } from '../core/goals'
import type { LocalRepo } from './repo'
import { readSetting, SETTING_KEYS, writeSetting } from './settings'

const pos = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null)

export async function readGoals(repo: LocalRepo): Promise<Goals> {
  const [m, d, w] = await Promise.all([
    readSetting<unknown>(repo, SETTING_KEYS.monthlyGoalR, null),
    readSetting<unknown>(repo, SETTING_KEYS.dailyLossLimitR, null),
    readSetting<unknown>(repo, SETTING_KEYS.weeklyLossLimitR, null),
  ])
  return { monthlyR: pos(m), dailyLossR: pos(d), weeklyLossR: pos(w) }
}

/** Limits are stored as positive R amounts; a sign typed by habit (−3) is dropped. */
export async function writeGoals(repo: LocalRepo, g: Goals): Promise<void> {
  const clean = (v: number | null) => (v === null || !Number.isFinite(v) || v === 0 ? null : Math.abs(v))
  await writeSetting(repo, SETTING_KEYS.monthlyGoalR, clean(g.monthlyR))
  await writeSetting(repo, SETTING_KEYS.dailyLossLimitR, clean(g.dailyLossR))
  await writeSetting(repo, SETTING_KEYS.weeklyLossLimitR, clean(g.weeklyLossR))
}
