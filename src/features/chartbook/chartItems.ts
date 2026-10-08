import { SLOT_ORDER, type TradeBundle } from '../../data/trades'
import type { ChartSlot } from '../../data/types'
import type { PendingUpload } from '../../data/uploads'

/**
 * One picture as the UI shows it, whatever its state: uploaded to Drive,
 * still waiting in the upload queue, or a TradingView snapshot link.
 * src lists are tried in order (first that loads wins).
 */
export interface ChartItem {
  key: string
  slot: ChartSlot
  kind: 'drive' | 'pending' | 'link'
  thumb: string[]
  full: string[]
  /** ChartImages row id (drive/link) or queue id (pending). */
  id: string
  state?: 'waiting' | 'failed'
  error?: string | null
  link?: string
}

export const FIXED_SLOTS: { slot: Exclude<ChartSlot, 'free'>; label: string; hint: string }[] = [
  { slot: 'setup', label: '① 셋업', hint: '진입 전 일봉' },
  { slot: 'entry', label: '② 진입', hint: '진입 시점' },
  { slot: 'exit', label: '③ 청산', hint: '필수 · 일봉' },
  { slot: 'post', label: '④ 사후 복기', hint: '청산 후 5–20일' },
]
export const MAX_FREE = 8

export function slotLabel(slot: ChartSlot): string {
  return FIXED_SLOTS.find((s) => s.slot === slot)?.label ?? '자유 첨부'
}

/** Object URLs for queued images, kept across renders and released once the item leaves the queue. */
const urlCache = new Map<string, { position: string; full: string; thumb: string }>()

export function objectUrlsFor(pending: PendingUpload[]): Map<string, { full: string; thumb: string }> {
  for (const p of pending) {
    if (urlCache.has(p.id)) continue
    const full = URL.createObjectURL(new Blob([p.data], { type: p.mime }))
    const thumb = p.thumb ? URL.createObjectURL(new Blob([p.thumb], { type: p.mime })) : full
    urlCache.set(p.id, { position: p.position_id, full, thumb })
  }
  return urlCache
}

export function releaseObjectUrls(positionId: string, keep: PendingUpload[]) {
  const ids = new Set(keep.map((p) => p.id))
  for (const [id, u] of urlCache) {
    if (u.position !== positionId || ids.has(id)) continue
    URL.revokeObjectURL(u.full)
    if (u.thumb !== u.full) URL.revokeObjectURL(u.thumb)
    urlCache.delete(id)
  }
}

const driveThumb = (id: string, w: number) => [`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`, `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w${w}`]

export function itemsFromTrade(trade: TradeBundle, pending: PendingUpload[], objectUrls: Map<string, { full: string; thumb: string }>): ChartItem[] {
  const out: ChartItem[] = []
  for (const c of trade.charts) {
    const ann = (c.annotation ?? {}) as { link?: string; image?: string }
    if (c.file_id) {
      out.push({ key: c.id, id: c.id, slot: c.slot, kind: 'drive', thumb: driveThumb(c.thumb_file_id ?? c.file_id, 400), full: driveThumb(c.file_id, 2400) })
    } else if (ann.image) {
      out.push({ key: c.id, id: c.id, slot: c.slot, kind: 'link', thumb: [ann.image], full: [ann.image], link: ann.link })
    }
  }
  for (const p of pending) {
    const u = objectUrls.get(p.id)
    if (!u) continue
    out.push({ key: p.id, id: p.id, slot: p.slot, kind: 'pending', thumb: [u.thumb], full: [u.full], state: p.state, error: p.error })
  }
  // Stable sort: within a slot, uploaded rows keep their order and waiting ones follow.
  return out.sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
}

/** The picture that stands for a trade in the gallery: exit, else setup, entry, post, free. */
export function coverImage(trade: Pick<TradeBundle, 'charts'>): string[] | null {
  const order: ChartSlot[] = ['exit', 'setup', 'entry', 'post', 'free']
  for (const slot of order) {
    const c = trade.charts.find((x) => x.slot === slot)
    if (!c) continue
    if (c.file_id) return driveThumb(c.thumb_file_id ?? c.file_id, 400)
    const ann = (c.annotation ?? {}) as { image?: string }
    if (ann.image) return [ann.image]
  }
  return null
}
