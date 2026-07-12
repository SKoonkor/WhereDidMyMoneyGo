"""Emergency-fund pooling and progress math."""

from src.analytics.emergency_fund import emergency_fund_status
from tests.conftest import make_df


def test_single_account_balance():
    df = make_df([
        {"Account": "Savings", "Income/Expense": "Income", "Amount": 30_000},
        {"Account": "Savings", "Income/Expense": "Expense", "Amount": 5_000},
        {"Account": "Bank", "Income/Expense": "Income", "Amount": 99_000},
    ])
    s = emergency_fund_status(df, "Savings", monthly_required=5_000, target_months=3)
    assert s["current_balance"] == 25_000
    assert s["target"] == 15_000
    assert s["percentage"] == 100.0            # capped at 100
    assert s["months_covered"] == 5.0


def test_multi_account_pool_and_transfer_nets_to_zero():
    df = make_df([
        {"Account": "Savings", "Income/Expense": "Income", "Amount": 20_000},
        {"Account": "Cash", "Income/Expense": "Income", "Amount": 10_000},
        # A transfer between two pooled accounts must not change the pool total.
        {"Account": "Savings", "Income/Expense": "Transfer-Out", "Amount": 8_000},
        {"Account": "Cash", "Income/Expense": "Transfer-In", "Amount": 8_000},
    ])
    s = emergency_fund_status(df, ["Savings", "Cash"],
                              monthly_required=6_000, target_months=2)
    assert s["current_balance"] == 30_000      # transfer nets to zero
    assert s["target"] == 12_000


def test_zero_target_and_zero_monthly_guarded():
    df = make_df([{"Account": "Savings", "Income/Expense": "Income",
                   "Amount": 1_000}])
    s = emergency_fund_status(df, "Savings", monthly_required=0, target_months=0)
    assert s["target"] == 0
    assert s["percentage"] == 0
    assert s["months_covered"] == 0


def test_empty_ledger_is_zero():
    s = emergency_fund_status(make_df([]), "Savings",
                              monthly_required=5_000, target_months=3)
    assert s["current_balance"] == 0
