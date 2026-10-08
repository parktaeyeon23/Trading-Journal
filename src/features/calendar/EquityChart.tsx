import { useLayoutEffect, useRef, useState } from 'react'
import type { CalUnit, EquityPoint } from '../../core/calendar'
import { full, md, toneClass } from './calText'

const H = 150
const DD_H = 44
const PAD = { l: 8, r: 8, t: 10, b: 6 }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/**
 * Cumulative realized P&L over the period with its drawdown below.
 * Line is neutral ink (green is for brand/actions only); drawdown uses the loss colour.
 */
export function EquityChart({ points, unit, title, highlight, onHover }: { points: EquityPoint[]; unit: CalUnit; title: string; highlight: string | null; onHover: (d: string | null) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  if (!points.length) {
    return (
      <section className="card stack" aria-label={title}>
        <h2 className="section-title">{title}</h2>
        <p className="help" style={{ margin: 0 }}>
          이 기간에 청산된 트레이드가 없습니다.
        </p>
      </section>
    )
  }

  // A leading zero point so a one-day period still draws a line.
  const pts = [{ date: '', cum: 0, dd: 0 }, ...points]
  const n = pts.length
  const xs = (i: number) => PAD.l + (i * (width - PAD.l - PAD.r)) / Math.max(1, n - 1)
  const hi = Math.max(0, ...pts.map((p) => p.cum))
  const lo = Math.min(0, ...pts.map((p) => p.cum))
  const span = hi - lo || 1
  const ys = (v: number) => PAD.t + ((hi - v) * (H - PAD.t - PAD.b)) / span
  const minDd = Math.min(...pts.map((p) => p.dd))
  const yd = (v: number) => (minDd < 0 ? (v / minDd) * (DD_H - 4) : 0)

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.cum).toFixed(1)}`).join(' ')
  const area = `${line} L${xs(n - 1).toFixed(1)} ${ys(0).toFixed(1)} L${xs(0).toFixed(1)} ${ys(0).toFixed(1)} Z`
  const ddArea = `M${xs(0)} 0 ` + pts.map((p, i) => `L${xs(i).toFixed(1)} ${yd(p.dd).toFixed(1)}`).join(' ') + ` L${xs(n - 1).toFixed(1)} 0 Z`

  const hlIndex = hover ?? (highlight ? pts.findIndex((p) => p.date === highlight) : -1)
  const hp = hlIndex > 0 ? pts[hlIndex] : null
  const worst = points.reduce((a, b) => (b.dd < a.dd ? b : a))
  const last = points[points.length - 1]

  const pick = (clientX: number, el: Element) => {
    const x = clientX - el.getBoundingClientRect().left
    const i = Math.round(((x - PAD.l) / (width - PAD.l - PAD.r)) * (n - 1))
    return Math.min(n - 1, Math.max(1, i))
  }

  return (
    <section className="card stack" aria-label={title}>
      <div className="row wrap">
        <h2 className="section-title">{title}</h2>
        <span className={`num strong ${toneClass(last.cum)}`}>{full(last.cum, unit)}</span>
        <span className="help push-right" style={{ margin: 0 }}>
          최대 드로다운 <b className={`num ${worst.dd < 0 ? 'loss' : ''}`}>{worst.dd < 0 ? full(worst.dd, unit) : '없음'}</b>
          {worst.dd < 0 && ` (${md(worst.date)})`}
        </span>
      </div>
      <div ref={ref} className="equity-wrap">
        <svg
          width={width}
          height={H + DD_H + 4}
          role="img"
          aria-label={`${title}: 마지막 ${full(last.cum, unit)}`}
          onPointerMove={(e) => {
            const i = pick(e.clientX, e.currentTarget)
            setHover(i)
            onHover(pts[i].date)
          }}
          onPointerLeave={() => {
            setHover(null)
            onHover(null)
          }}
        >
          <line x1={PAD.l} x2={width - PAD.r} y1={ys(0)} y2={ys(0)} className="eq-zero" />
          <path d={area} className="eq-area" />
          <path d={line} className="eq-line" />
          <g transform={`translate(0 ${H + 4})`}>
            <line x1={PAD.l} x2={width - PAD.r} y1={0} y2={0} className="eq-zero" />
            <path d={ddArea} className="eq-dd" />
          </g>
          {hp && (
            <g>
              <line x1={xs(hlIndex)} x2={xs(hlIndex)} y1={PAD.t} y2={H + DD_H} className="eq-cursor" />
              <circle cx={xs(hlIndex)} cy={ys(hp.cum)} r={4} className="eq-dot" />
            </g>
          )}
        </svg>
        {hp && (
          <div className="eq-tip" style={{ left: Math.min(Math.max(xs(hlIndex), 60), width - 60) }}>
            <b>{md(hp.date)}</b> <span className={`num ${toneClass(hp.cum)}`}>{full(hp.cum, unit)}</span>
            {hp.dd < 0 && <span className="num loss"> · DD {full(hp.dd, unit)}</span>}
          </div>
        )}
      </div>
    </section>
  )
}
