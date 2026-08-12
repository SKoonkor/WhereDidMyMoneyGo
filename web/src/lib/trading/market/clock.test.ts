import { describe, it, expect } from 'vitest'
import { createClock } from './clock'
import { TICK_QUANTUM_MS } from '../types'

describe('the sim clock', () => {
  it('starts at zero, unpaused, at real time', () => {
    const c = createClock()
    expect(c.now()).toBe(0)
    expect(c.speed).toBe(1)
    expect(c.paused).toBe(false)
  })

  it('advances only in whole quanta and banks the remainder', () => {
    const c = createClock()
    c.advance(100)
    expect(c.now()).toBe(0)
    c.advance(100)
    expect(c.now()).toBe(0)
    // 300ms banked: the third frame pushes the total over one quantum.
    c.advance(100)
    expect(c.now()).toBe(TICK_QUANTUM_MS)
    expect(c.snapshot().residual).toBeCloseTo(50, 9)
  })

  it('lands on the same sim time however the wall time was sliced', () => {
    const one = createClock()
    one.advance(60_000)

    const many = createClock()
    // Frame times that never divide evenly into a quantum, which is the whole
    // reason the residual exists.
    for (let i = 0; i < 3591; i++) many.advance(60_000 / 3591)

    expect(many.now()).toBe(one.now())
  })

  it('multiplies wall time by speed', () => {
    const c = createClock()
    c.speed = 60
    c.advance(1_000)
    expect(c.now()).toBe(60_000)
  })

  it('banks nothing while paused, so resuming releases no lump of time', () => {
    const c = createClock()
    c.paused = true
    for (let i = 0; i < 100; i++) c.advance(16)
    expect(c.now()).toBe(0)
    expect(c.snapshot().residual).toBe(0)
    c.paused = false
    c.advance(1_000)
    expect(c.now()).toBe(1_000)
  })

  it('still jumps forward for catch-up while paused', () => {
    const c = createClock()
    c.paused = true
    c.advanceSim(3_600_000)
    expect(c.now()).toBe(3_600_000)
  })

  it('clamps speed to 1..1000', () => {
    const c = createClock()
    c.speed = 0
    expect(c.speed).toBe(1)
    c.speed = -5
    expect(c.speed).toBe(1)
    c.speed = 5_000
    expect(c.speed).toBe(1000)
    c.speed = Number.NaN
    expect(c.speed).toBe(1)
  })

  it('ignores time that runs backwards', () => {
    const c = createClock()
    c.advance(1_000)
    c.advance(-500)
    expect(c.now()).toBe(1_000)
  })

  it('round-trips through a snapshot', () => {
    const c = createClock()
    c.speed = 30
    c.advance(1_337)
    const s = JSON.parse(JSON.stringify(c.snapshot()))

    const r = createClock(s)
    expect(r.now()).toBe(c.now())
    expect(r.speed).toBe(30)
    // The banked remainder has to survive too, or a restore quietly shifts every
    // quantum boundary after it.
    r.advance(1_000)
    c.advance(1_000)
    expect(r.now()).toBe(c.now())
  })
})
