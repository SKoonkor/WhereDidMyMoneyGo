"""Financial goals persistence (config/goals.json).

Goals are stored as a simple {name: target_amount} mapping. "Emergency Fund" is
always present and acts as the base of the savings pool — selecting any other
goal adds its target on top of the Emergency Fund target.
"""

from __future__ import annotations

import json
from pathlib import Path

GOALS_PATH = Path("config/goals.json")
SELECTED_PATH = Path("config/goals_selected.json")
GOALS_FACTORS_PATH = Path("config/goals_factors.json")
EMERGENCY_FUND = "Emergency Fund"
DEFAULT_GOALS = {EMERGENCY_FUND: 60000}


def load_goals(path: str | Path = GOALS_PATH) -> dict:
    """Load goals from disk, seeding the Emergency Fund default if missing."""
    path = Path(path)
    if not path.exists():
        save_goals(DEFAULT_GOALS, path)
        return dict(DEFAULT_GOALS)
    with open(path, "r", encoding="utf-8") as f:
        goals = json.load(f)
    # Guarantee the Emergency Fund always exists.
    if EMERGENCY_FUND not in goals:
        goals[EMERGENCY_FUND] = DEFAULT_GOALS[EMERGENCY_FUND]
    return goals


def save_goals(goals: dict, path: str | Path = GOALS_PATH) -> None:
    """Persist the full goals mapping to disk."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(goals, f, indent=2, ensure_ascii=False)


def load_selected(path: str | Path = SELECTED_PATH) -> list[str]:
    """Load the persisted set of goals the user has ticked into the savings pool.

    The Emergency Fund is always the pool base and is never stored here (it is
    implied). Returns the goal names that are still present in ``goals.json``.
    """
    path = Path(path)
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            names = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    goals = load_goals()
    return [n for n in names if n in goals and n != EMERGENCY_FUND]


def save_selected(selected: list[str], path: str | Path = SELECTED_PATH) -> None:
    """Persist the ticked goals (Emergency Fund is implied and excluded)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    clean = [n for n in (selected or []) if n != EMERGENCY_FUND]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(clean, f, indent=2, ensure_ascii=False)


# ── xTimes rule factors ───────────────────────────────────────────────────────
# Each goal may carry a factor (default 1) that scales its target before it counts
# as reached. Stored separately so goals.json stays a plain {name: amount} mapping.

def load_factors(path: str | Path = GOALS_FACTORS_PATH) -> dict:
    """Load {goal name: factor}; a missing/broken file yields an empty map."""
    path = Path(path)
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_factors(factors: dict, path: str | Path = GOALS_FACTORS_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(factors, f, indent=2, ensure_ascii=False)


def goal_factor(name: str, factors: dict | None = None) -> float:
    """This goal's multiplier (>= 1); defaults to 1 when unset."""
    factors = load_factors() if factors is None else factors
    try:
        return max(float(factors.get(name, 1) or 1), 1.0)
    except (TypeError, ValueError):
        return 1.0


def pool_target(ef_target: float, goals: dict, selected: list[str],
                factors: dict | None = None) -> float:
    """Savings-pool cap = Emergency Fund target + the single **highest** effective
    goal (amount x factor) among the ticked goals. The Emergency Fund has no
    factor; with nothing ticked the cap is just the EF target."""
    factors = load_factors() if factors is None else factors
    best = max((goals.get(g, 0.0) * goal_factor(g, factors) for g in selected),
               default=0.0)
    return ef_target + best


def add_goal(name: str, amount: float, factor: float = 1.0,
             path: str | Path = GOALS_PATH) -> dict:
    """Add (or update) a goal + its xTimes factor. Returns the goals mapping."""
    name = name.strip()
    goals = load_goals(path)
    goals[name] = float(amount)
    save_goals(goals, path)
    factors = load_factors()
    try:
        factor = max(float(factor or 1), 1.0)
    except (TypeError, ValueError):
        factor = 1.0
    if factor > 1:
        factors[name] = factor
    else:
        factors.pop(name, None)      # keep the file free of no-op factors
    save_factors(factors)
    return goals


def remove_goal(name: str, path: str | Path = GOALS_PATH) -> dict:
    """Remove a goal (Emergency Fund cannot be removed). Returns the mapping."""
    goals = load_goals(path)
    if name != EMERGENCY_FUND:
        goals.pop(name, None)
        save_goals(goals, path)
        factors = load_factors()
        if factors.pop(name, None) is not None:
            save_factors(factors)
    return goals


def reorder_goals(order: list[str], path: str | Path = GOALS_PATH) -> dict:
    """Persist a new display order for the (non-Emergency-Fund) goals.

    The Emergency Fund stays first (it's the pool base, not shown in the list);
    goals named in ``order`` follow in that order, and any goal not listed is
    appended to keep the mapping complete. Returns the reordered mapping.
    """
    goals = load_goals(path)
    new: dict = {}
    if EMERGENCY_FUND in goals:
        new[EMERGENCY_FUND] = goals[EMERGENCY_FUND]
    for name in order:
        if name in goals and name not in new:
            new[name] = goals[name]
    for name, amt in goals.items():  # safety: keep anything not in `order`
        if name not in new:
            new[name] = amt
    save_goals(new, path)
    return new
