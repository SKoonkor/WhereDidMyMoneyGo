"""Emergency fund progress tracking."""

import pandas as pd


def emergency_fund_status(
    df: pd.DataFrame,
    savings_accounts,
    monthly_required: float,
    target_months: int,
) -> dict:
    """
    Calculate emergency fund progress across one or more savings accounts.

    ``savings_accounts`` may be a single account name or a list of names; the
    current balance is the combined signed balance of all of them. Transfers
    between two pooled accounts net to zero, so the pool total is unaffected.

    Returns a dict with:
        current_balance, target, percentage, months_covered
    """
    if isinstance(savings_accounts, str):
        savings_accounts = [savings_accounts]
    savings_df = df[df["Account"].isin(savings_accounts)].copy()

    def sign(row):
        t = row["Income/Expense"]
        # Transfers are stored as paired rows; for a single account the
        # Transfer-In leg is money arriving, Transfer-Out is money leaving.
        if t in ("Income", "Transfer-In"):
            return row["Amount"]
        elif t in ("Expense", "Saving", "Transfer-Out"):
            return -row["Amount"]
        return 0.0

    savings_df["signed_amount"] = savings_df.apply(sign, axis=1)
    current_balance = savings_df["signed_amount"].sum()

    target = monthly_required * target_months
    percentage = min((current_balance / target) * 100, 100) if target > 0 else 0
    months_covered = current_balance / monthly_required if monthly_required > 0 else 0

    return {
        "current_balance": round(current_balance, 2),
        "target": round(target, 2),
        "percentage": round(percentage, 1),
        "months_covered": round(months_covered, 1),
        "monthly_required": monthly_required,
        "target_months": target_months,
    }
