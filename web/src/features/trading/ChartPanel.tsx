import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, type ChartController } from '../../lib/chart/renderer'
import { attachGestures } from '../../lib/chart/gestures'
import { themeFromCss, withAlpha, withColorBlindPair } from '../../lib/chart/theme'
import {
  createCandleLayer, createCrosshairLayer, createDepthLayer, createGridLayer,
  createIndicatorLayer, createLastPriceLayer, createLegendLayer, createPositionLinesLayer,
  createPriceAxisLayer, createTimeAxisLayer, createVolumeLayer,
  type IndicatorSeries, type PriceLine,
} from '../../lib/chart/layers'
import type { ChartTheme, TimeUnit } from '../../lib/chart/types'
import type { Indicator } from '../../lib/trading/indicators'
import { liquidationPrice } from '../../lib/trading/broker/margin'
import { INDICATOR_DEFS, IND_CAP } from './overlays'
import { useCensor, useLang } from '../../prefs'
import { t } from '../../i18n'
import { barLengthMs } from './runtime'
import { clockTime, dayLabel, duration, precisionFromTick } from './fmt'
import type { TradingView } from './useTrading'

// The canvas host: one chart engine, one gesture disposer, one rAF.
//
// Three things about this component are load-bearing.
//
// 1. It reads the runtime inside its OWN rAF and subscribes to nothing. The
//    runtime notifies React at 8 Hz, which is right for a positions table and
//    visibly wrong for a price. The loop below watches `bars.rev` — bumped in
//    place by the tick loop — and only pokes the engine when it has actually
//    moved, so an idle chart costs almost nothing (§D.6).
// 2. Gestures wire to the ChartController, NOT to ChartEngine. The frozen
//    ChartEngine interface has no pan/zoom/crosshair setter at all; wiring to it
//    compiles and produces a chart that cannot be touched.
// 3. Everything overlaid on the plot — the SIM badge, the status pill, the
//    catch-up bar — is DOM positioned over the canvas rather than drawn. It is
//    prose, it needs translating, and text a screen reader cannot reach is not an
//    acceptable place to put the word "simulation".

/** §E: on a 390x844 phone the chart is at least 360px, or it reads as a widget
 *  rather than as the point of the screen. */
const MIN_CHART_H = 360
const CHART_VH = 0.44

interface Overlay {
  id: string
  ind: Indicator
  tone: 'accent' | 'muted'
  /** `bars.rev` this was last fed at, and the newest bar time it has seen. */
  fedRev: number
  fedT: number
}

