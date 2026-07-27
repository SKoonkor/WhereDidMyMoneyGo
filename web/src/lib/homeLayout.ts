// The Home screen's arrangement: which boxes appear, in what order, folded or
// not, and what sits in each small-widget container's slots.
//
// Pure — no React, no Dexie. db.ts owns the storage and imports from here (the
// same direction as DEFAULT_TAX in lib/analytics/income_tax.ts); the reverse
// would drag Dexie into every test that touches a layout.

export type LargeWidgetId =
  | 'networth'  // the net-worth hero
  | 'flow'      // Money Flow plot
  | 'budget'    // 50/30/20 bars
  | 'pool'      // Savings Pool gauge
  | 'accounts'  // per-account balances
  | 'smallrow'  // a row of 1-3 small preview tiles

export type SmallWidgetId =
  | 'mini-trend'  // 3-month net-worth sparkline
  | 'mini-bars'   // Needs/Wants/Savings bars
  | 'mini-pie'    // share-of-budget ring
  | 'mini-pool'   // savings-pool arc
  | 'mini-inout'  // this month's income / output

export const LARGE_IDS: readonly LargeWidgetId[] = [
  'networth', 'flow', 'budget', 'pool', 'accounts', 'smallrow',
]
export const SMALL_IDS: readonly SmallWidgetId[] = [
  'mini-trend', 'mini-bars', 'mini-pie', 'mini-pool', 'mini-inout',
]

// Widgets that may appear more than once. Everything else is a singleton, so the
// picker offers it only while it is off the Home screen.
export const REPEATABLE: ReadonlySet<LargeWidgetId> = new Set<LargeWidgetId>(['smallrow'])

export const SLOTS_PER_ROW = 3

export interface HomeItem {
  // Instance key: the drag key and the collapse key. Singletons use their widget
  // id, which is what lets the pre-0.4 localStorage collapse keys still match.
  uid: string
  widget: LargeWidgetId
  collapsed?: boolean // omitted = expanded
  slots?: (SmallWidgetId | null)[] // only on 'smallrow'; always length SLOTS_PER_ROW
}

export interface HomeLayout {
  version: 1
  items: HomeItem[]
}

// Today's hard-coded Home, in order — so an existing user sees no change until
// they open the editor. The order here is asserted in homeLayout.test.ts.
export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  version: 1,
  items: [
    { uid: 'networth', widget: 'networth' },
    { uid: 'flow', widget: 'flow' },
    { uid: 'budget', widget: 'budget' },
    { uid: 'pool', widget: 'pool' },
    { uid: 'accounts', widget: 'accounts' },
  ],
}

const isLarge = (v: unknown): v is LargeWidgetId =>
  typeof v === 'string' && (LARGE_IDS as readonly string[]).includes(v)
const isSmall = (v: unknown): v is SmallWidgetId =>
  typeof v === 'string' && (SMALL_IDS as readonly string[]).includes(v)

const clone = (l: HomeLayout): HomeLayout => ({
  version: 1,
  items: l.items.map((i) => ({ ...i, ...(i.slots ? { slots: [...i.slots] } : {}) })),
})

const emptySlots = (): (SmallWidgetId | null)[] => Array(SLOTS_PER_ROW).fill(null)

// A fresh instance key. Singletons get their plain widget id (keeping uids
// readable and the legacy collapse keys aligned); repeatables get a numbered
// suffix. `taken` is threaded in so a caller can generate several in a row.
export function newUid(widget: LargeWidgetId, taken: Set<string>): string {
  if (!taken.has(widget)) return widget
  for (let n = 2; ; n++) {
    const uid = `${widget}-${n}`
    if (!taken.has(uid)) return uid
  }
}

