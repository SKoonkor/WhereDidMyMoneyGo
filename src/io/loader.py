"""Transaction data loader and validator."""

import pandas as pd
from pathlib import Path

REQUIRED_COLUMNS = [
    "Period", "Accounts", "Category", "Subcategory",
    "Note", "Income/Expense", "Description", "Amount", "Currency"
]

TYPE_MAP = {
    "Exp.":        "Expense",
    "Expense":     "Expense",
    "Income":      "Income",
    "Transfer-In": "Transfer-In",
    "Transfer-Out":"Transfer-Out",
    "Saving":      "Saving",
    "Transfer":    "Transfer",
}


def load_transactions(filepath: str | Path) -> pd.DataFrame:
    """Load and clean transactions from an .xlsx file.

    A missing file yields an empty, correctly-shaped ledger so a fresh install
    with no transactions still runs.
    """
    filepath = Path(filepath)
    if filepath.exists():
        df = pd.read_excel(filepath)
    else:
        df = pd.DataFrame(columns=[
            "Period", "Accounts", "Category", "Subcategory", "Note",
            "Income/Expense", "Description", "Amount", "Currency",
        ])

    # Stable identity = position in the raw file (survives the sort below);
    # used by the transaction recorder to address rows for edit/delete.
    df["RowId"] = df.index

    # Rename 'Accounts' → 'Account' to match schema
    if "Accounts" in df.columns and "Account" not in df.columns:
        df = df.rename(columns={"Accounts": "Account"})

    # Drop legacy / duplicate columns
    df = df.drop(columns=[c for c in ["GBP", "Accounts.1"] if c in df.columns])

    # Validate required columns
    for col in REQUIRED_COLUMNS:
        actual_col = "Account" if col == "Accounts" else col
        if actual_col not in df.columns:
            raise ValueError(f"Missing required column: {actual_col}")

    # Parse dates
    df["Period"] = pd.to_datetime(df["Period"], errors="coerce")
    df = df.dropna(subset=["Period"])

    # Normalize text fields
    for col in ["Account", "Category", "Subcategory", "Note", "Description", "Currency"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
            df[col] = df[col].replace("nan", "")

    # Standardize Income/Expense labels
    df["Income/Expense"] = df["Income/Expense"].str.strip().map(
        lambda x: TYPE_MAP.get(x, x)
    )

    # Ensure Amount is numeric
    df["Amount"] = pd.to_numeric(df["Amount"], errors="coerce").fillna(0.0)

    # Sort by date ascending
    df = df.sort_values("Period").reset_index(drop=True)

    return df
