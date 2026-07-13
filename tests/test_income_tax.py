"""Income-tax calculation: brackets, allowance caps, and ledger helpers."""

import pandas as pd

from src.analytics.income_tax import (
    TH_SPEC, expense_deduction, apply_allowances, progressive_tax,
    income_tax_status, gross_income_for_year, tax_paid_for_year,
    tax_payments_for_year, ledger_years)
from tests.conftest import make_df


def test_progressive_tax_known_point():
    # 340,000 taxable: 150k@0 + 150k@5% (7,500) + 40k@10% (4,000) = 11,500.
    tax, rows, marginal = progressive_tax(340_000, TH_SPEC["brackets"])
    assert tax == 11_500
    assert marginal == 0.10
    # Only bands with income appear (the 0% band has income, so 3 rows here).
    assert [r["rate"] for r in rows] == [0.0, 0.05, 0.10]


def test_progressive_tax_zero_income():
    tax, rows, marginal = progressive_tax(0, TH_SPEC["brackets"])
    assert tax == 0 and rows == [] and marginal == 0.0


def test_expense_deduction_capped_at_100k():
    assert expense_deduction(100_000, TH_SPEC) == 50_000     # 50% below the cap
    assert expense_deduction(1_000_000, TH_SPEC) == 100_000  # capped


def test_status_500k_no_allowances():
    s = income_tax_status(500_000, {}, TH_SPEC)
    assert s["expense_deduction"] == 100_000
    assert s["allowance_total"] == 60_000        # personal allowance only
    assert s["net_taxable"] == 340_000
    assert s["tax_due"] == 11_500
    assert round(s["effective_rate"], 5) == round(11_500 / 500_000, 5)


def test_ssf_capped_by_percentage_then_absolute():
    # gross 500k: 30% = 150k < 200k absolute cap -> counts 150k.
    total, breakdown = apply_allowances(500_000, {"ssf": 300_000}, TH_SPEC)
    ssf = next(b["amount"] for b in breakdown if b["key"] == "ssf")
    assert ssf == 150_000
    # gross 1M: 30% = 300k, but the 200k absolute cap wins.
    _, breakdown2 = apply_allowances(1_000_000, {"ssf": 300_000}, TH_SPEC)
    assert next(b["amount"] for b in breakdown2 if b["key"] == "ssf") == 200_000


def test_retirement_group_aggregate_cap():
    # provident + ssf + rmf together are capped at 500,000.
    total, breakdown = apply_allowances(
        5_000_000, {"provident": 400_000, "ssf": 200_000, "rmf": 500_000}, TH_SPEC)
    retire = sum(b["amount"] for b in breakdown
                 if b["key"] in ("provident", "ssf", "rmf"))
    assert retire == 500_000


def test_donation_capped_at_10pct_of_net():
    # Donations cap on income after expense deduction and all other allowances.
    # gross 500k, expense 100k, personal 60k -> net-before-donation 340k -> cap 34k.
    total, breakdown = apply_allowances(500_000, {"donations": 100_000}, TH_SPEC)
    donation = next(b["amount"] for b in breakdown if b["key"] == "donations")
    assert donation == 34_000


def test_remaining_and_refund_sign():
    owed = income_tax_status(500_000, {}, TH_SPEC, tax_paid=5_000)
    assert owed["remaining"] == 6_500                 # 11,500 - 5,000
    refund = income_tax_status(500_000, {}, TH_SPEC, tax_paid=15_000)
    assert refund["remaining"] == -3_500              # negative => refund


def test_flag_and_count_allowances():
    total, breakdown = apply_allowances(
        800_000, {"spouse": True, "children": 3}, TH_SPEC)
    by = {b["key"]: b["amount"] for b in breakdown}
    assert by["personal"] == 60_000
    assert by["spouse"] == 60_000
    assert by["children"] == 90_000                   # 3 x 30,000


def test_parents_count_capped_at_max_units():
    _, breakdown = apply_allowances(800_000, {"parents": 9}, TH_SPEC)
    parents = next(b["amount"] for b in breakdown if b["key"] == "parents")
    assert parents == 120_000                         # 4 x 30,000 (max 4 units)


def _year_df():
    return make_df([
        {"Period": "2026-01-10", "Income/Expense": "Income", "Amount": 40_000,
         "Account": "Bank", "Category": "Salary"},
        {"Period": "2026-07-10", "Income/Expense": "Income", "Amount": 60_000,
         "Account": "Bank", "Category": "Salary"},
        {"Period": "2025-05-10", "Income/Expense": "Income", "Amount": 99_000,
         "Account": "Bank", "Category": "Salary"},
        {"Period": "2026-03-10", "Income/Expense": "Expense", "Amount": 2_000,
         "Account": "Bank", "Category": "Bills", "Subcategory": "Tax"},
        {"Period": "2026-09-10", "Income/Expense": "Expense", "Amount": 3_000,
         "Account": "Bank", "Category": "Bills", "Subcategory": "Tax"},
    ])


def test_gross_income_for_year_filters_by_year_and_type():
    df = _year_df()
    assert gross_income_for_year(df, 2026) == 100_000
    assert gross_income_for_year(df, 2025) == 99_000


def test_tax_paid_for_year_sums_subcategory():
    df = _year_df()
    assert tax_paid_for_year(df, "Tax", 2026) == 5_000
    assert tax_paid_for_year(df, "Tax", 2025) == 0
    assert tax_paid_for_year(df, None, 2026) == 0


def test_tax_payments_for_year_lists_rows_oldest_first():
    df = _year_df()
    payments = tax_payments_for_year(df, "Tax", 2026)
    assert payments == [
        {"date": "10-Mar-2026", "amount": 2_000.0},
        {"date": "10-Sep-2026", "amount": 3_000.0},
    ]
    # Sum of the listed rows equals the summed figure shown on the page.
    assert sum(p["amount"] for p in payments) == tax_paid_for_year(df, "Tax", 2026)
    assert tax_payments_for_year(df, "Tax", 2025) == []
    assert tax_payments_for_year(df, None, 2026) == []


def test_ledger_years_includes_current():
    df = _year_df()
    years = ledger_years(df, current=2027)
    assert years == sorted(years, reverse=True)
    assert 2027 in years and 2026 in years and 2025 in years
