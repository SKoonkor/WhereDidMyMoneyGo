"""Budget period windows, income base, and per-bucket summary."""

from datetime import date

from src.analytics.budget import (
    budget_period, budget_income, spending_by_category, budget_summary,
    NEEDS, WANTS, SAVINGS)
from tests.conftest import make_df


def test_budget_period_reset_day_one():
    start, end = budget_period(date(2026, 3, 15), reset_day=1)
    assert start == date(2026, 3, 1) and end == date(2026, 4, 1)


def test_budget_period_before_reset_uses_previous_window():
    start, end = budget_period(date(2026, 3, 5), reset_day=10)
    assert start == date(2026, 2, 10) and end == date(2026, 3, 10)


def test_budget_period_clamps_to_month_length():
    # reset_day 31 in February clamps to the 28th.
    start, end = budget_period(date(2026, 2, 15), reset_day=31)
    assert start == date(2026, 1, 31) and end == date(2026, 2, 28)


def test_budget_income_fixed_vs_rolling():
    cfg_fixed = {"mode": "fixed", "fixed_income": 37_500}
    assert budget_income(make_df([]), cfg_fixed) == 37_500

    df = make_df([
        {"Period": "2026-01-25", "Income/Expense": "Income", "Amount": 30_000},
        {"Period": "2026-02-25", "Income/Expense": "Income", "Amount": 50_000},
    ])
    cfg_roll = {"mode": "rolling", "rolling_months": 6}
    # Both months are completed relative to March -> mean(30k, 50k) = 40k.
    assert budget_income(df, cfg_roll, today=date(2026, 3, 10)) == 40_000


def test_spending_by_category_window_and_type():
    df = make_df([
        {"Period": "2026-03-05", "Income/Expense": "Expense", "Amount": 100,
         "Category": "Food"},
        {"Period": "2026-03-06", "Income/Expense": "Expense", "Amount": 50,
         "Category": "Food"},
        {"Period": "2026-03-07", "Income/Expense": "Income", "Amount": 999,
         "Category": "Salary"},                       # income excluded
        {"Period": "2026-04-02", "Income/Expense": "Expense", "Amount": 70,
         "Category": "Food"},                          # outside window
    ])
    got = spending_by_category(df, date(2026, 3, 1), date(2026, 4, 1))
    assert got == {"Food": 150.0}


def test_budget_summary_buckets():
    df = make_df([
        {"Period": "2026-03-10", "Income/Expense": "Expense", "Amount": 10_000,
         "Category": "Bills"},
        {"Period": "2026-03-12", "Income/Expense": "Expense", "Amount": 5_000,
         "Category": "Social Life"},
    ])
    cfg = {"mode": "fixed", "fixed_income": 37_500,
           "percentages": {NEEDS: 50, WANTS: 30, SAVINGS: 20},
           "assignments": {"Bills": NEEDS, "Social Life": WANTS},
           "reset_day": 1}
    s = budget_summary(df, cfg, today=date(2026, 3, 15))
    b = s["buckets"]
    assert b[NEEDS]["target"] == 18_750 and b[NEEDS]["spent"] == 10_000
    assert b[NEEDS]["remaining"] == 8_750
    assert b[WANTS]["spent"] == 5_000 and b[WANTS]["remaining"] == 6_250
    # Savings spent = income - needs - wants; remaining = actual - target.
    assert b[SAVINGS]["spent"] == 22_500
    assert b[SAVINGS]["remaining"] == 15_000
