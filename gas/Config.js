/**
 * Sheet schema — one sheet per entity. Column order here is only used when a
 * sheet or column is first created; reads and writes go by header name.
 *
 * Field spec: { type, required?, values? (enum), ref? (entity name) }
 * types: string | number | int | boolean | json | enum | date (YYYY-MM-DD) | ts (ISO 8601)
 */
var SCHEMA_VERSION = 1

var COMMON_FIELDS = {
  id: { type: 'string', required: true },
  created_at: { type: 'ts', required: true },
  updated_at: { type: 'ts', required: true },
  deleted: { type: 'boolean' },
  schema_version: { type: 'int' },
  // Server write time. Set by the server on every insert/update, never trusted
  // from clients. pullAll filters on it, so rows edited offline on another
  // device (old updated_at, late upload) still reach everyone.
  synced_at: { type: 'ts' },
}

var MARKETS = ['KR', 'US']

var ENTITIES = {
  Accounts: {
    market: { type: 'enum', values: MARKETS, required: true },
    currency: { type: 'enum', values: ['KRW', 'USD'], required: true },
    start_capital: { type: 'number' },
    current_size: { type: 'number' },
  },
  Positions: {
    account_id: { type: 'string', ref: 'Accounts' },
    ticker: { type: 'string', required: true },
    ticker_name: { type: 'string' },
    market: { type: 'enum', values: MARKETS, required: true },
    direction: { type: 'enum', values: ['long', 'short'], required: true },
    setup: { type: 'string' },
    status: { type: 'enum', values: ['planned', 'open', 'review_pending', 'done'], required: true },
    original_stop: { type: 'number' },
    regime: { type: 'enum', values: ['trend', 'transition', 'range'] },
    no_plan: { type: 'boolean' },
    legacy_id: { type: 'string' },
  },
  Plans: {
    position_id: { type: 'string', ref: 'Positions', required: true },
    thesis: { type: 'string' },
    invalidation: { type: 'string' },
    plan_entry: { type: 'number' },
    plan_stop: { type: 'number' },
    plan_qty: { type: 'number' },
    rpt_pct: { type: 'number' },
    risk_amount: { type: 'number' },
    target_rule: { type: 'string' },
    pyramid_plan: { type: 'json' },
    pre_condition: { type: 'json' },
    calc_snapshot: { type: 'json' },
  },
  Fills: {
    position_id: { type: 'string', ref: 'Positions', required: true },
    ts: { type: 'ts', required: true },
    side: { type: 'enum', values: ['buy', 'sell'], required: true },
    price: { type: 'number', required: true, min: 0, exclusiveMin: true },
    qty: { type: 'number', required: true, min: 0, exclusiveMin: true },
    fee: { type: 'number', min: 0 },
    tax: { type: 'number', min: 0 },
    pyramid_stage: { type: 'int', min: 1 },
    memo: { type: 'string' },
  },
  StopHistory: {
    position_id: { type: 'string', ref: 'Positions', required: true },
    ts: { type: 'ts', required: true },
    old_stop: { type: 'number' },
    new_stop: { type: 'number', required: true },
    reason: { type: 'string' },
  },
  Reviews: {
    position_id: { type: 'string', ref: 'Positions', required: true },
    checklist: { type: 'json' },
    grade: { type: 'enum', values: ['A', 'B', 'C', 'D'] },
    good: { type: 'string' },
    improve: { type: 'string' },
    next_rule: { type: 'string' },
    promoted_rule: { type: 'boolean' },
  },
  ChartImages: {
    position_id: { type: 'string', ref: 'Positions', required: true },
    slot: { type: 'enum', values: ['setup', 'entry', 'exit', 'post', 'free'], required: true },
    file_id: { type: 'string' },
    thumb_file_id: { type: 'string' },
    annotation: { type: 'json' },
    sort: { type: 'int' },
  },
  Tags: {
    family: { type: 'enum', values: ['setup', 'mistake', 'emotion', 'regime', 'reason'], required: true },
    name: { type: 'string', required: true },
    color: { type: 'string' },
  },
  PositionTags: {
    position_id: { type: 'string', ref: 'Positions', required: true },
    tag_id: { type: 'string', ref: 'Tags', required: true },
    phase: { type: 'enum', values: ['entry', 'hold', 'exit'] },
  },
  DailyNotes: {
    date: { type: 'date', required: true },
    premarket: { type: 'string' },
    postmarket: { type: 'string' },
  },
  WeeklyReviews: {
    week_start: { type: 'date', required: true },
    answers: { type: 'json' },
    auto_draft: { type: 'json' },
  },
  Rules: {
    setup: { type: 'string' },
    text: { type: 'string', required: true },
    active: { type: 'boolean' },
  },
  MarketCache: {
    symbol: { type: 'string', required: true },
    date: { type: 'date', required: true },
    open: { type: 'number' },
    high: { type: 'number' },
    low: { type: 'number' },
    close: { type: 'number' },
  },
  Settings: {
    key: { type: 'string', required: true },
    value: { type: 'json' },
  },
}

/** Default Settings rows written by setupSheets() when the key is missing. */
var DEFAULT_SETTINGS = {
  account_size_KR: null,
  account_size_US: null,
  fee_rate_KR: null,
  tax_rate_KR: null,
  fee_rate_US: null,
  grade_bands: { A: 1, B: 0.8, C: 0.6 },
  max_position_pct: 25,
  max_open_risk_pct: 6,
  default_rpt_pct: 1.25,
}

/** Full field map for an entity: common fields first, then entity fields. */
function fieldsOf(entity) {
  var spec = ENTITIES[entity]
  if (!spec) return null
  var out = {}
  Object.keys(COMMON_FIELDS).forEach(function (k) {
    out[k] = COMMON_FIELDS[k]
  })
  Object.keys(spec).forEach(function (k) {
    out[k] = spec[k]
  })
  return out
}

function columnsOf(entity) {
  return Object.keys(fieldsOf(entity))
}

function entityNames() {
  return Object.keys(ENTITIES)
}
