import { describe, it, expect } from 'vitest'
import {
  EXPIRY_HOUR_UTC, buildChain, optionSymbol, parseOptionSymbol, shortOptionMargin,
  standardExpiries, surfaceVol,
  type ChainParams, type VolSurface,
} from './chain'
import { OPTION_MULT } from '../types'

/** 08:00 UTC on a given date — the hour every expiry in the sandbox settles at. */
const at8 = (iso: string) => Date.parse(`${iso}T08:00:00.000Z`)

const MON_10_AUG = at8('2026-08-10')
const FRI_14_AUG = at8('2026-08-14')
const FRI_21_AUG = at8('2026-08-21')
const FRI_28_AUG = at8('2026-08-28')
const FRI_04_SEP = at8('2026-09-04')
const FRI_25_SEP = at8('2026-09-25')
const FRI_30_OCT = at8('2026-10-30')

const surface: VolSurface = { atmVol: 0.6, termSlope: 0.05, skew: -0.08, smile: 0.05 }

const params = (o: Partial<ChainParams> = {}): ChainParams => ({
  underlying: 'BTC',
  strikeSteps: 5,
  strikeStepPct: 0.02,
  r: 0.04,
  q: 0,
  surface,
  spreadBps: 75,
  multiplier: OPTION_MULT,
  ...o,
})

describe('surfaceVol', () => {
  it('is the ATM vol plus the term slope at the forward', () => {
    const t = 0.25
    const forward = 100 * Math.exp(0.04 * t)
    expect(surfaceVol(surface, 100, forward, t, 0.04))
      .toBeCloseTo(surface.atmVol + surface.termSlope * Math.sqrt(t), 12)
  })

  it('slopes upward with tenor', () => {
    const near = surfaceVol(surface, 100, 100, 0.05, 0.04)
    const far = surfaceVol(surface, 100, 100, 1, 0.04)
    expect(far).toBeGreaterThan(near)
  })

  it('bids downside puts over upside calls, which is what negative skew means', () => {
    const down = surfaceVol(surface, 100, 80, 0.25, 0.04)
    const up = surfaceVol(surface, 100, 125, 0.25, 0.04)
    expect(down).toBeGreaterThan(up)
  })

  it('lifts both wings above the middle when there is smile', () => {
    const pure: VolSurface = { atmVol: 0.6, termSlope: 0, skew: 0, smile: 0.2 }
    const mid = surfaceVol(pure, 100, 100, 0.25, 0)
    expect(surfaceVol(pure, 100, 70, 0.25, 0)).toBeGreaterThan(mid)
    expect(surfaceVol(pure, 100, 140, 0.25, 0)).toBeGreaterThan(mid)
  })

  it('clamps into [0.02, 4] so the far wings never go negative', () => {
    // A steep enough skew drives the raw parameterisation below zero, and a
    // negative sigma silently turns `bs` into a zero-vol intrinsic quote.
    const steep: VolSurface = { atmVol: 0.6, termSlope: 0, skew: -3, smile: 0 }
    expect(surfaceVol(steep, 100, 5, 0.25, 0)).toBeLessThanOrEqual(4)
    expect(surfaceVol(steep, 100, 5, 0.25, 0)).toBeGreaterThanOrEqual(0.02)
    expect(surfaceVol(steep, 100, 900, 0.25, 0)).toBe(0.02)
  })

  it('never returns NaN on a degenerate input', () => {
    for (const v of [
      surfaceVol(surface, 100, 100, 0, 0.04),
      surfaceVol(surface, 0, 100, 0.25, 0.04),
      surfaceVol(surface, 100, 0, 0.25, 0.04),
      surfaceVol({ ...surface, atmVol: 0 }, 100, 100, 0.25, 0.04),
      surfaceVol(surface, 100, 100, -1, 0.04),
    ]) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0.02)
    }
  })
})

