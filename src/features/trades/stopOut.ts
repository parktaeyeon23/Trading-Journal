import { stopOutR as coreStopOutR } from '../../core/risk'
import type { TradeBundle } from '../../data/trades'

/** core.stopOutR for a loaded trade (list rows and the detail header). */
export function stopOutR(t: TradeBundle): number | null {
  const s = t.summary
  return coreStopOutR({
    direction: t.position.direction,
    realizedNet: s.pnl.realizedNet,
    openQty: s.pnl.openQty,
    avgCost: s.pnl.avgCost,
    currentStop: t.currentStop,
    oneR: s.oneR,
  })
}
