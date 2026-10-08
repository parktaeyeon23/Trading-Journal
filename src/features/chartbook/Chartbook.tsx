import { useEffect, useRef, useState, type DragEvent } from 'react'
import { addTradingViewChart, ChartLinkError, nextFreeSort } from '../../data/charts'
import { useData } from '../../data/dataStore'
import { newId } from '../../data/repo'
import type { TradeBundle } from '../../data/trades'
import type { ChartSlot } from '../../data/types'
import { useRepoQuery } from '../../ui/useRepoQuery'
import { FIXED_SLOTS, itemsFromTrade, MAX_FREE, objectUrlsFor, releaseObjectUrls, slotLabel, type ChartItem } from './chartItems'
import { FallbackImg } from './FallbackImg'
import { prepareImage } from './image'
import { postChartDays } from './postChart'
import { todayKst } from '../calendar/calText'
import { Viewer } from './Viewer'


function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  const out: File[] = []
  for (const x of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const f = x instanceof File ? x : x.kind === 'file' ? x.getAsFile() : null
    if (f && f.type.startsWith('image/')) out.push(f)
  }
  return out
}

export function Chartbook({ trade }: { trade: TradeBundle }) {
  const repo = useData((s) => s.repo)
  const uploads = useData((s) => s.uploads)
  const configured = useData((s) => !!s.config)
  const positionId = trade.position.id
  const pending = useRepoQuery(async () => (uploads ? uploads.list(positionId) : []), [uploads, positionId]) ?? []
  const items = itemsFromTrade(trade, pending, objectUrlsFor(pending))
  useEffect(() => releaseObjectUrls(positionId, pending))

  const closed = trade.position.status === 'review_pending' || trade.position.status === 'done'
  const bySlot = (slot: ChartSlot) => items.filter((x) => x.slot === slot)
  const freeItems = bySlot('free')
  const defaultTarget: ChartSlot = closed && !bySlot('exit').length ? 'exit' : (FIXED_SLOTS.find((s) => !bySlot(s.slot).length)?.slot ?? 'free')
  const [picked, setPicked] = useState<ChartSlot | null>(null)
  const target = picked ?? defaultTarget

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [viewing, setViewing] = useState<number | null>(null)
  const [dragSlot, setDragSlot] = useState<ChartSlot | 'card' | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pickSlot = useRef<ChartSlot>('free')

  /** Replacing a filled fixed slot asks first; the old picture goes once the new one is queued. */
  function confirmSlot(slot: ChartSlot, adding: number): ChartItem[] | null {
    if (slot === 'free') {
      if (freeItems.length + adding > MAX_FREE) {
        setError(`자유 첨부는 ${MAX_FREE}장까지입니다.`)
        return null
      }
      return []
    }
    const old = bySlot(slot)
    if (old.length && !window.confirm(`${slotLabel(slot)} 차트를 새 이미지로 바꿀까요?`)) return null
    return old
  }

  async function removeItem(item: ChartItem) {
    if (item.kind === 'pending') await uploads?.remove(item.id)
    else if (repo) await repo.remove('ChartImages', item.id)
  }

  async function addFiles(files: File[], slot: ChartSlot) {
    if (!uploads || !files.length) return
    const use = slot === 'free' ? files : files.slice(0, 1)
    const old = confirmSlot(slot, use.length)
    if (!old) return
    setBusy(true)
    setError(null)
    try {
      let sort = nextFreeSort(trade.charts, pending)
      for (const f of use) {
        const img = await prepareImage(f)
        await uploads.add({ id: newId(), position_id: positionId, slot, sort: slot === 'free' ? sort++ : null, ...img })
      }
      for (const o of old) await removeItem(o)
      setPicked(null)
    } catch (e) {
      setError(e instanceof Error ? `이미지를 처리하지 못했습니다: ${e.message}` : '이미지를 처리하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function addLink() {
    if (!repo || !link.trim()) return
    const old = confirmSlot(target, 1)
    if (!old) return
    setError(null)
    try {
      await addTradingViewChart(repo, positionId, target, link, target === 'free' ? nextFreeSort(trade.charts, pending) : null)
      for (const o of old) await removeItem(o)
      setLink('')
      setPicked(null)
    } catch (e) {
      setError(e instanceof ChartLinkError ? e.message : String(e))
    }
  }

  // Paste anywhere on the trade page drops the picture into the target slot.
  const pasteRef = useRef<(files: File[]) => void>(() => {})
  useEffect(() => {
    pasteRef.current = (files) => void addFiles(files, target)
  })
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (document.querySelector('.sheet, .viewer')) return
      const files = imageFiles(e.clipboardData?.items)
      if (!files.length) return
      e.preventDefault()
      pasteRef.current(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const dropProps = (slot: ChartSlot | 'card') => ({
    onDragOver: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      setDragSlot(slot)
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDragSlot(null)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragSlot(null)
      void addFiles(imageFiles(e.dataTransfer.files), slot === 'card' ? target : slot)
    },
  })

  const openPicker = (slot: ChartSlot) => {
    pickSlot.current = slot
    if (fileInput.current) {
      fileInput.current.multiple = slot === 'free'
      fileInput.current.click()
    }
  }

  const postDue = postChartDays(trade, todayKst(), pending.filter((p) => p.slot === 'post').length)
  const waiting = pending.filter((p) => p.state === 'waiting').length
  const failed = pending.filter((p) => p.state === 'failed').length

  return (
    <section className={`card stack chartbook${dragSlot === 'card' ? ' drop-on' : ''}`} aria-labelledby="chart-title" {...dropProps('card')}>
      <div className="row">
        <h2 id="chart-title" className="section-title">
          차트북
        </h2>
        <span className="help push-right" style={{ margin: 0 }}>
          {items.length}장
        </span>
      </div>

      <div className="slot-grid">
        {FIXED_SLOTS.map((s) => {
          const it = bySlot(s.slot)
          const first = it[0]
          const missingExit = s.slot === 'exit' && closed && !first
          return (
            <div key={s.slot} className={`slot-cell${dragSlot === s.slot ? ' drop-on' : ''}`} {...dropProps(s.slot)}>
              {first ? (
                <button type="button" className="slot slot-filled" onClick={() => setViewing(items.indexOf(first))} aria-label={`${s.label} 차트 크게 보기`}>
                  <FallbackImg srcs={first.thumb} alt={s.label} />
                  <span className="slot-label">
                    {s.label}
                    {it.length > 1 && <span className="num"> +{it.length - 1}</span>}
                  </span>
                  {first.kind === 'pending' && <span className={`slot-state${first.state === 'failed' ? ' bad' : ''}`}>{first.state === 'failed' ? '실패' : '대기'}</span>}
                </button>
              ) : (
                <button type="button" className={`slot slot-empty${missingExit ? ' slot-required' : ''}${target === s.slot ? ' slot-target' : ''}`} onClick={() => openPicker(s.slot)} disabled={busy}>
                  <span className="slot-plus" aria-hidden="true">
                    +
                  </span>
                  <span>{s.label}</span>
                  <span className="slot-hint">{s.hint}</span>
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className={`free-strip${dragSlot === 'free' ? ' drop-on' : ''}`} {...dropProps('free')}>
        {freeItems.map((f) => (
          <button key={f.key} type="button" className="free-thumb" onClick={() => setViewing(items.indexOf(f))} aria-label="자유 첨부 크게 보기">
            <FallbackImg srcs={f.thumb} alt="자유 첨부" />
            {f.kind === 'pending' && <span className={`slot-state${f.state === 'failed' ? ' bad' : ''}`}>{f.state === 'failed' ? '실패' : '대기'}</span>}
          </button>
        ))}
        {freeItems.length < MAX_FREE && (
          <button type="button" className="free-thumb free-add" onClick={() => openPicker('free')} disabled={busy}>
            + 자유 첨부
          </button>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const files = imageFiles(e.target.files)
          e.target.value = ''
          void addFiles(files, pickSlot.current)
        }}
      />

      <div className="field">
        <div className="row wrap">
          <span className="field-label">붙여넣기·끌어놓기·링크 대상</span>
          <select className="input input-small push-right" value={target} onChange={(e) => setPicked(e.target.value as ChartSlot)} aria-label="추가할 슬롯">
            {FIXED_SLOTS.map((s) => (
              <option key={s.slot} value={s.slot}>
                {s.label}
              </option>
            ))}
            <option value="free">자유 첨부</option>
          </select>
        </div>
        <div className="row">
          <input
            className="input"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addLink()}
            placeholder="TradingView 스냅샷 링크 https://www.tradingview.com/x/…"
            aria-label="TradingView 스냅샷 링크"
          />
          <button type="button" className="btn btn-secondary" onClick={() => void addLink()} disabled={!link.trim()}>
            추가
          </button>
        </div>
        <p className="help" style={{ margin: 0 }}>
          캡처 후 이 화면에서 Ctrl+V(⌘V)로 붙여넣거나, 이미지를 슬롯에 끌어다 놓으세요.
        </p>
      </div>

      {busy && <p className="help" role="status">이미지 줄이는 중…</p>}
      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}
      {(waiting > 0 || failed > 0) && (
        <p className={`notice ${failed ? 'notice-bad' : 'notice-warn'}`} role="status">
          {waiting > 0 && (configured ? `${waiting}장 업로드 대기 중 — 연결되면 자동으로 올라갑니다.` : `${waiting}장이 이 기기에 보관 중입니다. 설정에서 백엔드를 연결하면 올라갑니다.`)}
          {failed > 0 && ` ${failed}장 업로드 실패 — 이미지를 눌러 다시 시도하세요.`}
        </p>
      )}
      {closed && !bySlot('exit').length && (
        <p className="notice notice-warn" role="status">
          ③ 청산 차트는 필수입니다. 올려야 복기를 저장할 수 있습니다.
        </p>
      )}
      {postDue !== null && (
        <p className="notice notice-warn" role="status">
          청산 후 {postDue}거래일이 지났습니다 — ④ 사후 복기 차트로 이후 흐름을 남겨 두세요.
        </p>
      )}
      <p className="help" style={{ margin: 0 }}>
        차트는 Google Drive에 "링크가 있는 모든 사용자" 공개로 저장됩니다. 계좌번호·잔고가 보이는 화면은 올리지 마세요.
      </p>

      {viewing !== null && items.length > 0 && (
        <Viewer
          items={items}
          start={Math.max(0, Math.min(viewing, items.length - 1))}
          title={trade.position.ticker}
          onClose={() => setViewing(null)}
          onRetry={(it) => void uploads?.retry(it.id)}
          onDelete={(it) => {
            if (!window.confirm(`${slotLabel(it.slot)} 차트를 삭제할까요?`)) return
            void removeItem(it)
            if (items.length <= 1) setViewing(null)
          }}
        />
      )}
    </section>
  )
}