describe('optionSymbol / parseOptionSymbol', () => {
  it('produces the documented format', () => {
    expect(optionSymbol('BTC', FRI_14_AUG, 'call', 65000)).toBe('BTC|2026-08-14|call|65000')
  })

  it('round-trips, fractional strikes included', () => {
    for (const k of [65000, 1.35, 0.05, 1.2, 2.5, 12345.678, 0.000125]) {
      for (const right of ['call', 'put'] as const) {
        const sym = optionSymbol('ETH', FRI_28_AUG, right, k)
        const inst = parseOptionSymbol(sym)
        expect(inst, sym).not.toBeNull()
        expect(inst!.strike).toBe(k)
        expect(inst!.right).toBe(right)
        expect(inst!.underlying).toBe('ETH')
        expect(inst!.expiry).toBe(FRI_28_AUG)
        expect(inst!.symbol).toBe(sym)
      }
    }
  })

  it('fills in the instrument fields the symbol cannot carry', () => {
    const inst = parseOptionSymbol('BTC|2026-08-14|put|60000')!
    expect(inst.kind).toBe('option')
    expect(inst.multiplier).toBe(OPTION_MULT)
    expect(inst.tickSize).toBeGreaterThan(0)
    // The symbol holds a DATE, so the instant comes back at the canonical hour.
    expect(inst.expiry % 86_400_000).toBe(EXPIRY_HOUR_UTC * 3_600_000)
  })

  it('rejects anything that is not one of ours', () => {
    for (const bad of [
      '',
      'BTC',
      'BTC|2026-08-14|call',
      'BTC|2026-08-14|call|65000|extra',
      'BTC|2026-08-14|straddle|65000',
      'BTC|14-08-2026|call|65000',
      'BTC|2026-08-14|call|abc',
      'BTC|2026-08-14|call|-100',
      'BTC|2026-08-14|call|0',
      '|2026-08-14|call|65000',
    ]) {
      expect(parseOptionSymbol(bad), bad).toBeNull()
    }
  })

  it('rejects a date that does not exist', () => {
    // The day-count algorithm happily normalises 2026-02-31 into March, which
    // would make two different symbols resolve to the same instrument.
    expect(parseOptionSymbol('BTC|2026-02-31|call|100')).toBeNull()
    expect(parseOptionSymbol('BTC|2026-13-01|call|100')).toBeNull()
    expect(parseOptionSymbol('BTC|2026-02-28|call|100')).not.toBeNull()
    expect(parseOptionSymbol('BTC|2028-02-29|call|100')).not.toBeNull()
  })
})

describe('standardExpiries', () => {
  it('lists the next Fridays at 08:00 UTC', () => {
    expect(standardExpiries(MON_10_AUG, 4, 0))
      .toEqual([FRI_14_AUG, FRI_21_AUG, FRI_28_AUG, FRI_04_SEP])
  })

  it('skips a Friday whose 08:00Z has already gone', () => {
    // Standing exactly on the bell, that expiry is no longer tradeable — offering
    // it would let a user buy an option that has already settled.
    expect(standardExpiries(FRI_14_AUG, 2, 0)).toEqual([FRI_21_AUG, FRI_28_AUG])
    expect(standardExpiries(FRI_14_AUG - 1, 1, 0)).toEqual([FRI_14_AUG])
  })

  it('adds the last Friday of each of the next months', () => {
    expect(standardExpiries(MON_10_AUG, 0, 3)).toEqual([FRI_28_AUG, FRI_25_SEP, FRI_30_OCT])
  })

  it('deduplicates the monthly that is also a weekly, and stays sorted', () => {
    const out = standardExpiries(MON_10_AUG, 4, 3)
    // 28 Aug is both the 3rd weekly and the 1st monthly; it must appear once.
    expect(out).toEqual([FRI_14_AUG, FRI_21_AUG, FRI_28_AUG, FRI_04_SEP, FRI_25_SEP, FRI_30_OCT])
    expect(new Set(out).size).toBe(out.length)
    expect([...out].sort((a, b) => a - b)).toEqual(out)
  })

  it('handles zero of either kind', () => {
    expect(standardExpiries(MON_10_AUG, 0, 0)).toEqual([])
    expect(standardExpiries(MON_10_AUG, -3, 0)).toEqual([])
  })

  it('rolls the monthly across a year boundary', () => {
    const out = standardExpiries(at8('2026-12-01'), 0, 2)
    expect(out).toEqual([at8('2026-12-25'), at8('2027-01-29')])
  })
})

