"""Settings leave-guard: the pure change-summary diff used to warn before leaving
the page with unsaved edits."""

# Instantiate the Dash app first so the settings page module can register.
import src.app.app  # noqa: F401
from src.app.pages.settings import _settings_changes


def _base():
    return {
        "app_name": "Money Tracker", "base_currency": "THB",
        "monthly": 20000.0, "months": 3, "accounts": ["Savings"],
        "privacy_auto": True, "privacy_seconds": 10,
        "income_sels": [], "paid_sels": ["Bills / Tax"],
        "lang_disabled": False, "lang_second": "th",
    }


def test_no_changes_when_identical():
    assert _settings_changes(_base(), _base()) == []


def test_single_field_change_reports_old_and_new():
    cur = _base(); cur["app_name"] = "Budgeter"
    lines = _settings_changes(_base(), cur)
    assert len(lines) == 1
    assert "Money Tracker" in lines[0] and "Budgeter" in lines[0]


def test_multiple_changes_listed():
    cur = _base(); cur["base_currency"] = "USD"; cur["months"] = 6
    lines = _settings_changes(_base(), cur)
    assert len(lines) == 2


def test_boolean_fields_render_human_readable():
    cur = _base(); cur["privacy_auto"] = False; cur["lang_disabled"] = True
    lines = _settings_changes(_base(), cur)
    joined = " | ".join(lines)
    assert "on" in joined and "off" in joined          # auto-privacy on → off
    assert "allowed" in joined and "disabled" in joined  # toggle allowed → disabled


def test_income_categories_change_reports_all_income_and_selection():
    cur = _base(); cur["income_sels"] = ["Salary", "Bonus"]
    lines = _settings_changes(_base(), cur)
    assert len(lines) == 1
    assert "All income" in lines[0]                 # old (empty) side
    assert "Salary" in lines[0] and "Bonus" in lines[0]


def test_tax_payment_subcategories_change_lists_members():
    cur = _base(); cur["paid_sels"] = ["Bills / Tax", "Bills / WHT"]
    lines = _settings_changes(_base(), cur)
    assert len(lines) == 1
    assert "Bills / Tax" in lines[0] and "Bills / WHT" in lines[0]
