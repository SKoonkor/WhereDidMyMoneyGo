// Motion. The part of the chart that decides whether it feels bought or built.
//
// Three pieces, and each one exists because the naive version has a specific,
// recognisable failure:
//
//   fling       A per-frame `v *= friction` loses distance on a dropped frame, so
//               the same flick travels differently on a busy phone than on an
//               idle one. Deceleration here is integrated ANALYTICALLY from the
//               accumulated time, so the trajectory is a function of elapsed
//               seconds and nothing else.
//   rubber band A hard stop at the edge feels like a bug. Apple's saturating
//               curve is what every iOS scroll view does, and the eye recognises
//               it without being able to name it.
//   spring      A per-frame `x += (target - x) * 0.2` is frame-rate dependent and
//               visibly different at 60 vs 120Hz. Semi-implicit Euler at a fixed
//               substep is not.
//
// Every constant below is pinned by docs/trading-architecture.md §C.2. Where a
// number here disagrees with a settle time quoted in that section, the constant
// wins and the disagreement is noted at the call site — see createSpring.

/** Fixed integration substep, 1/240s. Small enough that the springs used here are
 *  numerically indistinguishable from their closed form, large enough that a
 *  16.6ms frame costs four iterations. */
const SUBSTEP = 1 / 240

/** A 33ms stall must not be paid back as 8 frames of catch-up motion in one go —
 *  that reads as a jump. Past this the leftover time is dropped. */
const MAX_SUBSTEPS = 8

export interface KineticConfig {
  /** `v *= friction^(dt/1000)`. 0.135/s is iOS UIScrollViewDecelerationRateNormal
   *  (0.998 per ms) — the deceleration curve every phone user has calibrated on. */
  friction: number
  /** Below this the fling is over, in value-units per second. */
  minVelocity: number
  /** Apple's rubber-band constant. */
  rubber: number
  springK: number
  springZeta: number
  /**
   * Characteristic dimension of the rubber band — the distance over which it
   * saturates. Not in the §C.2 sketch, but `rubberBand` cannot be evaluated
   * without it: for a horizontal pan it is the plot width, and for a pan
   * expressed in bar indices it is the span. Mutable on the Kinetic so a resize
   * can update it without rebuilding the object.
   */
  dim: number
}

export const DEFAULT_KINETIC: Readonly<KineticConfig> = Object.freeze({
  friction: 0.135,
  minVelocity: 12,
  rubber: 0.55,
  springK: 220,
  springZeta: 1,
  dim: 320,
})

/**
 * Apple's overscroll curve: `sign(d)·(1 − 1/(|d|·c/dim + 1))·dim/c`.
 *
 * Monotone and saturating — the first pixel of drag moves the content almost
 * one-for-one, and by a full `dim` of pull it has only given up `0.645·dim`. The
 * saturation is the whole point: it tells the finger there is nothing more to
 * see without ever refusing to move.
 */
export function rubberBand(d: number, dim: number, c = DEFAULT_KINETIC.rubber): number {
  // A zero dimension would divide by zero and paint NaN across the viewport.
  if (!(dim > 0) || !(c > 0) || d === 0 || !Number.isFinite(d)) return 0
  const a = Math.abs(d)
  return Math.sign(d) * (1 - 1 / ((a * c) / dim + 1)) * (dim / c)
}

export interface Spring {
  value: number
  velocity: number
  target: number
  /**
   * Distance at which the spring is declared finished and snapped to target.
   * Mutable because the price-axis springs work in PRICE units: 0.5 is a
   * sensible pixel epsilon and a nonsense one for an instrument quoted in
   * satang, so the renderer rescales it as the range changes.
   */
  epsilon: number
  /** Advance by real elapsed time. Returns true while still moving. */
  update(dtMs: number): boolean
  /** Jump to a value with no motion — what `prefers-reduced-motion` uses. */
  snap(v: number): void
}