describe('buildChain', () => {
  const SPOT = 65_000

  it('is deterministic — the same inputs give a deeply equal chain, twice', () => {
    const a = buildChain(params(), SPOT, MON_10_AUG, FRI_14_AUG)
    const b = buildChain(params(), SPOT, MON_10_AUG, FRI_14_AUG)
    expect(a).toEqual(b)
  })

  it('keeps open interest pinned to the contract, not to the clock', () => {
    // OI is a hash of (strike, expiry). If the wall clock or an RNG leaked in,
    // the column would flicker on every quote tick.
    const early = buildChain(params(), SPOT, MON_10_AUG, FRI_14_AUG)
    const later = buildChain(params(), SPOT, MON_10_AUG + 3_600_000, FRI_14_AUG)
    expect(later.rows.map((r) => r.call.oi)).toEqual(early.rows.map((r) => r.call.oi))
    expect(later.rows.map((r) => r.put.volume)).toEqual(early.rows.map((r) => r.put.volume))
    for (const r of early.rows) {
      expect(Number.isInteger(r.call.oi)).toBe(true)
      expect(r.call.oi).toBeGreaterThan(0)
      expect(r.call.volume).toBeGreaterThanOrEqual(0)
      expect(r.call.volume).toBeLessThanOrEqual(r.call.oi)
    }
  })

  it('has 2n+1 rows on a strictly increasing, evenly spaced ladder', () => {
    const chain = buildChain(params({ strikeSteps: 5 }), SPOT, MON_10_AUG, FRI_14_AUG)
    expect(chain.rows).toHaveLength(11)
    const strikes = chain.rows.map((r) => r.strike)
    expect([...strikes].sort((a, b) => a - b)).toEqual(strikes)
    const gaps = strikes.slice(1).map((k, i) => k - strikes[i])
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 9)
    expect(gaps[0]).toBeGreaterThan(0)
  })

  it('is symmetric about the centre strike', () => {
    const chain = buildChain(params({ strikeSteps: 4 }), SPOT, MON_10_AUG, FRI_14_AUG)
    const strikes = chain.rows.map((r) => r.strike)
    const centre = strikes[4]
    for (let i = 0; i < strikes.length; i++) {
      expect(strikes[i] + strikes[strikes.length - 1 - i]).toBeCloseTo(2 * centre, 6)
    }
    // The centre sits on the round ladder nearest spot, within half a step of it.
    const step = strikes[1] - strikes[0]
    expect(Math.abs(centre - SPOT)).toBeLessThanOrEqual(step / 2 + 1e-9)
  })

  it('snaps the ladder to round numbers instead of fractions of the spot', () => {
    const chain = buildChain(params(), SPOT, MON_10_AUG, FRI_14_AUG)
    const step = chain.rows[1].strike - chain.rows[0].strike
    // 2% of 65,000 is 1,300; the ladder rounds it to 2,000 rather than quoting a
    // chain of 1,300-wide strikes, which reads as synthetic at a glance.
    expect(step).toBe(2000)
    for (const r of chain.rows) expect(Number.isInteger(r.strike)).toBe(true)
  })

  it('keeps a fractional ladder free of float noise', () => {
    // 24 * 0.05 is 1.2000000000000002 in binary floating point, and that number
    // would go straight into a symbol and become an un-matchable position key.
    const chain = buildChain(params({ strikeStepPct: 0.02, strikeSteps: 6 }), 1.37, MON_10_AUG, FRI_14_AUG)
    for (const r of chain.rows) {
      expect(String(r.strike), String(r.strike)).toMatch(/^\d+(\.\d{1,2})?$/)
    }
    expect(chain.rows[1].strike - chain.rows[0].strike).toBeCloseTo(0.05, 12)
  })

  it('quotes bid < mark < ask on every leg, with a non-negative bid', () => {
    for (const spot of [65_000, 1.37, 42]) {
      const chain = buildChain(params({ strikeSteps: 6 }), spot, MON_10_AUG, FRI_14_AUG)
      for (const r of chain.rows) {
        for (const leg of [r.call, r.put]) {
          expect(leg.bid, `${leg.inst.symbol} bid`).toBeGreaterThanOrEqual(0)
          expect(leg.bid, `${leg.inst.symbol} bid<mark`).toBeLessThan(leg.mark)
          expect(leg.mark, `${leg.inst.symbol} mark<ask`).toBeLessThan(leg.ask)
        }
      }
    }
  })

  it('widens the spread with spreadBps', () => {
    const tight = buildChain(params({ spreadBps: 10 }), 65_000, MON_10_AUG, FRI_14_AUG)
    const wide = buildChain(params({ spreadBps: 400 }), 65_000, MON_10_AUG, FRI_14_AUG)
    const atm = 5
    expect(wide.rows[atm].call.ask - wide.rows[atm].call.bid)
      .toBeGreaterThan(tight.rows[atm].call.ask - tight.rows[atm].call.bid)
    // The mark itself is the model price; only the quotes around it move.
    expect(wide.rows[atm].call.mark).toBe(tight.rows[atm].call.mark)
  })

  it('flags ITM correctly on both sides of every row', () => {
    const chain = buildChain(params({ strikeSteps: 5 }), SPOT, MON_10_AUG, FRI_14_AUG)
    for (const r of chain.rows) {
      expect(r.call.itm, `call ${r.strike}`).toBe(SPOT > r.strike)
      expect(r.put.itm, `put ${r.strike}`).toBe(SPOT < r.strike)
      // Exactly one side is in the money unless the strike is the spot.
      if (r.strike !== SPOT) expect(r.call.itm).not.toBe(r.put.itm)
      else expect(r.call.itm || r.put.itm).toBe(false)
    }
    // And the row where the strike equals the spot really is exercised.
    const onSpot = buildChain(params(), 66_000, MON_10_AUG, FRI_14_AUG)
    const exact = onSpot.rows.find((r) => r.strike === 66_000)!
    expect(exact.call.itm).toBe(false)
    expect(exact.put.itm).toBe(false)
  })

  it('gives every leg a symbol that parses back to the same contract', () => {
    const chain = buildChain(params(), SPOT, MON_10_AUG, FRI_14_AUG)
    for (const r of chain.rows) {
      for (const leg of [r.call, r.put]) {
        const back = parseOptionSymbol(leg.inst.symbol)
        expect(back, leg.inst.symbol).not.toBeNull()
        expect(back!.strike).toBe(leg.inst.strike)
        expect(back!.right).toBe(leg.inst.right)
        expect(back!.expiry).toBe(leg.inst.expiry)
        expect(back!.underlying).toBe('BTC')
      }
    }
  })

  it('prices calls down and puts up as the strike rises', () => {
    const chain = buildChain(params({ strikeSteps: 5 }), SPOT, MON_10_AUG, FRI_14_AUG)
    const calls = chain.rows.map((r) => r.call.mark)
    const puts = chain.rows.map((r) => r.put.mark)
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i], `call ${i}`).toBeLessThanOrEqual(calls[i - 1])
      expect(puts[i], `put ${i}`).toBeGreaterThanOrEqual(puts[i - 1])
    }
  })

  it('carries no NaN into any greek, even at the moment of expiry', () => {
    for (const [now, expiry] of [
      [MON_10_AUG, FRI_14_AUG],
      [FRI_14_AUG, FRI_14_AUG], // T = 0
      [FRI_14_AUG + 60_000, FRI_14_AUG], // already past
    ]) {
      const chain = buildChain(params({ strikeSteps: 8 }), SPOT, now, expiry)
      for (const r of chain.rows) {
        for (const leg of [r.call, r.put]) {
          expect(Number.isFinite(leg.iv)).toBe(true)
          for (const [name, v] of Object.entries(leg.g)) {
            expect(Number.isFinite(v), `${name} ${leg.inst.symbol}`).toBe(true)
          }
        }
      }
    }
  })

  it('reports back exactly the spot, expiry and now it was given', () => {
    const chain = buildChain(params(), SPOT, MON_10_AUG, FRI_14_AUG)
    expect(chain.underlying).toBe('BTC')
    expect(chain.spot).toBe(SPOT)
    expect(chain.now).toBe(MON_10_AUG)
    expect(chain.expiry).toBe(FRI_14_AUG)
  })

  it('degrades rather than throwing on nonsense parameters', () => {
    expect(buildChain(params({ strikeSteps: 0 }), SPOT, MON_10_AUG, FRI_14_AUG).rows).toHaveLength(1)
    expect(buildChain(params({ strikeSteps: -4 }), SPOT, MON_10_AUG, FRI_14_AUG).rows).toHaveLength(1)
    const flat = buildChain(params({ strikeStepPct: 0 }), SPOT, MON_10_AUG, FRI_14_AUG)
    const strikes = flat.rows.map((r) => r.strike)
    expect(new Set(strikes).size).toBe(strikes.length)
  })
})

