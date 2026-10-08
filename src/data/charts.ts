/**
 * Chartbook writes that are not file uploads. Uploaded images arrive through
 * the UploadQueue; a TradingView snapshot link is just a ChartImages row with
 * no file (annotation.link + annotation.image), so it syncs like any row.
 */
import { tradingViewSnapshotImage } from '../core/charts'
import type { LocalRepo } from './repo'
import type { ChartImage, ChartSlot } from './types'
import type { PendingUpload } from './uploads'

export class ChartLinkError extends Error {}

export async function addTradingViewChart(repo: LocalRepo, positionId: string, slot: ChartSlot, link: string, sort: number | null = null): Promise<ChartImage> {
  const image = tradingViewSnapshotImage(link)
  if (!image) throw new ChartLinkError('TradingView 스냅샷 링크(…tradingview.com/x/…)만 넣을 수 있습니다.')
  return repo.put('ChartImages', { position_id: positionId, slot, file_id: null, thumb_file_id: null, annotation: { link: link.trim(), image }, sort })
}

/** Next sort value for a free attachment (uploaded and waiting ones both count). */
export function nextFreeSort(charts: Pick<ChartImage, 'slot' | 'sort'>[], pending: Pick<PendingUpload, 'slot' | 'sort'>[]): number {
  let max = -1
  for (const c of [...charts, ...pending]) if (c.slot === 'free' && typeof c.sort === 'number') max = Math.max(max, c.sort)
  return max + 1
}

/** Exit-slot pictures that count for the review: uploaded, linked, or still waiting to upload (not failed). */
export function exitChartCount(charts: Pick<ChartImage, 'slot'>[], pending: Pick<PendingUpload, 'slot' | 'state'>[]): number {
  return charts.filter((c) => c.slot === 'exit').length + pending.filter((p) => p.slot === 'exit' && p.state === 'waiting').length
}
