/**
 * "자동 차트 만들기": plans the charts a trade can get, fetches bars from the
 * backend, draws each picture and puts it in the upload queue (fills empty
 * slots only; extra entry days become free attachments).
 */
import { tradeDate } from '../../core/calendar'
import { fillMarks, planCharts, type AutoSlot, type ChartJob, type SkipReason } from '../../core/chartData'
import { BackendError, type ChartBarsResult, type ChartInterval } from '../../data/backend'
import { nextFreeSort } from '../../data/charts'
import { newId } from '../../data/repo'
import type { TradeBundle } from '../../data/trades'
import type { PendingUpload, UploadQueue } from '../../data/uploads'
import { MAX_FREE, slotLabel } from './chartItems'
import { prepareImage } from './image'

export const SKIP_TEXT: Record<SkipReason, string> = {
  filled: '이미 차트가 있음',
  no_entry: '진입 체결이 없음',
  not_closed: '전량 청산 후 가능',
  post_not_due: '청산 후 10거래일이 지나야 가능',
  intraday_expired: '분봉 보관 기간(약 60일)이 지남',
}

export interface AutoResult {
  made: string[]
  skipped: string[]
  failed: string[]
}

type GetBars = (symbol: string, market: 'KR' | 'US', from: string, to: string, interval: ChartInterval) => Promise<ChartBarsResult>

const BAR_SECONDS = 300

export function autoPlan(trade: TradeBundle, pending: PendingUpload[], now = new Date().toISOString()) {
  const p = trade.position
  const filled = new Set<AutoSlot>([...trade.charts.map((c) => c.slot), ...pending.map((u) => u.slot)].filter((s) => s !== 'free') as AutoSlot[])
  const closed = p.status === 'review_pending' || p.status === 'done'
  return planCharts({ market: p.market, direction: p.direction, fills: trade.fills, closed, filled, today: tradeDate(now, p.market) })
}

const jobName = (j: ChartJob) => (j.slot === 'free' ? `자유 첨부 (${j.date} 분봉)` : slotLabel(j.slot))

export async function makeAutoCharts(trade: TradeBundle, pending: PendingUpload[], uploads: UploadQueue, getBars: GetBars, onProgress: (text: string) => void): Promise<AutoResult> {
  const p = trade.position
  const plan = autoPlan(trade, pending)
  const out: AutoResult = { made: [], skipped: [], failed: [] }
  for (const s of plan.skipped) if (s.reason !== 'filled') out.skipped.push(`${slotLabel(s.slot)}${s.date ? ` ${s.date}` : ''}: ${SKIP_TEXT[s.reason]}`)

  const { renderChartPng } = await import('./autoChart')
  const precision = p.market === 'KR' ? 0 : 2
  const originalStop = p.original_stop ?? trade.plan?.plan_stop ?? null
  const stopSteps = [...trade.stops].sort((a, b) => (a.ts < b.ts ? -1 : 1)).map((s) => ({ date: tradeDate(s.ts, p.market), stop: s.new_stop }))
  const name = [p.ticker.toUpperCase(), p.ticker_name].filter(Boolean).join(' ')
  let freeCount = trade.charts.filter((c) => c.slot === 'free').length + pending.filter((u) => u.slot === 'free').length
  let sort = nextFreeSort(trade.charts, pending)

  for (const [i, job] of plan.jobs.entries()) {
    const label = jobName(job)
    if (job.slot === 'free' && freeCount >= MAX_FREE) {
      out.skipped.push(`${label}: 자유 첨부 ${MAX_FREE}장이 다 참`)
      continue
    }
    onProgress(`${i + 1}/${plan.jobs.length} ${label} 만드는 중…`)
    try {
      const res = await getBars(p.ticker, p.market, job.fetchFrom, job.fetchTo, job.kind === 'daily' ? '1d' : '5m')
      const marks = fillMarks(trade.fills, p.direction, p.market, job.kind === 'daily' ? { kind: 'daily' } : { kind: 'intraday', date: job.date!, barSeconds: BAR_SECONDS })
      const blob = await renderChartPng({
        kind: job.kind,
        title: `${name} · ${slotLabel(job.slot === 'free' ? 'entry' : job.slot)}${job.slot === 'free' ? ' (추가 진입일)' : ''}`,
        subtitle: job.kind === 'daily' ? `일봉 ${job.showFrom} ~ ${job.showTo}` : `5분봉 ${job.date} · 거래소 시각 · VWAP`,
        bars: res.bars,
        gmtoffset: res.gmtoffset ?? 0,
        showFrom: job.showFrom,
        showTo: job.showTo,
        marks,
        originalStop,
        stopSteps,
        precision,
      })
      const img = await prepareImage(blob)
      await uploads.add({ id: newId(), position_id: p.id, slot: job.slot, sort: job.slot === 'free' ? sort++ : null, ...img })
      if (job.slot === 'free') freeCount++
      out.made.push(label)
    } catch (e) {
      const why = e instanceof BackendError || e instanceof Error ? e.message : String(e)
      out.failed.push(`${label}: ${why}`)
    }
  }
  return out
}
