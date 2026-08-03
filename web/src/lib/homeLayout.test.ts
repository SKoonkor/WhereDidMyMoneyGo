import { describe, it, expect } from 'vitest'
import {
  DEFAULT_HOME_LAYOUT, SLOTS_PER_ROW,
  normalizeLayout, addLarge, removeItem, reorderItems, setCollapsed, setSlot,
  availableLarge, applyLegacyCollapsed, newUid,
  type HomeLayout,
} from './homeLayout'

const L = (...items: HomeLayout['items']): HomeLayout => ({ version: 1, items })
const uids = (l: HomeLayout) => l.items.map((i) => i.uid)
const widgets = (l: HomeLayout) => l.items.map((i) => i.widget)

describe('DEFAULT_HOME_LAYOUT', () => {
  // Regression guard: existing users must see today's Home until they edit it.
  it('is exactly the pre-editor Home, in order', () => {
    expect(widgets(DEFAULT_HOME_LAYOUT)).toEqual(
      ['networth', 'flow', 'budget', 'pool', 'accounts'])
    expect(uids(DEFAULT_HOME_LAYOUT)).toEqual(
      ['networth', 'flow', 'budget', 'pool', 'accounts'])
    expect(DEFAULT_HOME_LAYOUT.items.every((i) => i.collapsed === undefined)).toBe(true)
  })
})