export function ChartPanel({ view }: { view: TradingView }) {
  const { runtime, cfg } = view
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<ChartController | null>(null)
  const [censor] = useCensor()
  const [lang] = useLang()
  const [inspecting, setInspecting] = useState(false)

  // Everything the layers read at draw time. Layers outlive any one render, so
  // they are handed accessors into this ref rather than captured values — a
  // captured `view` would freeze the chart at the frame its layer was built on.
  const live = useRef({ runtime, view, lang, censor, theme: null as ChartTheme | null })
  live.current.runtime = runtime
  live.current.view = view
  live.current.lang = lang
  live.current.censor = censor

  const tickSize = useMemo(() => {
    const inst = runtime.market.instrument(cfg.symbol)
    return inst && 'tickSize' in inst ? inst.tickSize : 0.01
  }, [runtime, cfg.symbol])

  const reduced = useMemo(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  // ── Engine ─────────────────────────────────────────────────────────────────
  // Rebuilt when the instrument or timeframe changes, because tickSize, precision
  // and the bar length are baked into six layers. NOT rebuilt for theme, privacy
  // or language — those are pushed in, which is the difference between toggling
  // privacy and losing your zoom.
  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    const readTheme = (): ChartTheme => {
      const th = themeFromCss(host, live.current.censor, reduced)
      return live.current.view.cfg.colorBlind ? withColorBlindPair(th) : th
    }
    live.current.theme = readTheme()

    const engine = createChart(canvas, {
      theme: live.current.theme,
      tickSize,
      pricePrecision: precisionFromTick(tickSize),
      minSpan: 20,
      maxSpan: 800,
      // §E: always keep empty space right of the newest bar. A chart glued to its
      // right edge reads as amateur instantly, and this is one number.
      rightGapFrac: 0.12,
      volumeFrac: 0.16,
      priceAxisMinW: 56,
      timeAxisH: 26,
    })
    engineRef.current = engine

    // ── Indicators ───────────────────────────────────────────────────────────
    const overlays: Overlay[] = []

    /** Feed an indicator whatever is new, and nothing else.
     *
     *  Forward-only with `amend` for the forming bar: rebuilding the indicator
     *  each frame would restart its warm-up and draw the hook up from zero that
     *  gives away an unwarmed series, and re-pushing every bar would be O(3000)
     *  per overlay per frame. */
    function feed(o: Overlay, bars: typeof runtime.bars): void {
      if (o.fedRev === bars.rev) return
      o.fedRev = bars.rev
      const len = bars.length
      if (len === 0) {
        o.ind.reset()
        o.fedT = NaN
        return
      }
      const newest = bars.t[bars.at(len - 1)]
      if (!Number.isFinite(o.fedT)) {
        o.ind.reset()
        for (let i = 0; i < len; i++) o.ind.push(bars.c[bars.at(i)])
        o.fedT = newest
        return
      }
      if (newest === o.fedT) {
        o.ind.amend(bars.c[bars.at(len - 1)])
        return
      }
      let k = 0
      while (k < len && bars.t[bars.at(len - 1 - k)] > o.fedT) k++
      if (k >= len) {
        // The whole visible window turned over — a symbol switch, or a catch-up
        // longer than the ring. Cheaper and more correct to start again.
        o.ind.reset()
        for (let i = 0; i < len; i++) o.ind.push(bars.c[bars.at(i)])
      } else {
        // The bar we were amending has closed: fix its final value, then push
        // everything after it.
        o.ind.amend(bars.c[bars.at(len - 1 - k)])
        for (let j = k - 1; j >= 0; j--) o.ind.push(bars.c[bars.at(len - 1 - j)])
      }
      o.fedT = newest
    }

    const indicatorSeries = (): IndicatorSeries[] => {
      const want = live.current.view.cfg.indicators.filter((id) => id in INDICATOR_DEFS)
      for (let i = overlays.length - 1; i >= 0; i--) {
        if (!want.includes(overlays[i].id)) overlays.splice(i, 1)
      }
      for (const id of want) {
        if (overlays.some((o) => o.id === id)) continue
        const def = INDICATOR_DEFS[id]
        overlays.push({ id, ind: def.make(def.period, IND_CAP), tone: def.tone, fedRev: -1, fedT: NaN })
      }

      const bars = live.current.runtime.bars
      const th = live.current.theme
      const out: IndicatorSeries[] = []
      for (const o of overlays) {
        feed(o, bars)
        const ring = o.ind.out
        const count = o.ind.count
        const len = bars.length
        out.push({
          id: o.id,
          kind: 'line',
          // Straight from the resolved theme, so the app's own accent and the
          // colour-blind pair both reach the overlays. §E allows exactly two new
          // tokens; inventing an indicator palette is not one of them.
          color: o.tone === 'accent' ? (th?.accent ?? '#1abc9c') : withAlpha(th?.muted ?? '#9aa3ad', 0.8),
          width: 1.5,
          at: (i: number) => {
            // Bar `len-1` is sample `count`; walk back from there.
            const k = count - (len - 1 - i)
            if (k < 1 || k > count || count - k >= ring.length) return NaN
            return ring[(k - 1) % ring.length]
          },
        })
      }
      return out
    }

    /** Entry, liquidation and every resting order, as horizontal rules. This is
     *  what makes the chart belong to the account rather than to a data feed. */
    const priceLines = (): PriceLine[] => {
      const v = live.current.view
      const sym = v.cfg.symbol
      const lines: PriceLine[] = []
      const pos = v.account.positions[sym]
      if (pos && pos.qty !== 0) {
        lines.push({ price: pos.avgCost, label: t('Entry'), tone: 'entry', dashed: false })
        const liq = liquidationPrice(pos, v.account.settings)
        if (liq != null && liq > 0) lines.push({ price: liq, label: t('Liq.'), tone: 'liq', dashed: true })
      }
      for (const o of v.account.orders) {
        if (o.status !== 'open' || o.symbol !== sym) continue
        const p = o.limit ?? o.stop
        if (p == null) continue
        lines.push({ price: p, label: o.type === 'limit' ? t('Limit') : t('Stop'), tone: 'order', dashed: true })
      }
      return lines
    }

    engine.addLayer(createGridLayer({ tickSize }))
    // No options: volume owns its own pane now and the renderer decides its
    // height. `frac` survives as a documented no-op and passing it only suggests
    // this call site still has a say.
    engine.addLayer(createVolumeLayer())
    engine.addLayer(createIndicatorLayer({ specs: indicatorSeries }))
    engine.addLayer(createCandleLayer({ mode: cfg.chartType, tickSize }))
    engine.addLayer(createPositionLinesLayer({ lines: priceLines, tickSize }))
    engine.addLayer(createPriceAxisLayer({ tickSize }))
    engine.addLayer(createTimeAxisLayer({
      // §E's whole time-axis rule: a label crossing a day boundary is a date in
      // --ink, everything else a time in --muted. The layer picks the colour;
      // this only has to pick the words — in the app's language, Gregorian.
      format: (ms: number, _unit: TimeUnit, major: boolean) =>
        major ? dayLabel(ms, live.current.lang) : clockTime(ms, live.current.lang),
    }))
    engine.addLayer(createLastPriceLayer({ tickSize, countdown: true, barMs: barLengthMs(cfg.timeframe) }))
    engine.addLayer(createLegendLayer({ labels: { o: t('O'), h: t('H'), l: t('L'), c: t('C') }, tickSize }))
    engine.addLayer(createCrosshairLayer({
      formatTime: (ms: number) => `${dayLabel(ms, live.current.lang)} ${clockTime(ms, live.current.lang)}`,
      // §E: on touch the readout sits 44px above the finger, or the finger covers
      // the thing the gesture exists to reveal.
      touchOffsetY: 44,
      tickSize,
    }))

    engine.setData(live.current.runtime.bars)

    // ── Gestures ─────────────────────────────────────────────────────────────
    // On the CANVAS, and against the controller. `attachGestures` sets
    // touch-action and the callout suppression on the element itself, so nothing
    // in trading.css has to be kept in step with it.
    let pinching = false
    const detach = attachGestures(canvas, {
      onPan: (dx) => engine.panBy(dx),
      onPanEnd: (vx) => engine.endPan(vx),
      onPinchStart: (cx) => { pinching = true; engine.beginPinch(cx) },
      onPinch: (scale, cx) => { if (pinching) engine.pinchTo(scale, cx) },
      onPinchEnd: () => { pinching = false; engine.endPinch() },
      // A tap dismisses the crosshair rather than placing one: on touch it is
      // long-press to summon, and a tap that left a crosshair behind would make
      // the chart impossible to simply look at.
      onTap: () => { engine.setCrosshair(null); setInspecting(false) },
      onLongPress: (x, y) => { engine.setCrosshair(x, y); setInspecting(true) },
      onHoverMove: (x, y) => engine.setCrosshair(x, y),
      onHoverEnd: () => engine.setCrosshair(null),
      onWheel: (dy, x) => engine.zoomAt(dy < 0 ? 1.1 : 1 / 1.1, x),
    })

    // ── Sizing ───────────────────────────────────────────────────────────────
    // ResizeObserver on the container, never `window.innerHeight` (D.3): on iOS
    // that number changes as the URL bar slides, and the chart would resize
    // itself every time the page scrolled.
    const measure = () => {
      const r = host.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) engine.resize(r.width, r.height, window.devicePixelRatio || 1)
    }
    measure()
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(host)
    }

    // ── The demand-driven frame ──────────────────────────────────────────────
    let raf: number | null = null
    let seenRev = -1
    const frame = () => {
      const bars = live.current.runtime.bars
      if (bars.rev !== seenRev) {
        seenRev = bars.rev
        // setData both swaps the columns and invalidates; the engine's own loop
        // parks itself again as soon as nothing is dirty.
        engine.setData(bars)
      }
      raf = requestAnimationFrame(frame)
    }
    const startLoop = () => { if (raf === null) raf = requestAnimationFrame(frame) }
    const stopLoop = () => {
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
    }
    startLoop()
    // Zero work while hidden (§D.6).
    const onVisibility = () => { if (document.visibilityState === 'hidden') stopLoop(); else startLoop() }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stopLoop()
      ro?.disconnect()
      detach()
      engine.destroy()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, cfg.symbol, cfg.timeframe, tickSize, reduced])

  // Theme, privacy and the colour-blind pair are pushed in rather than rebuilt.
  useEffect(() => {
    const host = hostRef.current
    const engine = engineRef.current
    if (!host || !engine) return
    const th = themeFromCss(host, censor, reduced)
    const next = cfg.colorBlind ? withColorBlindPair(th) : th
    live.current.theme = next
    engine.setTheme(next)
  }, [censor, reduced, cfg.colorBlind])

  // The candle mode is a whole-layer swap. `addLayer` replaces by id, so this is
  // one line and the engine keeps its identity — and therefore the user's zoom.
  useEffect(() => {
    engineRef.current?.addLayer(createCandleLayer({ mode: cfg.chartType, tickSize }))
  }, [cfg.chartType, tickSize])

  // The depth spine is added and removed rather than told to draw nothing: a
  // layer that returns early still costs a call every frame.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !cfg.showDepth) return
    engine.addLayer(createDepthLayer({ book: () => live.current.runtime.book(live.current.view.cfg.symbol) }))
    return () => { engineRef.current?.removeLayer('depth') }
  }, [cfg.showDepth])

  const { catchUp, status } = view
  const height = Math.max(MIN_CHART_H, Math.round((typeof window !== 'undefined' ? window.innerHeight : 844) * CHART_VH))

  return (
    <div className="tr-chart-wrap" style={{ height }}>
      <div className="tr-chart-host" ref={hostRef}>
        <canvas ref={canvasRef} className="tr-canvas" />

        {/* No SIM badge here, deliberately — it lives in the page header. The plot
            has no free corner: the OHLC legend owns the top strip and the volume
            histogram owns the bottom 16%, so a badge in either place is painted
            over live data. See SimBadge.tsx. */}

        {catchUp.active && (
          <div className="tr-catchup" role="status">
            <div
              className="tr-catchup-bar"
              style={{ width: `${catchUp.total > 0 ? Math.min(100, (catchUp.done / catchUp.total) * 100) : 0}%` }}
            />
            <span className="tr-catchup-label">
              {t('Catching up · {time}', { time: duration(Math.max(0, catchUp.total - catchUp.done)) })}
            </span>
          </div>
        )}

        {/* An inline pill, never a modal: the chart keeps showing the last data it
            had, which is what every real client does when a feed hiccups. */}
        {!catchUp.active && (status === 'stalled' || status === 'error' || status === 'connecting') && (
          <div className="tr-feed-pill" role="status">
            <span className="tr-feed-dot" />
            {status === 'error' ? t('Reconnecting…') : status === 'stalled' ? t('Feed stalled') : t('Connecting…')}
          </div>
        )}

        {inspecting && <span className="tr-touch-hint">{t('Tap to clear')}</span>}
      </div>
    </div>
  )
}
