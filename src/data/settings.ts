import type { LocalRepo } from './repo'

/**
 * App settings live in the synced Settings entity, one row per key. Ids match
 * the rows the server seeds ("setting-<key>"), so a value set on one device
 * before the first sync merges with the server's default instead of duplicating it.
 */
export const settingId = (key: string) => `setting-${key}`

export async function readSetting<T>(repo: LocalRepo, key: string, fallback: T): Promise<T> {
  const row = await repo.get('Settings', settingId(key))
  if (!row || row.deleted || row.value === null || row.value === undefined) return fallback
  return row.value as T
}

export async function writeSetting(repo: LocalRepo, key: string, value: unknown): Promise<void> {
  await repo.put('Settings', { id: settingId(key), key, value })
}

export const SETTING_KEYS = {
  accountSize: (market: 'KR' | 'US') => `account_size_${market}`,
  defaultRptPct: 'default_rpt_pct',
  maxPositionPct: 'max_position_pct',
  maxOpenRiskPct: 'max_open_risk_pct',
  gradeBands: 'grade_bands',
  feeRate: (market: 'KR' | 'US') => `fee_rate_${market}`,
  sellTaxKR: 'tax_rate_KR',
  monthlyGoalR: 'goal_monthly_r',
  dailyLossLimitR: 'loss_limit_daily_r',
  weeklyLossLimitR: 'loss_limit_weekly_r',
} as const
