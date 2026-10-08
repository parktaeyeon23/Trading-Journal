import type { ReactNode } from 'react'
import type { BreakdownRow, HistogramBin } from '../../core/analysis'
import { toneClass } from '../calendar/calText'

/** Formats a value in the analysis unit. */
export type Fmt = (v: number) => string

export function MetricCard({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: number | null }) {
  return (
    <div className="metric-card">
      <span className="field-label">{label}</span>
      <span className={`num metric-v ${tone != null ? toneClass(tone) : ''}`}>{value}</span>
      {sub && <span className="small faint">{sub}</span>}
    </div>
  )
}

/**
 * Rows with a diverging bar (profit right in red, loss left in blue, KR
 * convention). Each row opens the drill-down.
 */
export function BarRows({ rows, fmt, onOpen, label = (k: string) => k }: { rows: BreakdownRow[]; fmt: Fmt; onOpen: (title: string, ids: string[]) => void; label?: (key: string) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.total)))
  if (!rows.length) return <p className="help">해당하는 트레이드가 없습니다.</p>
  return (
    <div className="bar-rows" role="list">
      {rows.map((r) => (
        <button key={r.key} type="button" role="listitem" className="bar-row" onClick={() => onOpen(label(r.key), r.ids)}>
          <span className="bar-key">{label(r.key)}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-mid" />
            <span className={`bar-fill ${r.total >= 0 ? 'pos' : 'neg'}`} style={{ width: `${(Math.abs(r.total) / max) * 50}%` }} />
          </span>
          <span className={`num bar-total ${toneClass(r.total)}`}>{fmt(r.total)}</span>
          <span className="bar-meta small faint num">
            {r.count}건{r.winRate === null ? '' : ` · 승률 ${Math.round(r.winRate * 100)}%`} · 평균 {r.avg === null ? '—' : fmt(r.avg)}
          </span>
        </button>
      ))}
    </div>
  )
}

export function Histogram({ bins, title }: { bins: HistogramBin[]; title: string }) {
  const max = Math.max(1, ...bins.map((b) => b.count))
  const total = bins.reduce((s, b) => s + b.count, 0)
  return (
    <figure className="histo" aria-label={`${title}: ${bins.map((b) => `${b.label} ${b.count}건`).join(', ')}`}>
      <figcaption className="field-label">
        {title} <span className="faint">{total}건 · R</span>
      </figcaption>
      <div className="histo-bars">
        {bins.map((b) => (
          <div key={b.label} className="histo-col">
            <span className="histo-n num small">{b.count || ''}</span>
            <span className="histo-bar" style={{ height: `${(b.count / max) * 100}%` }} />
            <span className="histo-label">{b.label}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}

export function Section({ id, title, children, aside }: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card stack" aria-labelledby={id}>
      <div className="row wrap">
        <h2 id={id} className="section-title">
          {title}
        </h2>
        {aside && <span className="push-right">{aside}</span>}
      </div>
      {children}
    </section>
  )
}
