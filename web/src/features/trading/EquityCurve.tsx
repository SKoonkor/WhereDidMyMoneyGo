import { useEffect, useRef } from 'react'
import { themeFromCss } from '../../lib/chart/theme'
import { formatPriceForCanvas } from '../../lib/chart/format'
import { drawdown, principalSeries } from '../../lib/trading/broker/analytics'
import type { EquityPoint } from '../../lib/trading/broker/analytics'
import type { Trade } from '../../lib/trading/broker/types'
import { useCensor } from '../../prefs'
import { t } from '../../i18n'
import { money, pct } from './fmt'

// Equity over time, with the capital line under it.
//
// A hand-drawn canvas rather than the candle engine: `createChart` is built around
// OHLCV columns, a price axis and a viewport you can fling, and none of that
// applies to a curve nobody pans. What IS reused is the part that matters for
// consistency — `themeFromCss` for every colour and `formatPriceForCanvas` for
// every number, so this curve masks itself in privacy mode exactly like the chart
// does. CSS cannot reach into a bitmap, and a curve that kept showing real figures
// while the rest of the app went to bullets would be the one hole in the feature.
//
// The dashed capital line is the whole point of the picture. Equity alone cannot
// distinguish "I made money" from "I deposited money"; the gap between the two
// lines is the only honest answer.

const H = 132
const PAD_T = 10
const PAD_B = 18

export function EquityCurve({
  curve,
  trades,
  startCash,
  currency,
}: {
  curve: readonly EquityPoint[]
  trades: readonly Trade[]
  startCash: number
  currency: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [censor] = useCensor()

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return
    // jsdom returns null here without the native canvas package, which this repo
    // deliberately does not install — guard exactly as Plot.tsx does.
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const rect = host.getBoundingClientRect()
      const w = Math.max(1, rect.width)
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(H * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, H)

      const theme = themeFromCss(host, censor, false)
      const pts = curve
      if (pts.length < 2) {
        ctx.fillStyle = theme.muted
        ctx.font = `500 12px ${theme.font}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(t('The curve starts with your first trade.'), w / 2, H / 2)
        return
      }

      const principal = principalSeries([...pts], [...trades], startCash)
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].v < lo) lo = pts[i].v
        if (pts[i].v > hi) hi = pts[i].v
        if (principal[i] < lo) lo = principal[i]
        if (principal[i] > hi) hi = principal[i]
      }
      // A flat curve has no range to scale to; give it one so the line lands in
      // the middle instead of on an edge.
      if (!(hi > lo)) { hi = lo + Math.max(1, Math.abs(lo) * 0.01); lo -= Math.max(1, Math.abs(lo) * 0.01) }

      const t0 = pts[0].t
      const t1 = pts[pts.length - 1].t
      const span = Math.max(1, t1 - t0)
      const plotH = H - PAD_T - PAD_B
      const x = (i: number) => ((pts[i].t - t0) / span) * w
      const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * plotH

      // Area under equity, then the line on top of it. 14% alpha: enough to give
      // the line a body, not enough to compete with it.
      ctx.beginPath()
      ctx.moveTo(x(0), y(pts[0].v))
      for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(pts[i].v))
      ctx.lineTo(x(pts.length - 1), H - PAD_B)
      ctx.lineTo(x(0), H - PAD_B)
      ctx.closePath()
      ctx.globalAlpha = 0.14
      ctx.fillStyle = theme.accent
      ctx.fill()
      ctx.globalAlpha = 1

      ctx.beginPath()
      ctx.moveTo(x(0), y(pts[0].v))
      for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(pts[i].v))
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 1.75
      ctx.lineJoin = 'round'
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(x(0), y(principal[0]))
      for (let i = 1; i < principal.length; i++) ctx.lineTo(x(i), y(principal[i]))
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = theme.muted
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])

      // High and low, at 10px/600 in --muted like every other micro-label in the
      // feature. Through the censor-aware formatter, and at ONE precision so the
      // two never disagree by a decimal place.
      ctx.font = `600 10px ${theme.fontMono}`
      ctx.fillStyle = theme.muted
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      ctx.fillText(formatPriceForCanvas(hi, 0, censor), 2, 2)
      ctx.textBaseline = 'bottom'
      ctx.fillText(formatPriceForCanvas(lo, 0, censor), 2, H - 2)
    }

    draw()
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(draw)
      ro.observe(host)
    }
    return () => ro?.disconnect()
  }, [curve, trades, startCash, censor])

  const dd = drawdown([...curve])
  const last = curve.length ? curve[curve.length - 1].v : startCash

  return (
    <div className="tr-equity">
      <div className="tr-equity-head">
        <span className="tr-label">{t('Equity')}</span>
        <span className="tr-num money">{money(last)} {currency}</span>
      </div>
      <div className="tr-equity-canvas" ref={hostRef} style={{ height: H }}>
        <canvas ref={canvasRef} role="img" aria-label={t('Equity over time')} />
      </div>
      {dd.maxDd > 0 && (
        <div className="tr-equity-foot">
          <span className="tr-label">{t('Largest drawdown')}</span>
          <span className="tr-num money is-down">
            {money(-dd.maxDd)} {currency} ({pct(-dd.maxDdPct)})
          </span>
        </div>
      )}
    </div>
  )
}
