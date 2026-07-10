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
