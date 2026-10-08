/**
 * Entity row types. Field names and entity names mirror gas/Config.js exactly —
 * the server rejects unknown fields, so add a field there first, then here.
 */

export type ISODate = string // YYYY-MM-DD
export type ISOTimestamp = string // 2026-10-08T06:40:00.000Z
export type Json = unknown

export interface BaseRow {
  id: string
  created_at: ISOTimestamp
  updated_at: ISOTimestamp
  deleted?: boolean
  schema_version?: number
  /** Set by the server on every write; never set it locally. */
  synced_at?: ISOTimestamp | null
}

export type Market = 'KR' | 'US'

export interface Account extends BaseRow {
  market: Market
  currency: 'KRW' | 'USD'
  start_capital?: number | null
  current_size?: number | null
}

export type PositionStatus = 'planned' | 'open' | 'review_pending' | 'done'
export interface Position extends BaseRow {
  account_id?: string | null
  ticker: string
  ticker_name?: string | null
  market: Market
  direction: 'long' | 'short'
  setup?: string | null
  status: PositionStatus
  original_stop?: number | null
  regime?: 'trend' | 'transition' | 'range' | null
  no_plan?: boolean
  legacy_id?: string | null
}

export interface Plan extends BaseRow {
  position_id: string
  thesis?: string | null
  invalidation?: string | null
  plan_entry?: number | null
  plan_stop?: number | null
  plan_qty?: number | null
  rpt_pct?: number | null
  risk_amount?: number | null
  target_rule?: string | null
  pyramid_plan?: Json
  pre_condition?: Json
  calc_snapshot?: Json
}

export interface Fill extends BaseRow {
  position_id: string
  ts: ISOTimestamp
  side: 'buy' | 'sell'
  price: number
  qty: number
  fee?: number | null
  tax?: number | null
  pyramid_stage?: number | null
  memo?: string | null
}

export interface StopChange extends BaseRow {
  position_id: string
  ts: ISOTimestamp
  old_stop?: number | null
  new_stop: number
  reason?: string | null
}

export interface Review extends BaseRow {
  position_id: string
  checklist?: Json
  grade?: 'A' | 'B' | 'C' | 'D' | null
  good?: string | null
  improve?: string | null
  next_rule?: string | null
  promoted_rule?: boolean
}

export type ChartSlot = 'setup' | 'entry' | 'exit' | 'post' | 'free'
export interface ChartImage extends BaseRow {
  position_id: string
  slot: ChartSlot
  file_id?: string | null
  thumb_file_id?: string | null
  annotation?: Json
  sort?: number | null
}

export interface Tag extends BaseRow {
  family: 'setup' | 'mistake' | 'emotion' | 'regime'
  name: string
  color?: string | null
}

export interface PositionTag extends BaseRow {
  position_id: string
  tag_id: string
  phase?: 'entry' | 'hold' | 'exit' | null
}

export interface DailyNote extends BaseRow {
  date: ISODate
  premarket?: string | null
  postmarket?: string | null
}

export interface WeeklyReview extends BaseRow {
  week_start: ISODate
  answers?: Json
  auto_draft?: Json
}

export interface Rule extends BaseRow {
  setup?: string | null
  text: string
  active?: boolean
}

export interface MarketBar extends BaseRow {
  symbol: string
  date: ISODate
  open?: number | null
  high?: number | null
  low?: number | null
  close?: number | null
}

export interface SettingRow extends BaseRow {
  key: string
  value?: Json
}

export interface EntityMap {
  Accounts: Account
  Positions: Position
  Plans: Plan
  Fills: Fill
  StopHistory: StopChange
  Reviews: Review
  ChartImages: ChartImage
  Tags: Tag
  PositionTags: PositionTag
  DailyNotes: DailyNote
  WeeklyReviews: WeeklyReview
  Rules: Rule
  MarketCache: MarketBar
  Settings: SettingRow
}

export type EntityName = keyof EntityMap

/**
 * Push order: parents before children so the server's reference checks pass
 * when both arrive in the same batch.
 */
export const ENTITY_ORDER: EntityName[] = [
  'Accounts',
  'Tags',
  'Rules',
  'Settings',
  'Positions',
  'Plans',
  'Fills',
  'StopHistory',
  'Reviews',
  'ChartImages',
  'PositionTags',
  'DailyNotes',
  'WeeklyReviews',
  'MarketCache',
]

/** Entities that hang off a position — get a position_id index locally. */
export const POSITION_CHILDREN: EntityName[] = ['Plans', 'Fills', 'StopHistory', 'Reviews', 'ChartImages', 'PositionTags']
