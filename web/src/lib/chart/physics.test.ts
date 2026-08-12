import { describe, it, expect } from 'vitest'
import {
  DEFAULT_KINETIC,
  createKinetic,
  createSpring,
  easeOutCubic,
  easeOutQuad,
  rubberBand,
} from './physics'

const FAR = 1e9

/** A deterministic ragged frame clock: real frames are never evenly spaced, and a
 *  test that only ever feeds 16.6ms proves nothing about frame independence. */
function ragged(seed: number, n: number, totalMs: number): number[] {
  let s = seed >>> 0
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    const w = 0.2 + (s / 0x100000000) * 1.8
    out.push(w)
    sum += w
  }
  return out.map((w) => (w / sum) * totalMs)
}

/** Fling a free (unbounded) kinetic and return how far it travelled. */
function fling(v0: number, slices: number[]): number {
  const k = createKinetic()
  k.drag(0, -FAR, FAR)
  k.endDrag(v0, -FAR, FAR)
  for (const dt of slices) k.update(dt, -FAR, FAR)
  return k.value
}

describe('rubberBand', () => {
  it('gives up 0.645 of the dimension at a full dimension of pull', () => {
    // Apple's number. Matching it is why an overscroll here feels like every
    // other iOS scroll view rather than like a chart with a bug.
    expect(rubberBand(320, 320)).toBeCloseTo(0.645161 * 320, 3)
    expect(rubberBand(-320, 320)).toBeCloseTo(-0.645161 * 320, 3)
  })

  it('is monotone and saturating', () => {
    let prev = 0
    let prevGain = Infinity
    for (let d = 1; d <= 2000; d += 1) {
      const v = rubberBand(d, 320)
      const gain = v - prev
      expect(v).toBeGreaterThan(prev)
      // Every extra pixel of pull buys less than the one before it — that
      // decreasing return IS the message the gesture is sending to the finger.
      expect(gain).toBeLessThan(prevGain)
      prev = v
      prevGain = gain
    }
    // Never runs away: a full six dimensions of pull is still under 2.5 of them.
    expect(rubberBand(6 * 320, 320)).toBeLessThan(2.5 * 320)
  })

  it('barely resists the first pixel', () => {
    // The band must not feel like friction at the start, or the edge reads as
    // sticky rather than soft.
    expect(rubberBand(1, 320)).toBeGreaterThan(0.99)
    expect(rubberBand(1, 320)).toBeLessThan(1)
  })

  it('refuses to produce NaN from a degenerate dimension', () => {
    expect(rubberBand(50, 0)).toBe(0)
    expect(rubberBand(NaN, 320)).toBe(0)
  })
})

describe('fling deceleration', () => {
  it('glides the distance the closed form predicts', () => {
    // v0 · 0.135^t integrates to v0 / 2.002. A 2000 px/s flick travels ~1000px,
    // which is the number the whole feel of the pan is built on.
    const dist = fling(2000, [10_000])
    expect(dist).toBeGreaterThan(0)
    expect(Math.abs(dist - 2000 / 2.002) / (2000 / 2.002)).toBeLessThan(0.01)
  })

  it('lands in the same place however the time is sliced', () => {
    // The reason deceleration is integrated analytically rather than multiplied
    // per frame: a dropped frame on a busy phone must not shorten the fling.
    const one = fling(2400, [10_000])
    const many = fling(2400, ragged(7, 1000, 10_000))
    expect(Math.abs(one - many)).toBeLessThan(0.5)

    const backwards = fling(-2400, ragged(11, 1000, 10_000))
    expect(Math.abs(backwards + one)).toBeLessThan(0.5)
  })

  it('stops below 12 px/s instead of creeping', () => {
    const k = createKinetic()
    k.drag(0, -FAR, FAR)
    k.endDrag(2000, -FAR, FAR)
    let alive = true
    let t = 0
    while (alive && t < 20_000) {
      alive = k.update(16.6, -FAR, FAR)
      t += 16.6
    }
    expect(alive).toBe(false)
    expect(k.velocity).toBe(0)
    // Everything below the threshold is dropped, so the fling is a hair short of
    // the ideal — by exactly minVelocity / 2.002.
    expect(k.value).toBeCloseTo((2000 - DEFAULT_KINETIC.minVelocity) / 2.0025, 1)
  })

  it('does not fling at all below the threshold', () => {
    const k = createKinetic()
    k.drag(0, -FAR, FAR)
    k.endDrag(8, -FAR, FAR)
    expect(k.update(16.6, -FAR, FAR)).toBe(false)
    expect(k.value).toBe(0)
  })
})

