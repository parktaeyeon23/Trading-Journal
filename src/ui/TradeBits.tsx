import { formatMoney, formatR, pnlTone, type Currency } from '../core/format'

export function GradeBadge({ grade, size = 'small' }: { grade: string | null | undefined; size?: 'small' | 'large' }) {
  if (!grade) return null
  return (
    <span className={`grade grade-${grade} grade-${size}`} aria-label={`실행 등급 ${grade}`}>
      {grade}
    </span>
  )
}

/** Money or R colored by sign (KR convention: profit red, loss blue). */
export function PnlText({ value, kind, currency, className = '' }: { value: number | null | undefined; kind: 'money' | 'r'; currency?: Currency; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={`num faint ${className}`}>—</span>
  const tone = pnlTone(value)
  const text = kind === 'r' ? formatR(value) : formatMoney(value, currency ?? 'KRW')
  return <span className={`num ${tone === 'flat' ? '' : tone} ${className}`}>{text}</span>
}
