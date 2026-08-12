import { describe, it, expect } from 'vitest'

// Structural guarantees, enforced by reading the source.
//
// These are not style rules. Each one, if broken, produces a bug that is
// genuinely hard to find later:
//
//   Math.random in the engine  -> the market stops replaying, and a restored
//                                 snapshot silently diverges from where it left off
//   Date.now in the engine     -> the sim couples to the wall clock, so 60x speed
//                                 and catch-up produce different prices than live
//   a React or Dexie import    -> the pure core stops being unit-testable and
//                                 starts needing a DOM or a database
//   a node_modules import      -> a runtime dependency lands in the PWA bundle
//                                 that the offline story says isn't there
//
// A grep-the-tree test is crude, but it is the only kind that survives nine
// workstreams editing in parallel.
//
// The sources are pulled in through Vite's raw glob rather than node:fs, so this
// file needs no Node types — tsconfig.app.json deliberately has none, and adding
// them for one test would leak Node globals into the whole app.

const RAW = import.meta.glob('../{trading,chart}/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const isTest = (p: string) => p.endsWith('.test.ts') || p.includes('/testing/')

/** Strip line and block comments, so a rule named in prose doesn't trip itself. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// Vite rewrites keys relative to THIS file, so the sibling tree comes back as
// '../chart/...' while this file's own tree collapses to './...'.
function sources(inChart: boolean): { path: string; src: string }[] {
  return Object.entries(RAW)
    .filter(([p]) => p.startsWith('../chart/') === inChart && !isTest(p))
    .map(([path, src]) => ({ path, src: code(src) }))
}

const TRADING = sources(false)
const CHART = sources(true)

describe('trading + chart purity', () => {
  it('found the source tree at all', () => {
    // Without this, every assertion below passes vacuously the day someone moves
    // a directory — which is the worst possible failure mode for a guard test.
    expect(TRADING.length).toBeGreaterThan(1)
    expect(CHART.length).toBeGreaterThan(1)
  })

  it('never calls Math.random outside ids.ts', () => {
    // ids.ts is the deliberate exception: an order id is not part of the
    // simulation and never has to replay, so seeding it would only couple two
    // unrelated things. Everything that feeds a price uses lib/trading/rng.ts.
    const bad = [...TRADING, ...CHART]
      .filter((f) => !/(^|\/)ids\.ts$/.test(f.path))
      .filter((f) => /Math\.random\s*\(/.test(f.src))
      .map((f) => f.path)
    expect(bad).toEqual([])
  })

  it('never reads the wall clock inside the simulation', () => {
    // The chart is exempt: it animates against real elapsed time. The engine is
    // not — sim time is whatever the clock has been advanced to, and reading
    // Date.now() anywhere in it would make 60x speed behave unlike 1x.
    const bad = TRADING.filter((f) =>
      /Date\.now\s*\(|new Date\s*\(\s*\)|performance\.now\s*\(/.test(f.src),
    ).map((f) => f.path)
    expect(bad).toEqual([])
  })

  it('imports nothing from node_modules, React, or the database', () => {
    const offenders: string[] = []
    for (const f of [...TRADING, ...CHART]) {
      const specs = [...f.src.matchAll(/(?:^|\n)\s*import[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1])
      for (const s of specs) {
        // Everything legitimate here is relative; a bare specifier is a package.
        if (!s.startsWith('.')) offenders.push(`${f.path} -> ${s}`)
        else if (/(^|\/)db(\.js|\.ts)?$/.test(s)) offenders.push(`${f.path} -> ${s}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the two trees from importing each other', () => {
    // The seam is structural: a CandleSeries satisfies OhlcvColumns without
    // either side naming the other. An import in either direction would collapse
    // that and make the chart un-reusable and un-testable on its own.
    const bad = [
      ...TRADING.filter((f) => /from\s+['"][^'"]*\bchart\//.test(f.src)),
      ...CHART.filter((f) => /from\s+['"][^'"]*\btrading\//.test(f.src)),
    ].map((f) => f.path)
    expect(bad).toEqual([])
  })
})
