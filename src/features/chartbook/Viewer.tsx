import { useEffect, useRef, useState } from 'react'
import { slotLabel, type ChartItem } from './chartItems'
import { FallbackImg } from './FallbackImg'

interface ViewerProps {
  items: ChartItem[]
  start: number
  title: string
  onClose: () => void
  onDelete: (item: ChartItem) => void
  onRetry: (item: ChartItem) => void
}

/**
 * Fullscreen chart viewer. ←/→ or swipe to move, double-click/tap or the
 * zoom button for 100% (then drag/scroll to pan), Esc to close.
 */
export function Viewer({ items, start, title, onClose, onDelete, onRetry }: ViewerProps) {
  const [index, setIndex] = useState(start)
  const [zoom, setZoom] = useState(false)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  /** A drag ends in a click too; that click must not close the viewer. */
  const dragged = useRef(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const count = items.length
  const i = Math.min(index, count - 1)
  const item = items[i]

  const go = (d: number) => {
    if (count < 2) return
    setZoom(false)
    setIndex((n) => (Math.min(n, count - 1) + d + count) % count)
  }

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!item) return null

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`${title} 차트 보기`}>
      <div className="viewer-bar">
        <span className="viewer-title">
          {slotLabel(item.slot)}
          <span className="num viewer-count">
            {i + 1}/{count}
          </span>
          {item.kind === 'pending' && <span className="viewer-tag">{item.state === 'failed' ? '업로드 실패' : '업로드 대기'}</span>}
          {item.kind === 'link' && <span className="viewer-tag">TradingView</span>}
        </span>
        <div className="viewer-actions">
          {item.kind === 'link' && item.link && (
            <a className="viewer-btn" href={item.link} target="_blank" rel="noreferrer">
              원본
            </a>
          )}
          {item.kind === 'pending' && item.state === 'failed' && (
            <button type="button" className="viewer-btn" onClick={() => onRetry(item)}>
              다시 시도
            </button>
          )}
          <button type="button" className="viewer-btn" aria-pressed={zoom} onClick={() => setZoom((z) => !z)}>
            {zoom ? '맞춤' : '확대'}
          </button>
          <button type="button" className="viewer-btn" onClick={() => onDelete(item)}>
            삭제
          </button>
          <button type="button" className="viewer-btn" aria-label="닫기" onClick={onClose} ref={closeRef}>
            ✕
          </button>
        </div>
      </div>
      {item.error && <p className="viewer-error">{item.error}</p>}
      <div
        className={`viewer-stage${zoom ? ' zoomed' : ''}`}
        onDoubleClick={() => setZoom((z) => !z)}
        onPointerDown={(e) => {
          if (!zoom) swipe.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const s = swipe.current
          swipe.current = null
          if (!s || zoom) return
          const dx = e.clientX - s.x
          dragged.current = Math.hypot(dx, e.clientY - s.y) > 10
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1)
        }}
        onClick={(e) => {
          const wasDrag = dragged.current
          dragged.current = false
          if (!wasDrag && e.target === e.currentTarget && !zoom) onClose()
        }}
      >
        <FallbackImg key={item.key} srcs={item.full} alt={`${title} ${slotLabel(item.slot)}`} draggable={false} />
      </div>
      {count > 1 && (
        <>
          <button type="button" className="viewer-nav prev" aria-label="이전 차트" onClick={() => go(-1)}>
            ‹
          </button>
          <button type="button" className="viewer-nav next" aria-label="다음 차트" onClick={() => go(1)}>
            ›
          </button>
        </>
      )}
    </div>
  )
}