describe('drag against a bound', () => {
  it('rubber-bands past the end rather than stopping dead', () => {
    const k = createKinetic({ dim: 300 })
    k.beginDrag()
    k.drag(-150, 0, 500)
    expect(k.value).toBeLessThan(0)
    expect(k.value).toBeGreaterThan(-150)
    expect(k.value).toBeCloseTo(rubberBand(-150, 300), 6)
  })

  it('moves one-for-one inside the bounds', () => {
    const k = createKinetic({ dim: 300 })
    k.drag(120, 0, 500)
    expect(k.value).toBe(120)
  })

  it('springs back to the bound after an overscrolled release', () => {
    const k = createKinetic({ dim: 300 })
    k.drag(-200, 0, 500)
    k.endDrag(0, 0, 500)
    let alive = true
    let t = 0
    while (alive && t < 3000) {
      alive = k.update(16.6, 0, 500)
      t += 16.6
      // The band is never crossed on the way home: overshooting into positive
      // territory would read as a bounce the user did not ask for.
      expect(k.value).toBeLessThanOrEqual(1e-6)
    }
    expect(alive).toBe(false)
    expect(k.value).toBeCloseTo(0, 6)
  })

  it('hands a fling that reaches the end over to the spring', () => {
    const k = createKinetic({ dim: 300 })
    k.drag(0, 0, 100)
    k.endDrag(2000, 0, 100)
    let alive = true
    let t = 0
    let peak = 0
    while (alive && t < 4000) {
      alive = k.update(16.6, 0, 100)
      peak = Math.max(peak, k.value)
      t += 16.6
    }
    // It overshoots — that is the point — but the band keeps the excursion small
    // and it always comes back to rest exactly on the bound.
    expect(peak).toBeGreaterThan(100)
    expect(peak).toBeLessThan(100 + 300)
    expect(k.value).toBeCloseTo(100, 6)
  })

  it('adopts an externally assigned value on stop()', () => {
    // The renderer pins i0 to the newest bar itself while following; without
    // this the next drag would snap back to wherever the kinetic last was.
    const k = createKinetic()
    k.drag(50, -FAR, FAR)
    k.value = 900
    k.stop()
    k.drag(10, -FAR, FAR)
    expect(k.value).toBe(910)
  })
})

