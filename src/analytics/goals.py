"""Financial goals persistence (config/goals.json).

Goals are stored as a simple {name: target_amount} mapping. "Emergency Fund" is
always present and acts as the base of the savings pool — selecting any other
goal adds its target on top of the Emergency Fund target.
"""

import json
from pathlib import Path

GOALS_PATH = Path("config/goals.json")
SELECTED_PATH = Path("config/goals_selected.json")
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


def add_goal(name: str, amount: float, path: str | Path = GOALS_PATH) -> dict:
    """Add (or update) a goal and persist. Returns the updated mapping."""
    goals = load_goals(path)
    goals[name.strip()] = float(amount)
    save_goals(goals, path)
    return goals


def remove_goal(name: str, path: str | Path = GOALS_PATH) -> dict:
    """Remove a goal (Emergency Fund cannot be removed). Returns the mapping."""
    goals = load_goals(path)
    if name != EMERGENCY_FUND:
        goals.pop(name, None)
        save_goals(goals, path)
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
