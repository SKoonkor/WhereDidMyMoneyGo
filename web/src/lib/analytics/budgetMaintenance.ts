// Keeping the budget config in step with category renames and deletions.
//
// Everything the budget stores is keyed by category or subcategory NAME, so
// renaming a category in Manage used to silently detach its bucket assignment
// (the row falls back to Wants) and would do worse to a spending limit: the cap
// stops applying to the renamed category while a ghost row lingers at 0 spent.
//
// Pure so it can be tested without Dexie; db.ts calls it inside the same
// read-write transaction as the rename itself.
import type { BudgetCfg, Bucket } from '../../data/defaults'

export type BudgetRename =
  | { kind: 'category'; from: string; to: string }
  /** `into` is where the rows were funnelled (Other, or Unknown). */
  | { kind: 'category-delete'; name: string; into: string }
  | { kind: 'sub'; category: string; from: string; to: string }
  | { kind: 'sub-delete'; category: string; name: string }

// Move a key, leaving the map untouched when there's nothing under it.
function moveKey<V>(map: Record<string, V>, from: string, to: string): Record<string, V> {
  if (!(from in map) || from === to) return map
  const out: Record<string, V> = {}
  for (const [k, v] of Object.entries(map)) out[k === from ? to : k] = v
  return out
}

function dropKey<V>(map: Record<string, V>, key: string): Record<string, V> {
  if (!(key in map)) return map
  const out = { ...map }
  delete out[key]
  return out
}

export function remapBudget(cfg: BudgetCfg, op: BudgetRename): BudgetCfg {
  const assignments: Record<string, Bucket> = { ...cfg.assignments }
  const subAssignments = { ...cfg.subAssignments }
  const limits = {
    ...cfg.limits,
    categories: { ...cfg.limits.categories },
    subcategories: { ...cfg.limits.subcategories },
  }

  switch (op.kind) {
    case 'category': {
      return {
        ...cfg,
        assignments: moveKey(assignments, op.from, op.to),
        subAssignments: moveKey(subAssignments, op.from, op.to),
        limits: {
          ...limits,
          categories: moveKey(limits.categories, op.from, op.to),
          subcategories: moveKey(limits.subcategories, op.from, op.to),
        },
      }
    }

    case 'category-delete': {
      // The bucket assignment follows the rows into Other/Unknown, matching what
      // the ledger does. The LIMIT deliberately does not: a cap the user set on
      // "Travel" must not silently start capping "Other", which holds unrelated
      // spending. Dropping it is the honest outcome.
      const bucket = assignments[op.name]
      const next = dropKey(assignments, op.name)
      if (bucket && !(op.into in next)) next[op.into] = bucket
      return {
        ...cfg,
        assignments: next,
        subAssignments: dropKey(subAssignments, op.name),
        limits: {
          ...limits,
          categories: dropKey(limits.categories, op.name),
          subcategories: dropKey(limits.subcategories, op.name),
        },
      }
    }

    case 'sub': {
      const subs = subAssignments[op.category]
      if (subs) subAssignments[op.category] = moveKey(subs, op.from, op.to)
      const subLimits = limits.subcategories[op.category]
      if (subLimits) limits.subcategories[op.category] = moveKey(subLimits, op.from, op.to)
      return { ...cfg, subAssignments, limits }
    }

    case 'sub-delete': {
      // Rows keep their category and just lose the tag, so the category-level
      // assignment and limit still cover them — only the sub-specific entries go.
      const subs = subAssignments[op.category]
      if (subs) {
        const kept = dropKey(subs, op.name)
        if (Object.keys(kept).length) subAssignments[op.category] = kept
        else delete subAssignments[op.category]
      }
      const subLimits = limits.subcategories[op.category]
      if (subLimits) {
        const kept = dropKey(subLimits, op.name)
        if (Object.keys(kept).length) limits.subcategories[op.category] = kept
        else delete limits.subcategories[op.category]
      }
      return { ...cfg, subAssignments, limits }
    }
  }
}
