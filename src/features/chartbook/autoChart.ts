/**
 * Draws an automatic chartbook picture with TradingView Lightweight Charts and
 * returns it as a PNG. Loaded only when the user asks for automatic charts.
 *
 * Daily: candles, volume, 10 SMA · 21 EMA · 200 SMA, fills, original stop and stop moves.
 * Intraday (entry day): 5-minute candles, volume, session VWAP, fills, original stop.
 */
import type { ChartBar } from '../../data/backend'
import { zoneOffsetSec, type CalMarket } from '../../core/calendar'
import { ema, sessionVwap, sma, type FillMark } from '../../core/chartData'

export interface ChartPicture {
  kind: 'daily' | 'intraday'
  title: string
  subtitle: string
  bars: ChartBar[]
  /** Intraday times are shown in this market's exchange time (daylight saving per bar). */
  market: CalMarket
  showFrom: string
  showTo: string
  marks: FillMark[]
  originalStop: number | null
  /** Stop moves in force from a date (daily charts). */
  stopSteps: { date: string; stop: number }[]
  precision: number
}

const W = 1600
const H = 900
const HEADER = 84
const FOOTER = 34

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export async function renderChartPng(p: ChartPicture): Promise<Blob> {
  const lw = await import('lightweight-charts')
  const c = {
    text: token('--text'),
    faint: token('--text-secondary'),
    grid: token('--divider'),
    border: token('--border'),
    surface: token('--surface'),
    up: token('--profit'),
    down: token('--loss'),
    ma10: token('--ma-10'),
    ma21: token('--ma-21'),
    ma200: token('--ma-200'),
    vwap: token('--vwap'),
    font: token('--font-sans') || 'sans-serif',
  }

  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H - HEADER - FOOTER}px;`
  document.body.appendChild(host)
  try {
    const chart = lw.createChart(host, {
      width: W,
      height: H - HEADER - FOOTER,
      layout: { background: { type: lw.ColorType.Solid, color: c.surface }, textColor: c.faint, fontFamily: c.font, fontSize: 18, attributionLogo: true },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.06, bottom: 0.24 } },
      timeScale: { borderColor: c.border, timeVisible: p.kind === 'intraday', secondsVisible: false, rightOffset: 2 },
      localization: { locale: 'ko-KR', priceFormatter: (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: p.precision, maximumFractionDigits: p.precision }) },
      crosshair: { mode: lw.CrosshairMode.Hidden },
      handleScroll: false,
      handleScale: false,
    })

    // Daily bars are keyed by date; intraday by exchange-local seconds so the axis reads exchange time.
    // The offset is taken per bar: Yahoo's gmtoffset is today's, which is an hour off for a US day on the other side of daylight saving.
    const local = (sec: number) => sec + zoneOffsetSec(sec, p.market)
    const timeOf = (b: ChartBar) => (p.kind === 'daily' ? b.date : (local(b.t) as number))
    const markTime = (m: FillMark) => (p.kind === 'daily' ? (m.at as string) : (local(m.at as number) as number))
    type T = Parameters<typeof candles.setData>[0][number]['time']

    const fmt = { type: 'price' as const, precision: p.precision, minMove: 1 / 10 ** p.precision }
    const candles = chart.addSeries(lw.CandlestickSeries, {
      upColor: c.up,
      downColor: c.down,
      borderUpColor: c.up,
      borderDownColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
      priceFormat: fmt,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    candles.setData(p.bars.map((b) => ({ time: timeOf(b) as T, open: b.open, high: b.high, low: b.low, close: b.close })))

    const volume = chart.addSeries(lw.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    volume.setData(
      p.bars.map((b) => ({ time: timeOf(b) as T, value: b.volume ?? 0, color: (b.close >= b.open ? c.up : c.down) + '55' })),
    )

    const line = (values: (number | null)[], color: string, width: 1 | 2 | 3 = 2) => {
      const s = chart.addSeries(lw.LineSeries, { color, lineWidth: width, priceFormat: fmt, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
      s.setData(p.bars.flatMap((b, i) => (values[i] === null ? [] : [{ time: timeOf(b) as T, value: values[i] as number }])))
    }
    const closes = p.bars.map((b) => b.close)
    const legend: { label: string; color: string }[] = []
    if (p.kind === 'daily') {
      line(sma(closes, 10), c.ma10)
      line(ema(closes, 21), c.ma21)
      line(sma(closes, 200), c.ma200, 3)
      legend.push({ label: '10 SMA', color: c.ma10 }, { label: '21 EMA', color: c.ma21 }, { label: '200 SMA', color: c.ma200 })
    } else {
      line(sessionVwap(p.bars), c.vwap, 3)
      legend.push({ label: 'VWAP', color: c.vwap })
    }

    if (p.originalStop) {
      candles.createPriceLine({ price: p.originalStop, color: c.faint, lineWidth: 2, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: true, title: '원 손절' })
      legend.push({ label: '원 손절', color: c.faint })
    }
    if (p.kind === 'daily' && p.stopSteps.length) {
      // Stop in force from each move to the end of the shown window.
      const steps = [...p.stopSteps].sort((a, b) => (a.date < b.date ? -1 : 1))
      const stopLine = chart.addSeries(lw.LineSeries, { color: c.faint, lineWidth: 2, lineStyle: lw.LineStyle.Dotted, lineType: lw.LineType.WithSteps, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: fmt })
      const pts: { time: T; value: number }[] = []
      for (const b of p.bars) {
        if (b.date < steps[0].date) continue
        const cur = steps.filter((s) => s.date <= b.date).at(-1)
        if (cur) pts.push({ time: b.date as T, value: cur.stop })
      }
      stopLine.setData(pts)
      legend.push({ label: '손절 이동', color: c.faint })
    }

    // A marker needs a bar at its time (a fill on a day without a bar is left off).
    const keys = new Set(p.bars.map((b) => timeOf(b)))
    // Daily labels stay short (entries a day apart would overlap); intraday adds the price.
    const label = (m: FillMark) => {
      const head = m.isEntry && m.stage ? `${m.stage}차` : m.side === 'buy' ? '매수' : '매도'
      return p.kind === 'daily' ? head : `${head} ${m.price.toLocaleString('en-US', { maximumFractionDigits: p.precision })}`
    }
    lw.createSeriesMarkers(
      candles,
      p.marks
        .filter((m) => keys.has(markTime(m)))
        .map((m) => ({
          time: markTime(m) as T,
          position: m.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
          shape: m.side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
          color: m.side === 'buy' ? c.up : c.down,
          text: label(m),
          size: 2,
        }))
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)),
    )

    if (p.kind === 'daily') chart.timeScale().setVisibleRange({ from: p.showFrom as T, to: p.showTo as T })
    else chart.timeScale().fitContent()

    // Let the library paint before taking the picture.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const shot = chart.takeScreenshot()
    chart.remove()

    // Header (title, legend) and footer around the chart.
    const scale = shot.width / W
    const out = document.createElement('canvas')
    out.width = shot.width
    out.height = Math.round(H * scale)
    const g = out.getContext('2d')!
    g.scale(scale, scale)
    g.fillStyle = c.surface
    g.fillRect(0, 0, W, H)
    g.fillStyle = c.text
    g.font = `700 30px ${c.font}`
    g.textBaseline = 'top'
    g.fillText(p.title, 24, 18)
    g.fillStyle = c.faint
    g.font = `400 20px ${c.font}`
    g.fillText(p.subtitle, 24, 54)
    let x = W - 24
    g.textAlign = 'right'
    for (const l of [...legend].reverse()) {
      g.fillStyle = c.text
      g.fillText(l.label, x, 30)
      x -= g.measureText(l.label).width + 10
      g.fillStyle = l.color
      g.fillRect(x - 22, 40, 22, 4)
      x -= 40
    }
    g.textAlign = 'left'
    g.drawImage(shot, 0, HEADER, W, H - HEADER - FOOTER)
    g.fillStyle = c.faint
    g.font = `400 16px ${c.font}`
    g.fillText('ALPHA JOURNAL 자동 생성 · Yahoo Finance 시세 · TradingView Lightweight Charts™', 24, H - FOOTER + 8)
    return await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('차트 이미지를 만들지 못했습니다.'))), 'image/png'))
  } finally {
    host.remove()
  }
}
