"""Transaction category persistence (config/transaction_categories.json).

Stored as {"income": {category: [subcategories]}, "expense": {...}}.
Income categories have no subcategories by design (slide 14); expense
categories may have them (slide 17). New categories/subcategories can be
added from the category picker in the transaction form.
"""

from __future__ import annotations

import json
from pathlib import Path

CATEGORIES_PATH = Path("config/transaction_categories.json")

DEFAULT_CATEGORIES = {
    "income": {
        "Gift": [], "Salary": [], "Petty cash": [], "Bonus": [], "Other": [],
    },
    "expense": {
        "Bills": ["Rent", "Phone", "Internet", "Electricity", "Water", "Tax"],
        "Food": ["Breakfast", "Lunch", "Dinner", "Eating out", "Beverage", "Ingredients"],
        "Household": ["Kitchen", "Electronics", "Furniture", "Toiletries", "Tools"],
        "Social Life": ["Friend", "Alumni", "Trip", "Nightout"],
        "Car": ["Fuel", "Maintenance", "Parking"],
        "Travel": ["Flights", "Transportation"],
        "Transport": ["Bus", "Subway", "Taxi"],
        "Health": ["Supplements", "Gym", "Hospital", "Medicine"],
        "Family": [],
        "Beauty": ["Haircut", "Makeup", "Cosmetics", "Accessories"],
        "Apparel": ["Clothing", "Fashion", "Shoes", "Laundry"],
        "Education": ["School supplies", "Textbooks", "Books", "Schooling"],
        "Gift": [],
        "Other": [],
        "Subscription": [],
    },
}


def load_categories(path: str | Path = CATEGORIES_PATH) -> dict:
    """Load categories from disk, seeding the defaults if missing."""
    path = Path(path)
    if not path.exists():
        save_categories(DEFAULT_CATEGORIES, path)
        return json.loads(json.dumps(DEFAULT_CATEGORIES))
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_categories(cats: dict, path: str | Path = CATEGORIES_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cats, f, indent=2, ensure_ascii=False)


def add_category(kind: str, name: str, path: str | Path = CATEGORIES_PATH) -> dict:
    """Add a top-level category for `kind` ("income" | "expense")."""
    cats = load_categories(path)
    cats.setdefault(kind, {}).setdefault(name.strip(), [])
    save_categories(cats, path)
    return cats


def add_subcategory(kind: str, category: str, name: str,
                    path: str | Path = CATEGORIES_PATH) -> dict:
    """Add a subcategory under an existing expense category."""
    cats = load_categories(path)
    subs = cats.setdefault(kind, {}).setdefault(category, [])
    name = name.strip()
    if name and name not in subs:
        subs.append(name)
    save_categories(cats, path)
    return cats


def rename_category(kind: str, old: str, new: str,
                    path: str | Path = CATEGORIES_PATH) -> dict:
    """Rename a top-level category, keeping its position and subcategories.

    No-op if ``old`` is absent or ``new`` already exists in that kind (the caller
    guards the clash and surfaces a message).
    """
    cats = load_categories(path)
    new = new.strip()
    group = cats.get(kind, {})
    if not new or old not in group or new in group:
        return cats
    # Rebuild the ordered dict, swapping the key in place.
    cats[kind] = {(new if k == old else k): v for k, v in group.items()}
    save_categories(cats, path)
    return cats


def delete_category(kind: str, name: str,
                    path: str | Path = CATEGORIES_PATH) -> dict:
    """Remove a top-level category (and its subcategories). No-op if absent."""
    cats = load_categories(path)
    cats.get(kind, {}).pop(name, None)
    save_categories(cats, path)
    return cats


def rename_subcategory(kind: str, category: str, old: str, new: str,
                       path: str | Path = CATEGORIES_PATH) -> dict:
    """Rename a subcategory within a category, keeping order. No-op on clash."""
    cats = load_categories(path)
    new = new.strip()
    subs = cats.get(kind, {}).get(category)
    if subs is None or not new or old not in subs or new in subs:
        return cats
    cats[kind][category] = [new if s == old else s for s in subs]
    save_categories(cats, path)
    return cats


def delete_subcategory(kind: str, category: str, name: str,
                       path: str | Path = CATEGORIES_PATH) -> dict:
    """Remove a subcategory from a category (no-op if absent)."""
    cats = load_categories(path)
    subs = cats.get(kind, {}).get(category)
    if subs is not None:
        cats[kind][category] = [s for s in subs if s != name]
        save_categories(cats, path)
    return cats


def move_subcategory(from_cat: str, to_cat: str, sub: str,
                     path: str | Path = CATEGORIES_PATH) -> dict:
    """Move a subcategory between two expense categories (drag-and-drop board).

    Removes ``sub`` from ``from_cat`` and appends it to ``to_cat`` (no duplicate
    if it already lives there). No-op if either category is missing or equal.
    """
    cats = load_categories(path)
    exp = cats.get("expense", {})
    if from_cat == to_cat or from_cat not in exp or to_cat not in exp:
        return cats
    exp[from_cat] = [s for s in exp[from_cat] if s != sub]
    if sub and sub not in exp[to_cat]:
        exp[to_cat].append(sub)
    save_categories(cats, path)
    return cats


def set_structure(income: list[str], expense: list[str],
                  path: str | Path = CATEGORIES_PATH) -> dict:
    """Persist a new category order / kind assignment from the manage board.

    ``income`` and ``expense`` are ordered category-name lists. Each category
    carries its existing subcategory list wherever it now lives. A name that
    would collide in the target kind stays in its original kind (the on-screen
    move is rejected on the next re-render).
    """
    cats = load_categories(path)
    old_income = cats.get("income", {})
    old_expense = cats.get("expense", {})
    inc_set, exp_set = set(income), set(expense)

    def subs_for(name: str, target_kind: str) -> list:
        # Prefer subcats from the kind it's landing in, else from the kind it moved from.
        if target_kind == "income":
            return old_income.get(name, old_expense.get(name, []))
        return old_expense.get(name, old_income.get(name, []))

    def build(order, this_set, other_set, old_this, old_other, kind):
        out: dict = {}
        for name in order:
            if name in out:
                continue
            was_both = name in old_income and name in old_expense
            # A name newly appearing in *both* kinds is a move onto a same-named
            # category (a collision) — keep it only in its original kind.
            if name in other_set and not was_both and name not in old_this:
                continue
            out[name] = subs_for(name, kind)
        return out

    cats["income"] = build(income, inc_set, exp_set, old_income, old_expense, "income")
    cats["expense"] = build(expense, exp_set, inc_set, old_expense, old_income, "expense")
    save_categories(cats, path)
    return cats
