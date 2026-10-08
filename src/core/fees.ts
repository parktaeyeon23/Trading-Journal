/**
 * Default commission and tax for a fill, from rates in Settings (percent of
 * traded value). Users can always overwrite the result on the fill.
 */
export interface FeeRates {
  /** Commission %, both sides. */
  feePct: number | null
  /** Sell-side transaction tax %, KR only. */
  sellTaxPct: number | null
}

export function defaultFees(market: 'KR' | 'US', side: 'buy' | 'sell', price: number, qty: number, rates: FeeRates): { fee: number | null; tax: number | null } {
  const value = price * qty
  if (!(value > 0)) return { fee: null, tax: null }
  const round = (n: number) => (market === 'KR' ? Math.floor(n) : Math.round(n * 100) / 100)
  const fee = rates.feePct ? round((value * rates.feePct) / 100) : null
  const tax = market === 'KR' && side === 'sell' && rates.sellTaxPct ? round((value * rates.sellTaxPct) / 100) : null
  return { fee, tax }
}