describe('shortOptionMargin', () => {
  it('is the 20% rule at the money', () => {
    // 0.20 * 100 = 20 beats the 0.10 * 100 = 10 floor; times 100 contracts, plus
    // the premium that was credited on the sale.
    expect(shortOptionMargin(100, 100, 'call', 300, 100)).toBeCloseTo(20 * 100 + 300, 9)
  })

  it('subtracts the out-of-the-money amount', () => {
    // Call, S=100, K=110: OTM by 10, so 0.20*100 - 10 = 10, which ties the floor.
    expect(shortOptionMargin(100, 110, 'call', 0, 100)).toBeCloseTo(11 * 100, 9)
    // Put, S=100, K=90: OTM by 10 as well, but the floor is 0.10*90 = 9.
    expect(shortOptionMargin(100, 90, 'put', 0, 100)).toBeCloseTo(10 * 100, 9)
  })

  it('falls back to the 10%-of-strike floor in the far wings', () => {
    // Without the floor this is 0.20*100 - 100 = -80, i.e. a free naked short —
    // and the first gap through the strike would blow the account up.
    expect(shortOptionMargin(100, 200, 'call', 50, 100)).toBeCloseTo(0.1 * 200 * 100 + 50, 9)
    expect(shortOptionMargin(100, 20, 'put', 50, 100)).toBeCloseTo(0.1 * 20 * 100 + 50, 9)
  })

  it('rises with the premium and never goes negative', () => {
    expect(shortOptionMargin(100, 100, 'call', 900, 100))
      .toBeGreaterThan(shortOptionMargin(100, 100, 'call', 100, 100))
    expect(shortOptionMargin(0, 0, 'call', 0, 100)).toBe(0)
    expect(shortOptionMargin(100, 500, 'call', 0, 1)).toBeGreaterThan(0)
  })

  it('scales with the contract multiplier', () => {
    const one = shortOptionMargin(100, 100, 'put', 0, 1)
    expect(shortOptionMargin(100, 100, 'put', 0, 100)).toBeCloseTo(one * 100, 9)
  })
})
