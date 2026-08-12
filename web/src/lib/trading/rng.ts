// The seeded random number generator the whole simulation runs on.
//
// Every price the sandbox ever shows comes out of here. Math.random() is banned
// under market/, broker/ and options/ (purity.test.ts enforces it) because a
// single unseeded draw anywhere in the chain would make the market
// unreproducible — and reproducibility is what lets a snapshot be restored, a
// day be caught up in 200ms, and a bug be reported by seed.

/**
 * Everything mutable about a generator, in a shape that survives JSON and
 * structured clone.
 *
 * `spare` is the second value Box–Muller produces and we cache. Leaving it out
 * of the snapshot would look harmless and would silently desynchronise a restore
 * by exactly one normal draw — the kind of bug that shows up as "the market
 * jumped when I reopened the app".
 */
export interface RngState {
  a: number
  b: number
  c: number
  d: number
  spare: number | null
}

export interface Rng {
  /** Uniform [0, 1). */
  u(): number
  /** Standard normal, Box–Muller with the second value cached. */
  normal(): number
  /** Exponential with rate 1. */
  exp(): number
  /** Poisson(lambda). */
  poisson(lambda: number): number
  /**
   * An independent stream from the same root, named by `salt`.
   *
   * Per-symbol streams are why adding a symbol to the watchlist doesn't change
   * the prices of the ones already there.
   */
  fork(salt: string): Rng
  state(): RngState
  restore(s: RngState): void
}

/** FNV-1a, 32-bit. Small, fast, and stable across engines — which matters,
 *  because a seed has to mean the same thing on every device. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // The FNV prime, 16777619, via shifts so it stays in 32-bit integer math.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

/**
 * sfc32 — Small Fast Counter.
 *
 * Chosen over a bare LCG or xorshift128 because it passes PractRand at this
 * size, has a 128-bit state that serialises as four uint32s, and needs no
 * multiplication tricks to avoid float precision loss in JS.
 */
function sfc32(st: RngState): number {
  const t = (((st.a + st.b) | 0) + st.d) | 0
  st.d = (st.d + 1) | 0
  st.a = st.b ^ (st.b >>> 9)
  st.b = (st.c + (st.c << 3)) | 0
  st.c = (st.c << 21) | (st.c >>> 11)
  st.c = (st.c + t) | 0
  return (t >>> 0) / 4294967296
}

class SfcRng implements Rng {
  private st: RngState
  private readonly seed: string

  constructor(seed: string, state?: RngState) {
    this.seed = seed
    if (state) {
      this.st = { ...state }
    } else {
      const h = hashSeed(seed)
      // Four decorrelated words from one hash, then discarded warm-up draws so
      // the first value the caller sees isn't a near-copy of the seed itself.
      this.st = {
        a: h >>> 0,
        b: hashSeed('b|' + seed) >>> 0,
        c: hashSeed('c|' + seed) >>> 0,
        d: 1,
        spare: null,
      }
      for (let i = 0; i < 12; i++) sfc32(this.st)
    }
  }

  u(): number {
    return sfc32(this.st)
  }

  normal(): number {
    if (this.st.spare !== null) {
      const v = this.st.spare
      this.st.spare = null
      return v
    }
    // Polar form: no trig, and it rejects rather than clamping, so the tails are
    // honest. The rejection loop consumes a variable number of uniforms, which
    // is fine — the state snapshot captures where it stopped.
    let x = 0
    let y = 0
    let s = 0
    do {
      x = this.u() * 2 - 1
      y = this.u() * 2 - 1
      s = x * x + y * y
    } while (s >= 1 || s === 0)
    const f = Math.sqrt((-2 * Math.log(s)) / s)
    this.st.spare = y * f
    return x * f
  }

  exp(): number {
    // 1 - u, never u: u() can return exactly 0 and log(0) is -Infinity.
    return -Math.log(1 - this.u())
  }

  poisson(lambda: number): number {
    if (!(lambda > 0)) return 0
    if (lambda < 30) {
      // Knuth. Exact, and at lambda < 30 the expected iteration count is lambda,
      // which is cheap enough in the tick loop.
      const l = Math.exp(-lambda)
      let k = 0
      let p = 1
      do {
        k++
        p *= this.u()
      } while (p > l)
      return k - 1
    }
    // Above 30, Knuth's exp(-lambda) underflows toward zero and the loop gets
    // long. A normal approximation with a continuity correction is accurate to
    // well within what a synthetic trade count needs.
    const v = Math.round(lambda + Math.sqrt(lambda) * this.normal())
    return v < 0 ? 0 : v
  }

  fork(salt: string): Rng {
    return new SfcRng(`${this.seed}|${salt}`)
  }

  state(): RngState {
    return { ...this.st }
  }

  restore(s: RngState): void {
    this.st = { ...s }
  }
}

export function createRng(seed: string, state?: RngState): Rng {
  return new SfcRng(seed, state)
}