describe('createSpring', () => {
  /**
   * Run a spring from `from` to 0 for an exact NUMBER OF FRAMES and sample it.
   *
   * Frames rather than a `while (t < ms)` bound on purpose: accumulating
   * 1000/60 fifteen times lands a hair under 250 and runs a sixteenth frame,
   * while 1000/120 lands a hair over and runs thirty. Comparing those two is
   * comparing 267ms of motion against 250ms, which says nothing about the
   * integrator and everything about the loop that drove it.
   */
  function run(k: number, from: number, dtMs: number, frames: number) {
    const s = createSpring(k)
    s.snap(from)
    s.target = 0
    const samples: { t: number; v: number }[] = []
    for (let i = 0; i < frames; i++) {
      s.update(dtMs)
      samples.push({ t: (i + 1) * dtMs, v: s.value })
    }
    return { s, samples }
  }

  /** Frames of `dtMs` covering `ms`, exactly. */
  const framesFor = (dtMs: number, ms: number) => Math.round(ms / dtMs)

  it('never overshoots when critically damped', () => {
    // An overshooting price axis looks like the chart is arguing with itself.
    for (const k of [90, 160, 220]) {
      const { samples } = run(k, 100, 4, 375)
      for (const p of samples) expect(p.v).toBeGreaterThanOrEqual(-1e-9)
      const back = run(k, -100, 4, 375)
      for (const p of back.samples) expect(p.v).toBeLessThanOrEqual(1e-9)
    }
  })

  it('tracks the closed form of a critically damped release', () => {
    // The exact solution of a critically damped release is x(t) = x0(1+wt)e^(-wt).
    // Semi-implicit Euler follows that trajectory but sits slightly BEHIND it in
    // time — it is symplectic, so its error shows up as phase, not as a wrong
    // shape or a wrong resting point. So the honest assertion is that every
    // sample lies on the real curve somewhere within the last substep, rather
    // than within some tuned pixel tolerance.
    //
    // The bound is absolute on purpose. The error is almost entirely PHASE — the
    // scheme is symplectic, so it follows the right curve slightly behind the
    // clock rather than following a wrong curve — and phase error is worst where
    // the spring is fastest. That peak is 1.94px at t = 75ms, where the spring
    // is doing 545 px/s and one substep of travel is 2.3px. So the whole
    // discrepancy is "less than one substep late", expressed in pixels.
    //
    // Deep in the tail the lag grows to several substeps, because the discrete
    // decay rate is a shade slower than e^(-wt); at 500ms that is 4.7 substeps
    // of phase but only 0.5px of position, which is why a phase bound would be
    // the wrong thing to assert and a pixel bound is the right one. Nothing the
    // eye can resolve is in either number, and a wrong omega or a wrong damping
    // coefficient would miss this by a mile rather than by 2%.
    const w = Math.sqrt(220)
    const exact = (t: number) => 100 * (1 + w * t) * Math.exp(-w * t)
    const { samples } = run(220, 100, 1000 / 240, 144)
    for (const p of samples) {
      expect(Math.abs(p.v - exact(p.t / 1000))).toBeLessThan(2)
    }
  })

  it('reaches the settle marks §C.2 quotes', () => {
    // §C.2 pins k = 220 at ~300ms and k = 90 at ~470ms. Those are the same point
    // on the curve (wt = 4.45, ~6% left), which is why they are in the ratio of
    // the two frequencies. The doc calls that point "0.5px from 100px"; the
    // closed form says 0.5px arrives at ~500ms and ~790ms. The constants are
    // what §C.2 pins hardest, so the constants are what this keeps.
    const fast = run(220, 100, 4, framesFor(4, 300))
    expect(fast.s.value).toBeLessThan(7)
    const slow = run(90, 100, 4, framesFor(4, 470))
    expect(slow.s.value).toBeLessThan(7)
    expect(Math.abs(fast.s.value - slow.s.value)).toBeLessThan(0.5)
  })

  it('settles to within its epsilon and then stops reporting motion', () => {
    const s = createSpring(220)
    s.snap(100)
    s.target = 0
    let t = 0
    while (s.update(4) && t < 3000) t += 4
    expect(t).toBeGreaterThan(400)
    expect(t).toBeLessThan(600)
    // Snapped, not left a third of a pixel short — a spring that never finishes
    // holds the render loop awake for something nobody can see.
    expect(s.value).toBe(0)
    expect(s.velocity).toBe(0)
    expect(s.update(4)).toBe(false)
  })

  it('is frame-rate independent', () => {
    // 15 frames of 1/60 and 30 of 1/120 are the same 250ms, so they must be the
    // same 60 substeps and therefore the same pixel — not merely close. A 120Hz
    // phone animating differently from a 60Hz one is the exact bug this catches.
    const a = run(220, 100, 1000 / 60, 15).s.value
    const b = run(220, 100, 1000 / 120, 30).s.value
    const c = run(220, 100, 1000 / 240, 60).s.value
    expect(Math.abs(a - b)).toBeLessThan(1e-9)
    expect(Math.abs(a - c)).toBeLessThan(1e-9)
  })

  it('caps catch-up at 8 substeps so a stall does not jump', () => {
    // 8 substeps is 33ms. A 400ms hitch must advance the spring by a frame's
    // worth of motion, not by 400ms of it.
    const stalled = createSpring(220)
    stalled.snap(100)
    stalled.target = 0
    stalled.update(400)

    const normal = createSpring(220)
    normal.snap(100)
    normal.target = 0
    normal.update(33.4)

    expect(stalled.value).toBeCloseTo(normal.value, 6)
  })

  it('does not lose fractional time between frames', () => {
    // 100Hz is 2.4 substeps a frame — a rate with no whole-substep answer at
    // all. Without the carried remainder it would run 2 and silently throw away
    // a sixth of every frame, and the spring would settle late.
    const odd = run(220, 100, 10, 25).s.value
    const fine = run(220, 100, 1000 / 240, 60).s.value
    expect(Math.abs(odd - fine)).toBeLessThan(0.35)
  })

  it('snaps instantly, which is what reduced motion uses', () => {
    const s = createSpring(90)
    s.value = 40
    s.velocity = 900
    s.snap(70)
    expect(s.value).toBe(70)
    expect(s.target).toBe(70)
    expect(s.velocity).toBe(0)
    expect(s.update(16.6)).toBe(false)
  })
})

describe('easings', () => {
  it('start at 0, end at 1, and decelerate', () => {
    for (const e of [easeOutCubic, easeOutQuad]) {
      expect(e(0)).toBe(0)
      expect(e(1)).toBe(1)
      expect(e(0.5)).toBeGreaterThan(0.5)
      let prev = 0
      let prevGain = Infinity
      for (let t = 0.05; t <= 1; t += 0.05) {
        const v = e(t)
        expect(v).toBeGreaterThan(prev)
        expect(v - prev).toBeLessThan(prevGain + 1e-12)
        prevGain = v - prev
        prev = v
      }
    }
  })

  it('clamp out-of-range time rather than extrapolating', () => {
    // A flash driven past its duration must sit at 1, not sail past it.
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(4)).toBe(1)
    expect(easeOutQuad(-1)).toBe(0)
    expect(easeOutQuad(4)).toBe(1)
  })
})
