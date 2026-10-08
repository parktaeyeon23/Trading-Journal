/**
 * Test data for performance checks — NOT for real use.
 *
 *   node scripts/seed.ts 500 > seed-500.json
 *
 * Writes an ALPHA JOURNAL export (same format as 설정 → 전체 내보내기), so it
 * loads through 설정 → "JSON에서 복원" in a throwaway browser profile.
 * Restoring replaces local data and queues it for upload — never restore it
 * into a profile connected to the real backend.
 * Self-contained on purpose (Node runs it with type stripping, no build step).
 */

const n = Number(process.argv[2] ?? 500)
const END = process.argv[3] ?? new Date().toISOString().slice(0, 10)

// Deterministic PRNG so runs are comparable.
let s = 0x2f6e2b1
const rnd = () => {
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  return ((s >>> 0) % 1_000_000) / 1_000_000
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
const id = (() => {
  let k = 0
  return (p: string) => `seed-${p}-${(++k).toString(36).padStart(6, '0')}`
})()

const DAY = 86400000
const endMs = Date.parse(END + 'T00:00:00Z')
const weekday = (ms: number) => {
  const d = new Date(ms).getUTCDay()
  return d !== 0 && d !== 6
}
/** A weekday `back` trading days before END. */
function dayBack(back: number): number {
  let ms = endMs
  let k = 0
  while (k < back) {
    ms -= DAY
    if (weekday(ms)) k++
  }
  return ms
}
const tsOn = (dayMs: number, market: 'KR' | 'US') =>
  new Date(dayMs + (market === 'KR' ? 30 : 14 * 60 + 30) * 60000 + Math.floor(rnd() * 5 * 3600000)).toISOString()

const base = (p: string, at: string) => ({ id: id(p), created_at: at, updated_at: at, deleted: false, schema_version: 1 })

const KR = ['005930', '000660', '042700', '247540', '086520', '196170', '058470', '039030']
const US = ['CRDO', 'NVDA', 'ANET', 'CELH', 'PLTR', 'APP', 'HIMS', 'RKLB']
const SETUPS = ['VCP 돌파', '눌림목', 'EP']
const MISTAKES = ['tag-mistake-chase', 'tag-mistake-late-stop', 'tag-mistake-early-exit', 'tag-mistake-oversize', 'tag-mistake-fomo']

const data: Record<string, unknown[]> = { Positions: [], Plans: [], Fills: [], Reviews: [], PositionTags: [], MarketCache: [] }

for (let i = 0; i < n; i++) {
  const market = rnd() < 0.6 ? 'KR' : 'US'
  const start = dayBack(Math.floor(rnd() * 480) + 3)
  const price = market === 'KR' ? Math.round((20000 + rnd() * 180000) / 100) * 100 : Math.round((20 + rnd() * 280) * 100) / 100
  const stop = market === 'KR' ? Math.round((price * (1 - 0.03 - rnd() * 0.04)) / 100) * 100 : Math.round(price * (1 - 0.03 - rnd() * 0.04) * 100) / 100
  const qty = market === 'KR' ? 20 + Math.floor(rnd() * 200) : 10 + Math.floor(rnd() * 150)
  const open = i < 8 // a few still open
  const at = new Date(start).toISOString()
  const pos = { ...base('pos', at), ticker: market === 'KR' ? pick(KR) : pick(US), market, direction: 'long', setup: pick(SETUPS), status: open ? 'open' : 'done', original_stop: stop, no_plan: rnd() < 0.08 }
  data.Positions.push(pos)
  if (!pos.no_plan) data.Plans.push({ ...base('plan', at), position_id: pos.id, plan_entry: price, plan_stop: stop, plan_qty: qty, rpt_pct: 1.25, risk_amount: Math.round(qty * (price - stop) * 100) / 100 })

  // 1–2 entries, then 1–3 exits over the following days.
  let day = start
  const entries = rnd() < 0.4 ? 2 : 1
  let held = 0
  for (let e = 0; e < entries; e++) {
    const q = e === 0 ? qty : Math.max(1, Math.round(qty * 0.5))
    const p = e === 0 ? price : Math.round(price * (1 + rnd() * 0.04) * 100) / 100
    data.Fills.push({ ...base('fill', at), position_id: pos.id, ts: tsOn(day, market), side: 'buy', price: p, qty: q, fee: 0, tax: 0, pyramid_stage: e + 1 })
    held += q
    day += DAY * (1 + Math.floor(rnd() * 2))
    while (!weekday(day)) day += DAY
  }
  if (open) continue
  const exits = 1 + Math.floor(rnd() * 3)
  const win = rnd() < 0.45
  for (let x = 0; x < exits; x++) {
    day += DAY * (1 + Math.floor(rnd() * 4))
    while (!weekday(day)) day += DAY
    if (day > endMs) day = endMs
    const q = x === exits - 1 ? held : Math.max(1, Math.floor(held / (exits - x)))
    held -= q
    const move = win ? 0.02 + rnd() * 0.18 : -(0.01 + rnd() * 0.05)
    const p = Math.max(1, Math.round(price * (1 + move) * 100) / 100)
    data.Fills.push({ ...base('fill', at), position_id: pos.id, ts: tsOn(day, market), side: 'sell', price: market === 'KR' ? Math.round(p) : p, qty: q, fee: 0, tax: 0, pyramid_stage: null })
  }
  const checklist = { 'builtin:entry': rnd() < 0.85, 'builtin:size': rnd() < 0.9, 'builtin:stop': rnd() < 0.8 }
  const kept = Object.values(checklist).filter(Boolean).length / 3
  const grade = pos.no_plan ? (kept >= 0.6 ? 'C' : 'D') : kept === 1 ? 'A' : kept >= 0.6 ? 'C' : 'D'
  data.Reviews.push({ ...base('rev', at), position_id: pos.id, checklist, grade, good: null, improve: null, next_rule: null, promoted_rule: false })
  if (rnd() < 0.35) data.PositionTags.push({ ...base('pt', at), position_id: pos.id, tag_id: pick(MISTAKES), phase: null })
}

// USD/KRW and index closes for every weekday in range.
let fx = 1330
const idx: Record<string, number> = { KOSPI: 2500, KOSDAQ: 800, SPX: 5200, NASDAQ: 16500 }
for (let ms = dayBack(500); ms <= endMs; ms += DAY) {
  if (!weekday(ms)) continue
  const date = new Date(ms).toISOString().slice(0, 10)
  const at = new Date(ms).toISOString()
  fx = Math.round((fx * (1 + (rnd() - 0.5) * 0.008)) * 100) / 100
  data.MarketCache.push({ ...base('mc', at), id: `IDX:USDKRW|${date}`, symbol: 'IDX:USDKRW', date, open: fx, high: fx, low: fx, close: fx })
  for (const k of Object.keys(idx)) {
    idx[k] = Math.round(idx[k] * (1 + (rnd() - 0.5) * 0.03) * 100) / 100
    data.MarketCache.push({ ...base('mc', at), id: `IDX:${k}|${date}`, symbol: `IDX:${k}`, date, open: idx[k], high: idx[k], low: idx[k], close: idx[k] })
  }
}

const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]))
process.stdout.write(JSON.stringify({ format: 'alpha-journal-dump', version: 1, exportedAt: new Date().toISOString(), counts, data }))
process.stderr.write(`seed: ${JSON.stringify(counts)}\n`)
