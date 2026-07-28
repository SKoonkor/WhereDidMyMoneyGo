// Per-goal savings — an allocation layer sitting ON TOP of the real savings pool.
//
// The pool itself is unchanged: it is still the combined balance of the accounts
// the user ticked as savings accounts (`savingsBalance` in ./goals). What's new is
// that the user can earmark parts of that balance for individual goals. Whatever
// isn't earmarked is UNALLOCATED — the "whole savings budget available".
//
// Nothing here moves real money. A GoalMove only changes which goal a slice of the
// existing pool belongs to, which is exactly why these rows live in their own
// Dexie table rather than in `transactions`: an allocation has no account, and
// every account-keyed function in the app (accountBalances, accountUsage, the
// Money Flow account list, Reconcile) would otherwise invent a phantom account.
//
// Pure and testable; persistence is in db.ts.
import { signedAmount } from '../balances'
import type { Tone } from './budget'
import type { Txn } from '../../db'

// The unallocated pool, as an endpoint of a move. Empty string can never collide
// with a real goal: GoalsPage's add form trims the name and rejects a blank one.
export const UNALLOCATED = ''

export interface GoalMove {
  id: number
  /** ISO date (YYYY-MM-DD). */
  period: string
  /** Goal name, or UNALLOCATED. */
  from: string
  /** Goal name, or UNALLOCATED. */
  to: string
  /** Always positive — the direction lives in from/to. */
  amount: number
  note?: string
  /** Set when this move was created by tagging a transfer with a goal. */
  transferId?: string
}

/** A move with no id yet (before it reaches Dexie). */
export type NewGoalMove = Omit<GoalMove, 'id'>

// How much of the pool each goal currently holds. A goal can go negative if more
// was taken out of it than it held — that's a real state the user has to fix, not
// an error to swallow.
export function allocations(moves: GoalMove[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of moves) {
    if (m.to !== UNALLOCATED) out[m.to] = (out[m.to] ?? 0) + m.amount
    if (m.from !== UNALLOCATED) out[m.from] = (out[m.from] ?? 0) - m.amount
  }
  return out
}

// What's left of the pool once every goal has taken its share.
//
// A Goal → Goal move adds and subtracts the same amount here, so it nets to zero
// on its own — which is the whole reason direct goal-to-goal moves need no special
// handling anywhere else.
//
// Goes NEGATIVE when money leaves the savings accounts without first being taken
// out of a goal. That is the state the Home warning exists for.
export function unallocatedAmount(poolBalance: number, moves: GoalMove[]): number {
  let allocated = 0
  for (const v of Object.values(allocations(moves))) allocated += v
  return round2(poolBalance - allocated)
}

export interface GoalStanding {
  name: string
  allocated: number
  target: number
  /** allocated / target, 0 when there's no target to divide by. Not clamped. */
  ratio: number
  tone: Tone
  /** The Emergency Fund, whose target comes from Settings rather than the goal list. */
  isEmergencyFund: boolean
}

// Tone for a goal's funding. Inverted against the budget bars — for a goal, MORE
// is better — so it reuses the thresholds `bucketTone` already applies to the
// Savings bucket (green ≥90%, orange 65–90%, red below) rather than inventing a
// third scheme for the user to learn.
export function goalTone(allocated: number, target: number): Tone {
  const raw = target ? (allocated / target) * 100 : 0
  return raw >= 90 ? 'good' : raw >= 65 ? 'warn' : 'bad'
}

// Every goal that can hold money, in the user's own priority order: the Emergency
// Fund first (it is pinned at the top of the Goals page), then the goal list in
// its stored — that is, drag-ordered — sequence.
//
// Deliberately independent of `GoalsCfg.selected`: ticking a goal sizes the pool
// TARGET, it has nothing to do with where money is allowed to sit.
export function goalStandings(
  moves: GoalMove[],
  goals: Record<string, number>,
  efTarget: number,
  efName: string,
): GoalStanding[] {
  const held = allocations(moves)
  const mk = (name: string, target: number, isEmergencyFund: boolean): GoalStanding => {
    const allocated = round2(held[name] ?? 0)
    return {
      name,
      allocated,
      target,
      ratio: target > 0 ? allocated / target : 0,
      tone: goalTone(allocated, target),
      isEmergencyFund,
    }
  }
  return [
    mk(efName, efTarget, true),
    ...Object.keys(goals).map((name) => mk(name, goals[name], false)),
  ]
}

// ── The savings activity list ────────────────────────────────────────────────

export type ActivityRow =
  | { kind: 'txn'; day: string; txn: Txn; delta: number }
  | { kind: 'move'; day: string; move: GoalMove }

// Everything that explains how the pool reached its current split: every row that
// touched a pool account (with its signed effect on the pool) plus every goal move.
//
// "Touched a pool account" is the same test `savingsBalance` uses, so the list and
// the balance can never tell different stories — an Income paid straight into a
// savings account belongs here just as much as a transfer does.
export function savingsActivity(
  txns: Txn[], moves: GoalMove[], poolAccounts: string[],
): ActivityRow[] {
  const pool = new Set(poolAccounts)
  const rows: ActivityRow[] = []
  for (const t of txns) {
    if (pool.has(t.account)) {
      rows.push({ kind: 'txn', day: t.period.slice(0, 10), txn: t, delta: signedAmount(t.type, t.amount) })
    }
  }
  for (const m of moves) rows.push({ kind: 'move', day: m.period.slice(0, 10), move: m })

  // Newest day first; within a day the real movements come before the allocation
  // moves that followed them, then newest-added first (ids are auto-increment).
  rows.sort((a, b) =>
    b.day.localeCompare(a.day)
    || rank(a) - rank(b)
    || idOf(b) - idOf(a))
  return rows
}

const rank = (r: ActivityRow) => (r.kind === 'txn' ? 0 : 1)
const idOf = (r: ActivityRow) => (r.kind === 'txn' ? r.txn.id : r.move.id)

const round2 = (n: number) => Math.round(n * 100) / 100