describe('normalizeLayout', () => {
  it('falls back to the default for unusable values', () => {
    for (const bad of [undefined, null, 'garbage', 42, [], {}, { version: 2, items: [] }]) {
      expect(normalizeLayout(bad)).toEqual(DEFAULT_HOME_LAYOUT)
    }
  })

  it('keeps a deliberately empty Home', () => {
    expect(normalizeLayout({ version: 1, items: [] })).toEqual({ version: 1, items: [] })
  })

  it('round-trips a valid layout', () => {
    expect(normalizeLayout(DEFAULT_HOME_LAYOUT)).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('drops unknown widget ids and junk entries', () => {
    const out = normalizeLayout({
      version: 1,
      items: [
        { uid: 'flow', widget: 'flow' },
        { uid: 'x', widget: 'from-a-newer-build' },
        null,
        'nope',
        { uid: 'accounts', widget: 'accounts' },
      ],
    })
    expect(widgets(out)).toEqual(['flow', 'accounts'])
  })

  it('de-dupes singletons but keeps repeatables', () => {
    const out = normalizeLayout(L(
      { uid: 'flow', widget: 'flow' },
      { uid: 'flow-2', widget: 'flow' },
      { uid: 'smallrow', widget: 'smallrow' },
      { uid: 'smallrow-2', widget: 'smallrow' },
    ))
    expect(widgets(out)).toEqual(['flow', 'smallrow', 'smallrow'])
  })

  it('regenerates missing and colliding uids, preserving distinct ones', () => {
    const out = normalizeLayout({
      version: 1,
      items: [
        { uid: 'smallrow', widget: 'smallrow' },
        { uid: 'smallrow', widget: 'smallrow' }, // collides
        { widget: 'smallrow' },                  // missing
        { uid: 'flow', widget: 'flow' },
      ],
    })
    expect(uids(out)).toEqual(['smallrow', 'smallrow-2', 'smallrow-3', 'flow'])
    expect(new Set(uids(out)).size).toBe(4)
  })

  it('normalizes slots to a fixed length and nulls unknown small ids', () => {
    const out = normalizeLayout(L(
      { uid: 'smallrow', widget: 'smallrow', slots: ['mini-pie', 'bogus', 'mini-inout', 'mini-bars'] as never },
    ))
    expect(out.items[0].slots).toEqual(['mini-pie', null, 'mini-inout'])
    expect(out.items[0].slots).toHaveLength(SLOTS_PER_ROW)
  })

  it('gives a slotless container empty slots', () => {
    const out = normalizeLayout(L({ uid: 'smallrow', widget: 'smallrow' }))
    expect(out.items[0].slots).toEqual([null, null, null])
  })

  it('strips slots from non-container widgets', () => {
    const out = normalizeLayout(L(
      { uid: 'flow', widget: 'flow', slots: ['mini-pie', null, null] },
    ))
    expect(out.items[0].slots).toBeUndefined()
  })

  it('keeps collapsed only when true', () => {
    const out = normalizeLayout(L(
      { uid: 'flow', widget: 'flow', collapsed: true },
      { uid: 'budget', widget: 'budget', collapsed: false },
    ))
    expect(out.items[0].collapsed).toBe(true)
    expect(out.items[1].collapsed).toBeUndefined()
  })
})

describe('newUid', () => {
  it('uses the plain widget id when free, then numbers', () => {
    expect(newUid('smallrow', new Set())).toBe('smallrow')
    expect(newUid('smallrow', new Set(['smallrow']))).toBe('smallrow-2')
    expect(newUid('smallrow', new Set(['smallrow', 'smallrow-2']))).toBe('smallrow-3')
  })
})

describe('addLarge', () => {
  it('appends a singleton that is absent', () => {
    const out = addLarge(L({ uid: 'flow', widget: 'flow' }), 'budget')
    expect(widgets(out)).toEqual(['flow', 'budget'])
    expect(out.items[1].uid).toBe('budget')
  })

  it('refuses a singleton that is already present', () => {
    const l = L({ uid: 'flow', widget: 'flow' })
    expect(addLarge(l, 'flow')).toBe(l)
  })

  it('appends repeatables with fresh uids and empty slots', () => {
    let l = addLarge(L(), 'smallrow')
    l = addLarge(l, 'smallrow')
    expect(uids(l)).toEqual(['smallrow', 'smallrow-2'])
    expect(l.items[1].slots).toEqual([null, null, null])
  })

  it('does not mutate the input', () => {
    const l = L({ uid: 'flow', widget: 'flow' })
    addLarge(l, 'budget')
    expect(l.items).toHaveLength(1)
  })
})

describe('removeItem', () => {
  it('removes by uid and leaves the rest in order', () => {
    const l = L(
      { uid: 'flow', widget: 'flow' },
      { uid: 'smallrow', widget: 'smallrow' },
      { uid: 'budget', widget: 'budget' },
    )
    expect(widgets(removeItem(l, 'smallrow'))).toEqual(['flow', 'budget'])
    expect(removeItem(l, 'nope').items).toHaveLength(3)
  })
})

describe('reorderItems', () => {
  const l = L(
    { uid: 'networth', widget: 'networth' },
    { uid: 'flow', widget: 'flow' },
    { uid: 'budget', widget: 'budget' },
  )

  it('applies the given order', () => {
    expect(uids(reorderItems(l, ['budget', 'networth', 'flow'])))
      .toEqual(['budget', 'networth', 'flow'])
  })

  it('ignores foreign and duplicated uids without dropping items', () => {
    expect(uids(reorderItems(l, ['ghost', 'budget', 'budget', 'flow'])))
      .toEqual(['budget', 'flow', 'networth'])
  })

  it('keeps items the order forgot', () => {
    expect(uids(reorderItems(l, ['flow']))).toEqual(['flow', 'networth', 'budget'])
    expect(uids(reorderItems(l, []))).toEqual(['networth', 'flow', 'budget'])
  })
})

describe('setCollapsed', () => {
  it('sets and clears the flag', () => {
    const l = L({ uid: 'flow', widget: 'flow' })
    const folded = setCollapsed(l, 'flow', true)
    expect(folded.items[0].collapsed).toBe(true)
    expect(setCollapsed(folded, 'flow', false).items[0]).not.toHaveProperty('collapsed')
    expect(l.items[0].collapsed).toBeUndefined() // input untouched
  })
})

describe('setSlot', () => {
  const l = L({ uid: 'smallrow', widget: 'smallrow', slots: [null, null, null] })

  it('fills and clears a slot', () => {
    const filled = setSlot(l, 'smallrow', 1, 'mini-pie')
    expect(filled.items[0].slots).toEqual([null, 'mini-pie', null])
    expect(setSlot(filled, 'smallrow', 1, null).items[0].slots).toEqual([null, null, null])
  })

  it('ignores out-of-range indices and non-containers', () => {
    expect(setSlot(l, 'smallrow', 3, 'mini-pie')).toBe(l)
    expect(setSlot(l, 'smallrow', -1, 'mini-pie')).toBe(l)
    const other = L({ uid: 'flow', widget: 'flow' })
    expect(setSlot(other, 'flow', 0, 'mini-pie').items[0].slots).toBeUndefined()
  })
})

describe('availableLarge', () => {
  it('excludes present singletons but always offers the container', () => {
    // 'limits', 'goals' and 'debts' ship off the default Home, so they show up as
    // addable — a new widget joins the picker without joining everyone's Home.
    expect(availableLarge(DEFAULT_HOME_LAYOUT)).toEqual(['limits', 'goals', 'debts', 'smallrow'])
    expect(availableLarge(L({ uid: 'smallrow', widget: 'smallrow' })))
      .toEqual(['networth', 'flow', 'budget', 'limits', 'pool', 'goals', 'accounts', 'debts', 'smallrow'])
  })
})

describe('applyLegacyCollapsed', () => {
  it('folds exactly the ids carried over from localStorage', () => {
    const out = applyLegacyCollapsed(DEFAULT_HOME_LAYOUT, ['flow', 'pool', 'gone'])
    const folded = out.items.filter((i) => i.collapsed).map((i) => i.uid)
    expect(folded).toEqual(['flow', 'pool'])
    expect(DEFAULT_HOME_LAYOUT.items.every((i) => !i.collapsed)).toBe(true)
  })
})