/**
 * A damped spring integrated by semi-implicit Euler.
 *
 * `k` is ω², so ω = √k and the critical damping coefficient is 2ζ√k. At the two
 * constants this chart uses:
 *
 *   k = 220 → ω = 14.83 rad/s   overscroll spring-back
 *   k = 90  → ω = 9.49 rad/s    price-axis autoscale, deliberately softer
 *
 * A note on settle times, because §C.2 quotes two that do not follow from these
 * constants. For a critically damped release from rest, `x(t) = x₀(1+ωt)e^(−ωt)`.
 * From 100px that is ~6px remaining at 300ms (k=220) and at 470ms (k=90) — the
 * two times §C.2 gives, and they are consistent with each other, so those are the
 * numbers that were measured. Reaching 0.5px takes ~500ms and ~790ms
 * respectively. The constants are pinned by §C.2 and the derived times are not,
 * so the constants are what this implements.
 */
export function createSpring(k: number, zeta = 1, epsilon = 0.5): Spring {
  const omega = Math.sqrt(Math.max(1e-9, k))
  const c = 2 * zeta * omega
  // Fractional leftover time, carried between frames so that a run of 16.6ms
  // frames advances by exactly 16.6ms each and not by 16.0.
  let acc = 0

  const atRest = (s: Spring) =>
    Math.abs(s.value - s.target) <= s.epsilon && Math.abs(s.velocity) <= s.epsilon * omega

  const s: Spring = {
    value: 0,
    velocity: 0,
    target: 0,
    epsilon,
    update(dtMs: number): boolean {
      if (atRest(s)) {
        // Snap rather than creep. A spring left a third of a pixel short holds
        // the render loop awake forever for something nobody can see.
        s.value = s.target
        s.velocity = 0
        acc = 0
        return false
      }
      acc += Math.max(0, dtMs) / 1000
      // The epsilon is not slop, it is the difference between 60Hz and 120Hz
      // producing the same motion and not. A 60Hz frame is 4 substeps exactly,
      // but 16.666666666666668/1000 divided by 1/240 comes out as
      // 3.9999999999999996 in doubles, so a bare floor() runs 3 substeps and
      // banks the rest — the spring then alternates 3/4/4/4 substeps per frame
      // and lands up to one substep out of phase with the same spring driven at
      // 120Hz. One substep of phase is ~2px at this spring's peak speed, which
      // is a visibly different animation on a 120Hz phone.
      let n = Math.floor(acc / SUBSTEP + 1e-9)
      if (n > MAX_SUBSTEPS) {
        n = MAX_SUBSTEPS
        acc = 0
      } else {
        acc -= n * SUBSTEP
      }
      for (let i = 0; i < n; i++) {
        const a = -k * (s.value - s.target) - c * s.velocity
        s.velocity += a * SUBSTEP
        s.value += s.velocity * SUBSTEP
      }
      if (atRest(s)) {
        s.value = s.target
        s.velocity = 0
        acc = 0
        return false
      }
      return true
    },
    snap(v: number) {
      s.value = v
      s.target = v
      s.velocity = 0
      acc = 0
    },
  }
  return s
}

export type KineticMode = 'idle' | 'drag' | 'fling' | 'spring'

export interface Kinetic {
  /** What to render: `raw` projected through the rubber band. */
  value: number
  velocity: number
  /** See KineticConfig.dim. Settable so a resize does not need a new object. */
  dim: number
  readonly mode: KineticMode
  beginDrag(): void
  /** Move by `delta` in value units. Past a bound the movement is rubber-banded. */
  drag(delta: number, min: number, max: number): void
  /** Release. Out of bounds springs back; in bounds and fast enough flings. */
  endDrag(velocity: number, min: number, max: number): void
  /** Advance by real elapsed time. Returns true while still animating. */
  update(dtMs: number, min: number, max: number): boolean
  /** Halt, and adopt whatever `value` currently holds as the true position —
   *  which is how the renderer hands control back after pinning to the newest
   *  bar without the next drag snapping back to a stale coordinate. */
  stop(): void
}

/**
 * Pan, fling and overscroll for one axis.
 *
 * Two coordinates, and keeping them apart is what makes the whole thing simple:
 * `raw` is where the finger (or the fling) has actually put the content, with no
 * limits at all, and `value` is `raw` seen through the rubber band. Fling and
 * spring physics run on `raw`, so neither of them has to know the band exists.
 */
