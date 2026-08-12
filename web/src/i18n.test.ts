import { describe, it, expect, afterAll } from 'vitest'
import { setLang, t } from './i18n'
// The table's own source text. `?raw` rather than `node:fs` because the app's
// tsconfig sets `types: ["vite/client"]`, so node's globals are deliberately not
// in scope here — and this is the loader the rest of the app already builds with.
import SOURCE from './i18n.ts?raw'

// Placeholders are the one i18n bug that no type, no lint and no reviewer catches.
//
// `t('{amount} interest', { amount })` fills `{amount}` by NAME, so a Thai string
// that spells the placeholder differently — or drops it, or invents one — does not
// throw and does not fail to compile. It renders the literal text `{amount}` on
// screen, in Thai only, and the first person to see it is the user.
//
// So the table is checked as data: for every key in the paper-trading block, the
// SET of `{…}` tokens in the Thai must equal the set in the English key. Same
// names, same count of distinct names, either direction.
//
// The block is parsed out of the source rather than exported from `i18n.ts`,
// because `TH` is deliberately private and exporting it just for a test would put
// the whole table in the app bundle's public surface.

/** The object literal, from `const TH` to its closing brace. */
const TABLE = SOURCE.slice(SOURCE.indexOf('const TH'), SOURCE.indexOf('\n}\n\nexport function getLang'))

/** One entry: `Key: 'value',` or `'Key': 'value',`, at the literal's top level. */
const ENTRY = /^ {2}(?:'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*)): '((?:[^'\\]|\\.)*)'/gm

const unescape = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\')

function entries(src: string): [string, string][] {
  const out: [string, string][] = []
  for (const m of src.matchAll(ENTRY)) out.push([unescape(m[1] ?? m[2]), unescape(m[3])])
  return out
}

/** The distinct `{name}` tokens in a string, sorted — a set, compared as a list. */
function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
}

const ALL = entries(TABLE)
const PAPER_TRADING = entries(TABLE.slice(TABLE.indexOf('// ── Paper trading ──')))

afterAll(() => setLang('en'))

describe('i18n table', () => {
  // Every assertion below is over a parsed list, so a regex that silently matched
  // nothing would make all of them pass. These two make that impossible.
  it('parses the table and the paper-trading block', () => {
    expect(ALL.length).toBeGreaterThan(700)
    expect(PAPER_TRADING.length).toBeGreaterThan(150)
    expect(PAPER_TRADING.length).toBeLessThan(ALL.length)
  })

  it('parses the live table, not a comment or a stale copy', () => {
    setLang('th')
    for (const [key, value] of PAPER_TRADING) expect(t(key)).toBe(value)
  })

  // English IS the key, so a repeat is not a merge conflict the tools report: the
  // later entry silently wins and a finished page changes wording underneath its
  // own workstream.
  it('has no duplicate keys', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const [key] of ALL) {
      if (seen.has(key)) dupes.push(key)
      seen.add(key)
    }
    expect(dupes).toEqual([])
  })
})

describe('paper trading placeholders', () => {
  it.each(PAPER_TRADING.filter(([key]) => /\{\w+\}/.test(key)))(
    'keeps every placeholder in %j',
    (key, value) => {
      expect(placeholders(value)).toEqual(placeholders(key))
    },
  )

  it('invents no placeholder in a key that has none', () => {
    for (const [key, value] of PAPER_TRADING) {
      if (/\{\w+\}/.test(key)) continue
      expect([key, placeholders(value)]).toEqual([key, []])
    }
  })
})
