// The chart engine's contract root.
//
// FROZEN, and deliberately ignorant of trading: nothing in lib/chart/ imports
// anything from lib/trading/, and nothing in lib/trading/ imports from here.
// The two trees meet only structurally — a CandleSeries satisfies OhlcvColumns
// without either side naming the other — which is what lets the chart be built,
// tested and judged before the market engine exists.
//
// RenderCtx in particular must not grow after the workstreams start: it is the
// seam between whoever writes the renderer and whoever writes the layers.

/**
 * Columnar OHLCV. Float64Arrays rather than an array of candle objects, because
 * the renderer walks a few hundred bars every frame and boxed objects would put
 * that walk on the GC's critical path.
 *
 * `at(i)` maps a LOGICAL index (0 = oldest bar held) to the PHYSICAL index in
 * the ring buffer. Layers must never index the arrays directly.
 */
export interface OhlcvColumns {
  readonly length: number
  readonly t: Float64Array
  readonly o: Float64Array
  readonly h: Float64Array
  readonly l: Float64Array
  readonly c: Float64Array
  readonly v: Float64Array
  at(i: number): number
  /** Bumped on every mutation. The renderer's dirty check — cheaper and more
   *  reliable than diffing the arrays. */
  readonly rev: number
}

/** A rectangle in CSS pixels, relative to the canvas's top-left. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * What is on screen: `span` bars starting at logical index `i0`, and the price
 * band [p0, p1]. `i0` is fractional during a pan, and may run past the ends —
 * overscroll is a real state, not an error.
 */
export interface Viewport {
  i0: number
  span: number
  p0: number
  p1: number
}

export interface Scales {
  /** Centre of bar `i`, in CSS px, unsnapped. Use for hit-testing and lines. */
  xOf(i: number): number
  /**
   * Centre of bar `i`, snapped so that `cx * dpr` lands on a half device pixel.
   *
   * bodyW and wickW are both forced ODD in device pixels, so a centre on a
   * half-pixel puts both their edges exactly on device-pixel boundaries. That
   * pairing is the whole reason candles come out crisp instead of grey-edged.
   */
  cx(i: number): number
  /** Inverse of xOf. Fractional. */
  iOf(x: number): number
  yOf(p: number): number
  pOf(y: number): number
  /** Bar pitch: plot width / span. */
  readonly barW: number
  /** Candle body width — already device-pixel snapped, and forced odd in device
   *  pixels when narrow so the 1px wick centres exactly. */
  readonly bodyW: number
  readonly wickW: number
}

export type TimeUnit = 'sec' | 'min' | 'hour' | 'day' | 'month' | 'year'

/** `major` marks a boundary the axis should emphasise — a day change inside an
 *  intraday view, a month change inside a daily one. The renderer draws those in
 *  --ink and the rest in --muted, which is most of what makes a time axis
 *  readable at a glance. */
export interface TimeTick {
  t: number
  unit: TimeUnit
  major: boolean
}

/**
 * Every colour, font and flag the renderer needs, resolved ONCE from CSS custom
 * properties. No layer may call getComputedStyle — it forces style resolution,
 * and doing that per frame is the single easiest way to lose 60fps.
 */
export interface ChartTheme {
  bg: string
  grid: string
  gridMajor: string
  up: string
  down: string
  upFill: string
  downFill: string
  neutral: string
  ink: string
  muted: string
  axisBg: string
  axisBorder: string
  crosshair: string
  pillBg: string
  pillInk: string
  volumeUp: string
  volumeDown: string
  accent: string
  /** Must carry the app's body stack INCLUDING 'Noto Sans Thai' (theme.css:49),
   *  or Thai labels render through a fallback with wrong metrics. */
  font: string
  /** Tabular digits for EVERY number. Canvas ignores font-variant-numeric, so a
   *  proportional font makes a live price readout jitter as its digits change
   *  width — an instant tell that this isn't a real trading app. */
  fontMono: string
  axisFontPx: number
  labelFontPx: number
  legendFontPx: number
  /**
   * Privacy mode. `:root[data-censor='on'] .money` is CSS over DOM text and does
   * not reach a canvas, so every number drawn here has to mask itself.
   */
  censor: boolean
  reducedMotion: boolean
}

export interface InteractionState {
  /** null when the crosshair is not showing. `i` is the snapped bar index. */
  crosshair: { x: number; y: number; i: number; p: number } | null
  pressed: boolean
  /** -1..1, how far past the end the viewport is being dragged. */
  overscrollX: number
}

/**
 * Everything a layer is allowed to know, handed to it once per frame.
 *
 * Frozen: layers are written against this by a different workstream than the
 * renderer, so a field added later means work already done has to be revisited.
 */