export function createKinetic(cfg?: Partial<KineticConfig>): Kinetic {
  const c: KineticConfig = { ...DEFAULT_KINETIC, ...cfg }
  const lnF = Math.log(c.friction) // −2.0025 at 0.135
  const spring = createSpring(c.springK, c.springZeta, 1e-4)

  let mode: KineticMode = 'idle'
  let raw = 0
  // Fling state: the closed form is evaluated from these every frame, never
  // stepped, so a frame that arrives late or not at all changes nothing.
  let v0 = 0
  let x0 = 0
  let elapsed = 0
  let tStop = 0

  const project = (r: number, min: number, max: number): number => {
    const hi = Math.max(min, max)
    if (r > hi) return hi + rubberBand(r - hi, k.dim, c.rubber)
    if (r < min) return min + rubberBand(r - min, k.dim, c.rubber)
    return r
  }

  const toSpring = (target: number, velocity: number) => {
    mode = 'spring'
    spring.value = raw
    spring.velocity = velocity
    spring.target = target
    // In value units, not pixels: a bar-index pan needs a far finer epsilon than
    // a pixel one, and the spring is only ever asked to close a rubber-banded
    // gap, so "close enough" is relative to the band's own dimension.
    spring.epsilon = Math.max(1e-6, k.dim * 1e-4)
  }

  const k: Kinetic = {
    value: 0,
    velocity: 0,
    dim: c.dim,
    get mode() {
      return mode
    },
    beginDrag() {
      mode = 'drag'
      k.velocity = 0
      spring.velocity = 0
    },
    drag(delta: number, min: number, max: number) {
      if (mode !== 'drag') k.beginDrag()
      raw += delta
      k.value = project(raw, min, max)
    },
    endDrag(velocity: number, min: number, max: number) {
      const hi = Math.max(min, max)
      k.velocity = velocity
      if (raw > hi || raw < min) {
        toSpring(raw > hi ? hi : min, velocity)
        return
      }
      if (Math.abs(velocity) <= c.minVelocity) {
        mode = 'idle'
        k.velocity = 0
        return
      }
      mode = 'fling'
      v0 = velocity
      x0 = raw
      elapsed = 0
      // The instant |v| falls to minVelocity. Clamping elapsed here is what makes
      // one 10-second step and a thousand ragged ones land on the same pixel.
      tStop = Math.log(c.minVelocity / Math.abs(velocity)) / lnF
    },
    update(dtMs: number, min: number, max: number): boolean {
      const hi = Math.max(min, max)
      const dt = Math.max(0, dtMs) / 1000

      if (mode === 'fling') {
        elapsed += dt
        const te = Math.min(elapsed, tStop)
        const f = c.friction ** te
        raw = x0 + (v0 * (f - 1)) / lnF
        k.velocity = v0 * f
        if (raw > hi || raw < min) {
          // Ran off the end mid-fling. Hand the remaining velocity to the spring
          // and let the band absorb it — an abrupt stop at the edge is the exact
          // moment a chart stops feeling native.
          toSpring(raw > hi ? hi : min, k.velocity)
        } else if (te >= tStop) {
          mode = 'idle'
          k.velocity = 0
          k.value = raw
          return false
        }
      }

      if (mode === 'spring') {
        spring.target = spring.target > (min + hi) / 2 ? hi : min
        const alive = spring.update(dtMs)
        raw = spring.value
        k.velocity = spring.velocity
        if (!alive) {
          mode = 'idle'
          k.velocity = 0
        }
        k.value = project(raw, min, max)
        return alive
      }

      if (mode === 'fling') {
        k.value = project(raw, min, max)
        return true
      }
      return false
    },
    stop() {
      mode = 'idle'
      raw = k.value
      k.velocity = 0
      spring.snap(k.value)
    },
  }
  return k
}

/** `1 − (1−t)³`. The 220ms last-price flash and the 180ms timeframe cross-fade. */
export const easeOutCubic = (t: number): number => {
  const u = 1 - Math.min(1, Math.max(0, t))
  return 1 - u * u * u
}

/** `1 − (1−t)²`. Gentler; the 90ms crosshair magnetise snap. */
export const easeOutQuad = (t: number): number => {
  const u = 1 - Math.min(1, Math.max(0, t))
  return 1 - u * u
}
