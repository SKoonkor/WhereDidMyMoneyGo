"""Tax settings accessor: the income/tax-payment *selections* (whole category or
"Category / Subcategory"), and back-compat migration of the legacy keys.

The ledger_env fixture seeds the expense tree ``Bills → [Tax, Rent]``, so the legacy
subcategory "Tax" resolves to the encoded selection "Bills / Tax"."""

from src.app.data import tax_config, refresh_config
from src.utils.config import save_settings


def test_tax_config_defaults(ledger_env):
    # No [tax] section → tax all income; the "Tax" payment default resolves to its
    # parent category in the expense tree.
    refresh_config()
    tc = tax_config()
    assert tc["income_selections"] == []
    assert tc["paid_selections"] == ["Bills / Tax"]


def test_tax_config_migrates_legacy_scalar(ledger_env):
    # An old config with a single paid_subcategory scalar migrates to an encoded list.
    save_settings({"tax": {"paid_subcategory": "Tax"}})
    refresh_config()
    assert tax_config()["paid_selections"] == ["Bills / Tax"]


def test_tax_config_migrates_legacy_subcategory_list(ledger_env):
    # A legacy paid_subcategories list of bare sub names → resolved encodings; an
    # unresolvable name (no parent in the tree) is kept as a best-effort bare value.
    save_settings({"tax": {"paid_subcategories": ["Tax", "WHT"]}})
    refresh_config()
    assert tax_config()["paid_selections"] == ["Bills / Tax", "WHT"]


def test_tax_config_migrates_legacy_income_categories(ledger_env):
    # Legacy income_categories (bare category names) are already whole-category
    # selections and pass through unchanged.
    save_settings({"tax": {"income_categories": ["Salary", "Bonus"]}})
    refresh_config()
    assert tax_config()["income_selections"] == ["Salary", "Bonus"]


def test_tax_config_roundtrips_selections(ledger_env):
    save_settings({"tax": {"income_selections": ["Salary", "Bonus / Base"],
                           "paid_selections": ["Bills / Tax", "Bills"]}})
    refresh_config()
    tc = tax_config()
    assert tc["income_selections"] == ["Salary", "Bonus / Base"]
    assert tc["paid_selections"] == ["Bills / Tax", "Bills"]
    txt = (ledger_env / "config" / "settings.toml").read_text()
    assert "income_selections" in txt and "paid_selections" in txt


def test_tax_config_empty_paid_falls_back_to_default(ledger_env):
    save_settings({"tax": {"income_selections": [], "paid_selections": []}})
    refresh_config()
    tc = tax_config()
    assert tc["income_selections"] == []
    assert tc["paid_selections"] == ["Bills / Tax"]