export interface RenderCtx {
  readonly ctx: CanvasRenderingContext2D
  /**
   * The PRICE pane. Candles, grid, crosshair, legend and price lines all live
   * here, and `scales` maps prices into it.
   *
   * When volume has its own pane this rect is already shortened to make room, so
   * a layer that draws price geometry against `plot` stays correct without
   * knowing volume exists at all.
   */
  readonly plot: Rect
  /**
   * Volume's own pane, directly below `plot` and above the time axis, or null
   * when volume is off.
   *
   * Volume began as a translucent overlay inside the price pane — §E's original
   * call, made to save ~90px on a 390px phone. Four independent reviewers then
   * picked it out as the weakest thing on the chart: with no divider, no axis and
   * no baseline the bar heights read as texture rather than quantity, and price
   * wicks descending into the strip became genuinely ambiguous against bars of a
   * similar hue. Splitting the panes costs the height and settles all of it.
   */
  readonly volumePane: Rect | null
  readonly priceAxis: Rect
  readonly timeAxis: Rect
  readonly scales: Scales
  readonly data: OhlcvColumns
  /** First and last visible logical bar, already clipped to the data. */
  readonly i0: number
  readonly i1: number
  readonly dpr: number
  readonly theme: ChartTheme
  /** Milliseconds since the previous frame. Layers animate off THIS, never off
   *  Date.now() — otherwise a paused tab produces a wild first frame on resume. */
  readonly dt: number
  /** Simulation time of the newest data, for countdowns and time labels. */
  readonly now: number
  readonly interaction: InteractionState
  /** Snap a CSS-px coordinate to a device-pixel boundary. One unsnapped edge is
   *  the grey half-pixel halo that gives away a hobby chart. */
  snap(v: number): number
}

export interface ChartLayer {
  readonly id: string
  /**
   * Paint order. The gaps are intentional — an app-level layer can slot between
   * two built-ins without renumbering anything.
   *   grid 10 · volume 50 · indicators 80 · candles 100 · positionLines 200
   *   lastPrice 300 · axes 800 · crosshair 900 · overlay 1000
   */
  readonly z: number
  /** Must redraw every frame even when data and viewport are unchanged —
   *  anything animating on its own (crosshair, price flash, countdown). */
  readonly volatile: boolean
  /** Renders into the cached static bitmap rather than the live canvas. Only
   *  layers whose output depends purely on (data, viewport, theme) may say true. */
  readonly cacheable: boolean
  draw(c: RenderCtx): void
  dispose?(): void
}

export interface ChartOptions {
  theme: ChartTheme
  tickSize: number
  pricePrecision: number
  /** Tightest zoom, in bars. */
  minSpan: number
  /** Loosest zoom, in bars. */
  maxSpan: number
  /** Empty space kept to the right of the newest bar, as a fraction of span.
   *  A chart glued to its right edge reads as amateur instantly. */
  rightGapFrac: number
  /**
   * Share of the chart body given to the volume pane. 0 disables volume, and
   * `volumePane` is then null and the price pane takes the whole body.
   *
   * This used to be the height of an overlay inside the price pane; it is now a
   * real split. Keep it modest — the pane has to earn its pixels on a phone.
   */
  volumeFrac: number
  priceAxisMinW: number
  timeAxisH: number
}

export interface ChartEngine {
  readonly viewport: Readonly<Viewport>
  /** True while the chart is pinned to the newest bar. Any pan away clears it;
   *  panning back to the edge restores it. */
  readonly following: boolean
  readonly interaction: InteractionState
  setData(d: OhlcvColumns): void
  setTheme(t: ChartTheme): void
  addLayer(l: ChartLayer): void
  removeLayer(id: string): void
  setFollow(on: boolean): void
  setSpan(span: number, anchorI?: number): void
  /** Mark dirty and wake the render loop. The loop stops scheduling itself when
   *  nothing is dirty and nothing is animating, so this is how it restarts. */
  invalidate(): void
  resize(cssW: number, cssH: number, dpr: number): void
  /** Render one frame synchronously. This is how tests drive the engine —
   *  jsdom's requestAnimationFrame never usefully fires. */
  renderNow(nowMs?: number): void
  /** Idempotent: React 19 StrictMode mounts, unmounts and remounts, and a
   *  destroy that isn't safe to call twice leaves two rAF loops running. */
  destroy(): void
}

export const Z = {
  grid: 10,
  volume: 50,
  indicators: 80,
  candles: 100,
  positionLines: 200,
  lastPrice: 300,
  axes: 800,
  crosshair: 900,
  overlay: 1000,
} as const
