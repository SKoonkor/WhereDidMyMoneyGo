// A recording stand-in for CanvasRenderingContext2D.
//
// jsdom's `canvas.getContext('2d')` returns null, and the real fix — node-canvas
// — is a native build we are not adding to a static web app's toolchain. So the
// renderer is tested against this instead, by asserting on the ops it emitted.
//
// That turns out to be BETTER than pixel diffing, because the ops log can assert
// things a screenshot cannot: that the candle pass issued exactly two fill()
// calls, that no fillStyle was assigned inside the bar loop, that every rect
// edge landed on a device-pixel boundary. Those are the actual performance and
// crispness rules, checked directly rather than inferred.

// Every op name gets its OWN union member, even where several share a payload.
// Collapsing them (`{ op: 'rect' | 'fillRect'; a: number[] }`) reads more nicely
// and quietly breaks every caller: `Extract<Op, { op: 'rect' }>` resolves to
// `never`, because a member whose `op` is a four-way union does not extend
// `{ op: 'rect' }`. Tests then get `never[]` back from `of('rect')` and fail to
// compile on property access.
type RectOp<K extends string> = { op: K; a: number[] }
type PointOp<K extends string> = { op: K; x: number; y: number }
type TextOp<K extends string> = { op: K; text: string; x: number; y: number }
type BareOp<K extends string> = { op: K }

export type Op =
  | RectOp<'fillRect'>
  | RectOp<'strokeRect'>
  | RectOp<'clearRect'>
  | RectOp<'rect'>
  | RectOp<'roundRect'>
  | RectOp<'arc'>
  | RectOp<'setTransform'>
  | RectOp<'transform'>
  | RectOp<'drawImage'>
  | TextOp<'fillText'>
  | TextOp<'strokeText'>
  | PointOp<'moveTo'>
  | PointOp<'lineTo'>
  | BareOp<'beginPath'>
  | BareOp<'fill'>
  | BareOp<'stroke'>
  | BareOp<'save'>
  | BareOp<'restore'>
  | BareOp<'closePath'>
  | BareOp<'clip'>
  | { op: 'set'; prop: string; value: unknown }
  | { op: 'setLineDash'; dash: number[] }
  | { op: 'measureText'; text: string }

/** Characters are ~6.2px wide at the sizes this chart uses. Not accurate, but
 *  stable — and layout tests only need the widths to be consistent. */
export const FAKE_CHAR_W = 6.2

export interface FakeCtx {
  ctx: CanvasRenderingContext2D
  ops: Op[]
  reset(): void
  /** Ops of one kind, in order — the usual way a test reads the log. */
  of<K extends Op['op']>(kind: K): Extract<Op, { op: K }>[]
  /** Every value assigned to a property, in order. */
  values(prop: string): unknown[]
}

const TRACKED_PROPS = [
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'font',
  'globalAlpha',
  'textAlign',
  'textBaseline',
  'lineCap',
  'lineJoin',
  'shadowBlur',
  'shadowColor',
  'imageSmoothingEnabled',
]

export function createFakeCtx(): FakeCtx {
  const ops: Op[] = []
  const store: Record<string, unknown> = {}

  const rec = (o: Op) => {
    ops.push(o)
  }

  const base: Record<string, unknown> = {
    beginPath: () => rec({ op: 'beginPath' }),
    closePath: () => rec({ op: 'closePath' }),
    fill: () => rec({ op: 'fill' }),
    stroke: () => rec({ op: 'stroke' }),
    save: () => rec({ op: 'save' }),
    restore: () => rec({ op: 'restore' }),
    clip: () => rec({ op: 'clip' }),
    rect: (x: number, y: number, w: number, h: number) => rec({ op: 'rect', a: [x, y, w, h] }),
    fillRect: (x: number, y: number, w: number, h: number) => rec({ op: 'fillRect', a: [x, y, w, h] }),
    strokeRect: (x: number, y: number, w: number, h: number) => rec({ op: 'strokeRect', a: [x, y, w, h] }),
    clearRect: (x: number, y: number, w: number, h: number) => rec({ op: 'clearRect', a: [x, y, w, h] }),
    roundRect: (x: number, y: number, w: number, h: number, r: number) =>
      rec({ op: 'roundRect', a: [x, y, w, h, r] }),
    arc: (x: number, y: number, r: number, a0: number, a1: number) =>
      rec({ op: 'arc', a: [x, y, r, a0, a1] }),
    moveTo: (x: number, y: number) => rec({ op: 'moveTo', x, y }),
    lineTo: (x: number, y: number) => rec({ op: 'lineTo', x, y }),
    fillText: (text: string, x: number, y: number) => rec({ op: 'fillText', text, x, y }),
    strokeText: (text: string, x: number, y: number) => rec({ op: 'strokeText', text, x, y }),
    setLineDash: (dash: number[]) => rec({ op: 'setLineDash', dash: [...dash] }),
    getLineDash: () => [],
    setTransform: (...a: number[]) => rec({ op: 'setTransform', a }),
    transform: (...a: number[]) => rec({ op: 'transform', a }),
    translate: () => {},
    scale: () => {},
    drawImage: (_img: unknown, ...a: number[]) => rec({ op: 'drawImage', a }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: (text: string) => {
      rec({ op: 'measureText', text })
      return { width: text.length * FAKE_CHAR_W } as TextMetrics
    },
  }

  const ctx = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      return store[prop]
    },
    set(_target, prop: string, value) {
      store[prop] = value
      if (TRACKED_PROPS.includes(prop)) rec({ op: 'set', prop, value })
      return true
    },
  }) as unknown as CanvasRenderingContext2D

  return {
    ctx,
    ops,
    reset() {
      ops.length = 0
    },
    of<K extends Op['op']>(kind: K) {
      return ops.filter((o) => o.op === kind) as Extract<Op, { op: K }>[]
    },
    values(prop: string) {
      return ops.filter((o): o is Extract<Op, { op: 'set' }> => o.op === 'set' && o.prop === prop).map((o) => o.value)
    },
  }
}

/**
 * Give a jsdom <canvas> a working getContext so createChart() can be exercised
 * end to end without node-canvas.
 */
export function stubCanvas(el: HTMLCanvasElement): FakeCtx {
  const fake = createFakeCtx()
  Object.defineProperty(el, 'getContext', {
    configurable: true,
    value: (kind: string) => (kind === '2d' ? fake.ctx : null),
  })
  return fake
}

/**
 * Assert every rect edge sits on a device-pixel boundary.
 *
 * Returns the offenders rather than throwing, so a test can report which rect
 * and by how much — "some rect is blurry" is not a useful failure message.
 */
export function unsnappedRects(ops: Op[], dpr: number, tol = 1e-6): number[][] {
  const bad: number[][] = []
  for (const o of ops) {
    if (o.op !== 'rect' && o.op !== 'fillRect') continue
    const [x, y, w, h] = o.a
    for (const v of [x, y, x + w, y + h]) {
      const dev = v * dpr
      if (Math.abs(dev - Math.round(dev)) > tol) {
        bad.push(o.a)
        break
      }
    }
  }
  return bad
}
