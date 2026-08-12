// Wall time in, simulation time out — in whole quanta only.
//
// The banked `residual` is the entire point. At 1x a 16.7ms frame is 0.067 of a
// quantum; if the clock rounded that away the sim would run at zero, and if it
// advanced by a partial quantum the market would draw a different number of
// random numbers depending on the frame rate. Keeping the remainder means the
// quantum count after any sequence of calls depends only on the total time
// consumed, never on how it was chopped up.

import { TICK_QUANTUM_MS } from '../types'
import type { SimTime } from '../types'

export interface ClockState {
  simNow: SimTime
  speed: number
  residual: number
  paused: boolean
}

export interface SimClock {
  now(): SimTime
  /** 1 = real time. Clamped to [1, 1000]: below 1 the market barely moves and
   *  above 1000 a single frame asks for more sim time than catch-up would. */
  speed: number
  paused: boolean
  /** Consume `wallDeltaMs` of real time. Returns the new sim time (a whole
   *  number of quanta; the remainder is banked in `residual`). */
  advance(wallDeltaMs: number): SimTime
  /** Jump forward by sim time directly, for catch-up. Ignores `paused` — this is
   *  an explicit request to move the world, not the passage of time. */
  advanceSim(simDeltaMs: number): SimTime
  snapshot(): ClockState
  restore(s: ClockState): void
}

const MIN_SPEED = 1
const MAX_SPEED = 1000

class Clock implements SimClock {
  private st: ClockState

  constructor(s?: ClockState) {
    this.st = s
      ? { ...s, speed: this.clampSpeed(s.speed) }
      : { simNow: 0, speed: 1, residual: 0, paused: false }
  }

  private clampSpeed(v: number): number {
    if (!Number.isFinite(v)) return 1
    return v < MIN_SPEED ? MIN_SPEED : v > MAX_SPEED ? MAX_SPEED : v
  }

  get speed(): number {
    return this.st.speed
  }

  set speed(v: number) {
    this.st.speed = this.clampSpeed(v)
  }

  get paused(): boolean {
    return this.st.paused
  }

  set paused(v: boolean) {
    this.st.paused = v
  }

  now(): SimTime {
    return this.st.simNow
  }

  advance(wallDeltaMs: number): SimTime {
    // A paused clock banks nothing: resuming must not release a lump of time
    // that was never watched.
    if (this.st.paused || !(wallDeltaMs > 0)) return this.st.simNow
    return this.advanceSim(wallDeltaMs * this.st.speed)
  }

  advanceSim(simDeltaMs: number): SimTime {
    if (!(simDeltaMs > 0)) return this.st.simNow
    const st = this.st
    const total = st.residual + simDeltaMs
    const whole = Math.floor(total / TICK_QUANTUM_MS)
    st.residual = total - whole * TICK_QUANTUM_MS
    st.simNow += whole * TICK_QUANTUM_MS
    return st.simNow
  }

  snapshot(): ClockState {
    return { ...this.st }
  }

  restore(s: ClockState): void {
    this.st = { ...s, speed: this.clampSpeed(s.speed) }
  }
}

export function createClock(s?: ClockState): SimClock {
  return new Clock(s)
}
