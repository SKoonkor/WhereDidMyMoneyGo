"""Account balance and net worth calculations."""

import pandas as pd


def compute_account_balances(df: pd.DataFrame) -> pd.DataFrame:
    """
    Returns a DataFrame with a running balance per account.
    Columns: Period, Account, Amount, Income/Expense, signed_amount, balance
    """
    df = df.copy()

    def sign(row):
        t = row["Income/Expense"]
        if t == "Income":
            return row["Amount"]
        elif t == "Expense":
            return -row["Amount"]
        elif t == "Transfer-In":
            # Money arriving into the account listed in 'Account'
            return row["Amount"]
        elif t == "Transfer-Out":
            # Money leaving the account listed in 'Account'
            return -row["Amount"]
        elif t == "Transfer":
            return 0.0
        elif t == "Saving":
            return -row["Amount"]
        elif t == "Income Balance":
            # Reconciliation adjustment bringing tracked balance up to actual.
            return row["Amount"]
        elif t == "Expense Balance":
            # Reconciliation adjustment bringing tracked balance down to actual.
            return -row["Amount"]
        return 0.0

    df["signed_amount"] = df.apply(sign, axis=1)
    df = df.sort_values("Period")
    df["balance"] = df.groupby("Account")["signed_amount"].cumsum()
    return df
