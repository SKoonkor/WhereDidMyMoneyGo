"""Config persistence: default-seeding and save↔load round-trips (tmp paths)."""

from src.analytics.budget import load_budget, save_budget, DEFAULT_BUDGET
from src.analytics.transaction_categories import (
    load_categories, save_categories, add_subcategory, DEFAULT_CATEGORIES)
from src.analytics.income_tax import load_tax, save_tax, DEFAULT_TAX


def test_budget_seeds_defaults_when_absent(tmp_path):
    path = tmp_path / "budget.json"
    cfg = load_budget(path)                       # file created on first load
    assert path.exists()
    assert cfg["percentages"] == DEFAULT_BUDGET["percentages"]


def test_budget_backfills_missing_keys(tmp_path):
    path = tmp_path / "budget.json"
    save_budget({"fixed_income": 999}, path)      # partial file
    cfg = load_budget(path)
    assert cfg["fixed_income"] == 999
    assert "percentages" in cfg and "assignments" in cfg   # backfilled


def test_categories_roundtrip(tmp_path):
    path = tmp_path / "cats.json"
    save_categories(DEFAULT_CATEGORIES, path)
    add_subcategory("expense", "Bills", "Insurance", path)
    cats = load_categories(path)
    assert "Insurance" in cats["expense"]["Bills"]
    # No duplicate on re-add.
    add_subcategory("expense", "Bills", "Insurance", path)
    assert cats["expense"]["Bills"].count("Insurance") <= 1


def test_tax_seeds_and_roundtrips(tmp_path):
    path = tmp_path / "tax.json"
    cfg = load_tax(path)
    assert cfg["country"] == DEFAULT_TAX["country"]
    cfg["allowances"]["ssf"] = 12_345
    save_tax(cfg, path)
    assert load_tax(path)["allowances"]["ssf"] == 12_345


def test_tax_backfills_missing_allowance_keys(tmp_path):
    path = tmp_path / "tax.json"
    save_tax({"country": "Thailand", "allowances": {"ssf": 100}}, path)
    cfg = load_tax(path)
    assert cfg["allowances"]["ssf"] == 100
    assert "rmf" in cfg["allowances"]             # missing keys backfilled to 0
    assert cfg["allowances"]["rmf"] == 0
