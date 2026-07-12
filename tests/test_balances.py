"""Running per-account balance signs and cumulation."""

from src.processing.balances import compute_account_balances
from tests.conftest import make_df


def test_signed_amounts_per_type():
    df = make_df([
        {"Period": "2026-01-01", "Account": "Bank", "Income/Expense": "Income",
         "Amount": 1_000},
        {"Period": "2026-01-02", "Account": "Bank", "Income/Expense": "Expense",
         "Amount": 300},
        {"Period": "2026-01-03", "Account": "Bank", "Income/Expense": "Transfer-Out",
         "Amount": 200},
        {"Period": "2026-01-03", "Account": "Savings", "Income/Expense": "Transfer-In",
         "Amount": 200},
        {"Period": "2026-01-04", "Account": "Bank", "Income/Expense": "Adjustment-Out",
         "Amount": 50},
    ])
    out = compute_account_balances(df)
    bank = out[out["Account"] == "Bank"].sort_values("Period")
    # 1000 - 300 - 200 - 50 = 450 final running balance for Bank.
    assert bank["balance"].iloc[-1] == 450
    savings = out[out["Account"] == "Savings"]
    assert savings["balance"].iloc[-1] == 200


def test_transfer_conserves_total_across_accounts():
    df = make_df([
        {"Period": "2026-01-01", "Account": "Bank", "Income/Expense": "Income",
         "Amount": 500},
        {"Period": "2026-01-02", "Account": "Bank", "Income/Expense": "Transfer-Out",
         "Amount": 500},
        {"Period": "2026-01-02", "Account": "Cash", "Income/Expense": "Transfer-In",
         "Amount": 500},
    ])
    out = compute_account_balances(df)
    assert out["signed_amount"].sum() == 500        # transfer nets to zero overall
