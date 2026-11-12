import { describe, it, expect } from 'vitest'
import { THEME_IDS, THEMES, coerceThemeId, isThemeId } from './themes'
import { relativeLuminance } from './lib/chart/theme'
// Read as text through Vite (the app's tsconfig has no Node types).
import css from './theme.css?raw'
import pixelCss from './pixel.css?raw'
import indexHtml from '../index.html?raw'

// Guards for the theme registry. The pre-paint script in index.html keeps its
// own copy of the theme list, so it is checked against themes.ts here. Each
// theme's palette is parsed out of theme.css, and the Pixel palette is held to
// WCAG contrast (Light and Dark are the app's original palettes and unchanged).

const TOKENS = [
  '--bg', '--surface', '--surface-2', '--ink', '--muted', '--border', '--border-soft',
  '--btn-bg', '--btn-fg', '--accent', '--income', '--expense', '--day-shade',
]

function tokens(id: string): Record<string, string> {
  // Dark's block is shared with bare `:root`, so match the selector anywhere in the list.
  const re = new RegExp(`:root\\[data-theme='${id}'\\][^{]*\\{([^}]*)\\}`)
  const m = re.exec(css)
  if (!m) throw new Error(`no token block for ${id}`)
  const out: Record<string, string> = {}
  for (const mm of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[mm[1]] = mm[2].trim()
  return out
}

const contrast = (a: string, b: string) => {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)]
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

describe('theme registry', () => {
  it('the index.html pre-paint script knows the same ids, schemes and status-bar colours', () => {
    const m = /var themes = (\{[^}]*\});/.exec(indexHtml)
    expect(m).not.toBeNull()
    const inline = new Function(`return ${m![1]}`)() as Record<string, [string, string]>
    expect(Object.keys(inline).sort()).toEqual([...THEME_IDS].sort())
    for (const id of THEME_IDS) expect(inline[id]).toEqual([THEMES[id].scheme, THEMES[id].chrome])
  })

  it('unknown ids coerce to the default', () => {
    expect(isThemeId('pixel')).toBe(true)
    expect(isThemeId('neon')).toBe(false)
    expect(isThemeId('toString')).toBe(false)
    expect(coerceThemeId(null)).toBe('dark')
  })
})

describe.each(THEME_IDS)('theme %s', (id) => {
  it('defines every colour token the app reads', () => {
    const t = tokens(id)
    for (const k of TOKENS) expect(t[k], k).toBeTruthy()
  })
})

// --on-gold and friends live in pixel.css's own :root block.
function pixelVars(): Record<string, string> {
  const m = /:root\[data-theme='pixel'\]\s*\{([^}]*)\}/.exec(pixelCss)
  if (!m) throw new Error('no :root block in pixel.css')
  const out: Record<string, string> = {}
  for (const mm of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[mm[1]] = mm[2].trim()
  return out
}

describe('index.html pre-paint script', () => {
  // Run the real inline script against a stub DOM: it must whitelist ids and
  // never leave the page unthemed.
  const src = /<script>\s*([\s\S]*?)<\/script>/.exec(indexHtml)![1]
  function run(stored: string | null) {
    const attrs: Record<string, string> = {}
    const meta = { content: '', setAttribute(_: string, v: string) { this.content = v } }
    const doc = {
      documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } },
      querySelector: () => meta,
    }
    const ls = { getItem: (k: string) => (k === 'pref-theme' ? stored : null) }
    new Function('document', 'localStorage', src)(doc, ls)
    return { theme: attrs['data-theme'], scheme: attrs['data-scheme'], meta: meta.content }
  }
  it('applies a stored theme with its scheme and status-bar colour', () => {
    expect(run('pixel')).toEqual({ theme: 'pixel', scheme: 'dark', meta: '#0c1a1c' })
    expect(run('light')).toEqual({ theme: 'light', scheme: 'light', meta: '#1abc9c' })
  })
  it('falls back to dark for missing, unknown or prototype-key values', () => {
    for (const v of [null, 'neon', 'constructor', '__proto__']) {
      expect(run(v)).toMatchObject({ theme: 'dark', scheme: 'dark' })
    }
  })
})

// Split a selector list on top-level commas only (not those inside :is()/:where()).
function splitTop(sel: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of sel) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  out.push(cur.trim())
  return out.filter(Boolean)
}

describe('pixel.css scoping', () => {
  // Light and Dark must never see a Pixel rule. Every selector is scoped to
  // :root[data-theme='pixel'], except the few that only exist on Pixel-only or
  // picker markup.
  const ALLOWED = /^(\.pixelated|\.pixel-hero|\.theme-cards?|\.theme-card[\w.-]*|\.theme-swatch[\w.:\[\]='-]*)(\s|$)/
  it('has no unscoped rule outside the picker / pixel-art classes', () => {
    const body = pixelCss
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@font-face\s*\{[^}]*\}/g, '')
    const bad: string[] = []
    for (const m of body.matchAll(/([^{};]+)\{/g)) {
      const sel = m[1].trim()
      if (!sel || sel.startsWith('@')) continue
      for (const part of splitTop(sel)) {
        if (!part.startsWith(":root[data-theme='pixel']") && !ALLOWED.test(part)) bad.push(part)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('pixel.css cascade guard', () => {
  it('ghost buttons keep light ink (dark ink on their dark fill was 1.47:1)', () => {
    expect(pixelCss).toMatch(/:root\[data-theme='pixel'\] \.btn\.ghost \{[^}]*color: var\(--ink\)/)
  })
  it('the dark-ink-on-gold list is weightless (:where), so button variants can override it', () => {
    // An :is() list takes the weight of its heaviest member; with a 3-class chip
    // in it, every .btn.ghost/.danger/.ret-reset override lost and rendered dark
    // ink on a dark fill. Keep this list in :where().
    expect(pixelCss).toMatch(/:where\(\s*\.btn, \.btn-accent,/)
    expect(pixelCss).not.toMatch(/:is\(\s*\.btn, \.btn-accent,/)
  })
})

describe('pixel palette contrast', () => {
  const t = tokens('pixel')
  const v = pixelVars()
  it('body text reads on every surface (≥ 4.5:1)', () => {
    for (const bg of ['--bg', '--surface', '--surface-2', '--day-shade']) {
      expect(contrast(t['--ink'], t[bg]), `ink on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('muted labels read on every surface (≥ 4.5:1)', () => {
    for (const bg of ['--bg', '--surface', '--surface-2']) {
      expect(contrast(t['--muted'], t[bg]), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('--on-gold reads on the gold, mint, tomato and muted fills, and the amber banner button (≥ 4.5:1)', () => {
    expect(v['--on-gold']).toBeTruthy()
    for (const fill of [t['--accent'], t['--income'], t['--expense'], t['--muted'], '#f39c12']) {
      expect(contrast(v['--on-gold'], fill), `on-gold on ${fill}`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('gold, income and expense read as text on every surface (≥ 4.5:1)', () => {
    for (const fg of ['--accent', '--income', '--expense']) {
      for (const bg of ['--bg', '--surface', '--surface-2']) {
        expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('the reminder banners read: gold title and muted body on the banner fill', () => {
    const banner = /\.recon-reminder \{[^}]*background:\s*(#[0-9a-f]{6})/i.exec(pixelCss)![1]
    expect(contrast(t['--accent'], banner)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--muted'], banner)).toBeGreaterThanOrEqual(4.5)
  })
  it('button text reads on the plain button fill', () => {
    expect(contrast(t['--btn-fg'], t['--btn-bg'])).toBeGreaterThanOrEqual(4.5)
  })
})
