// Viewport algebra for the Money Flow chart: pixels ↔ dates, and the pan/zoom
// transforms applied to the x-window. Pure and DOM-free, so the gesture handling
// in useFlowInteraction stays a thin shell over tested arithmetic.
//
// Pixel mapping is derived from the figure's own `layout.margin` rather than a
// re-declared copy of it (the left margin flips 10↔44 with censor mode), so the
// two can never drift out of step.

const MS_PER_DAY = 86_400_000

/** The drawn plot area, in element-relative pixels. */
export interface PlotBox {
  left: number
  width: number
  top: number
  height: number
}

export interface PlotMargin { t: number; b: number; l: number; r: number }

export function plotBox(elW: number, figH: number, m: PlotMargin): PlotBox {
  return {
    left: m.l,
    width: Math.max(0, elW - m.l - m.r),
    top: m.t,
    height: Math.max(0, figH - m.t - m.b),
  }
}

/** Element-relative pixel → ms epoch. */
export function xFromPx(px: number, x0: number, x1: number, box: PlotBox): number {
  if (box.width <= 0) return x0
  return x0 + ((px - box.left) / box.width) * (x1 - x0)
}

/** ms epoch → element-relative pixel. */
export function pxFromX(ms: number, x0: number, x1: number, box: PlotBox): number {
  const span = x1 - x0
  if (span === 0) return box.left
  return box.left + ((ms - x0) / span) * box.width
}

export interface FlowView { x0: number; x1: number }

/** A week is as far in as the daily bars stay meaningful. */
export const FLOW_MIN_SPAN_MS = 7 * MS_PER_DAY

/** How far out zoom is allowed: the whole ledger plus a fifth, but never less
 *  than the opening window (a two-week ledger must still zoom out to its default). */
export function flowMaxSpan(bounds: { min: number; max: number }, floorMs: number): number {
  return Math.max((bounds.max - bounds.min) * 1.2, floorMs)
}

/** Drag the content: a finger moving right reveals earlier dates. */
export function panView(v: FlowView, dxPx: number, box: PlotBox): FlowView {
  if (box.width <= 0) return v
  const shift = -dxPx * ((v.x1 - v.x0) / box.width)
  return { x0: v.x0 + shift, x1: v.x1 + shift }
}

/** Zoom anchored at `atPx`: the date under the cursor stays under the cursor. */
export function zoomView(
  v: FlowView, factor: number, atPx: number, box: PlotBox, minSpan: number, maxSpan: number,
): FlowView {
  const span = v.x1 - v.x0
  if (!(factor > 0) || span <= 0) return v
  const next = Math.min(Math.max(span / factor, minSpan), Math.max(minSpan, maxSpan))
  if (next === span) return v
  const anchor = xFromPx(atPx, v.x0, v.x1, box)
  const x0 = anchor - (anchor - v.x0) * (next / span)
  return { x0, x1: x0 + next }
}

/** Keep the window over the data, with half a window of slack each side so the
 *  edges can be inspected without the last bar pinned against the axis. */
export function clampView(v: FlowView, bounds: { min: number; max: number }): FlowView {
  const span = v.x1 - v.x0
  // Zoomed out past the whole ledger there is nothing further to reveal, so the
  // window centres on the data rather than being allowed to slide until every
  // bar is bunched against one edge. Note this has to be tested directly: the
  // slack below scales WITH the span, so the clamp range never collapses on its
  // own however far out you zoom.
  if (span >= bounds.max - bounds.min) {
    const mid = (bounds.min + bounds.max) / 2
    return { x0: mid - span / 2, x1: mid + span / 2 }
  }
  const slack = span / 2
  const x0 = Math.min(Math.max(v.x0, bounds.min - slack), bounds.max + slack - span)
  return { x0, x1: x0 + span }
}
