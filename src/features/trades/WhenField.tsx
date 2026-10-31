import { previousWeekday, shiftDays, withDate } from '../../core/when'
import { localDateTimeValue } from '../../ui/tradeText'

interface WhenFieldProps {
  label: string
  value: string
  onChange: (v: string, byHand: boolean) => void
}

/**
 * Date-time of a fill or stop move, always visible, with quick picks that move
 * the date and keep the time: 지금 · 어제 · 직전 거래일.
 */
export function WhenField({ label, value, onChange }: WhenFieldProps) {
  const now = localDateTimeValue()
  const today = now.slice(0, 10)
  const isToday = value.slice(0, 10) === today
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="when-row">
        <input className="input num" type="datetime-local" value={value} max={`${today}T23:59`} onChange={(e) => e.target.value && onChange(e.target.value, true)} aria-label={label} />
        <div className="when-chips" role="group" aria-label="빠른 선택">
          <button type="button" className="pill" aria-pressed={value === now} onClick={() => onChange(now, false)}>
            지금
          </button>
          <button type="button" className="pill" aria-pressed={!isToday && value.slice(0, 10) === shiftDays(now, -1).slice(0, 10)} onClick={() => onChange(withDate(value, shiftDays(now, -1).slice(0, 10)), true)}>
            어제
          </button>
          <button type="button" className="pill" aria-pressed={!isToday && value.slice(0, 10) === previousWeekday(now).slice(0, 10)} onClick={() => onChange(withDate(value, previousWeekday(now).slice(0, 10)), true)}>
            직전 거래일
          </button>
        </div>
      </div>
    </div>
  )
}