// Coerce anything (a config row written by another build, a hand-edited backup)
// into a layout we can render. A *missing* row is the caller's problem — this
// falls back to the default only when the value is unusable, so a deliberately
// empty Home ({ version: 1, items: [] }) survives a round trip.
export function normalizeLayout(raw: unknown): HomeLayout {
  if (!raw || typeof raw !== 'object') return DEFAULT_HOME_LAYOUT
  const r = raw as Partial<HomeLayout>
  if (r.version !== 1 || !Array.isArray(r.items)) return DEFAULT_HOME_LAYOUT

  const items: HomeItem[] = []
  const taken = new Set<string>()
  const seen = new Set<LargeWidgetId>()

  for (const entry of r.items) {
    if (!entry || typeof entry !== 'object') continue
    const src = entry as Partial<HomeItem>
    // Unknown ids come from a newer build; drop them rather than render a hole.
    if (!isLarge(src.widget)) continue
    if (!REPEATABLE.has(src.widget)) {
      if (seen.has(src.widget)) continue
      seen.add(src.widget)
    }

    const uid = typeof src.uid === 'string' && src.uid && !taken.has(src.uid)
      ? src.uid
      : newUid(src.widget, taken)
    taken.add(uid)

    const item: HomeItem = { uid, widget: src.widget }
    if (src.collapsed === true) item.collapsed = true
    if (src.widget === 'smallrow') {
      const from = Array.isArray(src.slots) ? src.slots : []
      item.slots = Array.from({ length: SLOTS_PER_ROW }, (_, i) =>
        (isSmall(from[i]) ? (from[i] as SmallWidgetId) : null))
    }
    items.push(item)
  }
  return { version: 1, items }
}

export function addLarge(l: HomeLayout, widget: LargeWidgetId): HomeLayout {
  if (!REPEATABLE.has(widget) && l.items.some((i) => i.widget === widget)) return l
  const uid = newUid(widget, new Set(l.items.map((i) => i.uid)))
  const item: HomeItem = { uid, widget }
  if (widget === 'smallrow') item.slots = emptySlots()
  return { version: 1, items: [...clone(l).items, item] }
}

export function removeItem(l: HomeLayout, uid: string): HomeLayout {
  return { version: 1, items: clone(l).items.filter((i) => i.uid !== uid) }
}

// Reorder to match `order`. Unknown uids are ignored and anything `order` forgot
// keeps its relative position at the end — a stale drag commit must never drop a
// widget the user still has.
export function reorderItems(l: HomeLayout, order: string[]): HomeLayout {
  const by = new Map(l.items.map((i) => [i.uid, i]))
  const items: HomeItem[] = []
  const used = new Set<string>()
  for (const uid of order) {
    const item = by.get(uid)
    if (item && !used.has(uid)) { items.push(item); used.add(uid) }
  }
  for (const item of l.items) if (!used.has(item.uid)) items.push(item)
  return clone({ version: 1, items })
}

export function setCollapsed(l: HomeLayout, uid: string, collapsed: boolean): HomeLayout {
  return {
    version: 1,
    items: clone(l).items.map((i) => {
      if (i.uid !== uid) return i
      const next = { ...i }
      if (collapsed) next.collapsed = true
      else delete next.collapsed
      return next
    }),
  }
}

export function setSlot(
  l: HomeLayout, uid: string, index: number, widget: SmallWidgetId | null,
): HomeLayout {
  if (index < 0 || index >= SLOTS_PER_ROW) return l
  return {
    version: 1,
    items: clone(l).items.map((i) => {
      if (i.uid !== uid || i.widget !== 'smallrow') return i
      const slots = i.slots ? [...i.slots] : emptySlots()
      slots[index] = widget
      return { ...i, slots }
    }),
  }
}

// What the "+ Add widget" picker offers: every singleton that is currently off
// the Home screen, plus the repeatables (always addable).
export function availableLarge(l: HomeLayout): LargeWidgetId[] {
  const present = new Set(l.items.map((i) => i.widget))
  return LARGE_IDS.filter((id) => REPEATABLE.has(id) || !present.has(id))
}

// One-time migration of the pre-0.4 localStorage 'home-collapsed' set, whose
// entries are the old CollapsibleCard ids — which are exactly the singleton uids.
export function applyLegacyCollapsed(l: HomeLayout, ids: string[]): HomeLayout {
  const fold = new Set(ids)
  return {
    version: 1,
    items: clone(l).items.map((i) => (fold.has(i.uid) ? { ...i, collapsed: true } : i)),
  }
}
