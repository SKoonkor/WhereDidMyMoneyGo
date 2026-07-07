"""Transaction export — the neutral, documented schema.

Shapes the cleaned ledger DataFrame (src/io/store.py::load_transactions) into
the export layout used by the CSV/Excel downloads. The layout mirrors the
ledger one-to-one so an export is a faithful, re-importable copy:

    Id, Date, Type, Account, Category, Subcategory, Amount, Currency,
    Note, Description, TransferId

Conventions (also documented in the README): Date is "YYYY-MM-DD HH:MM:SS";
Type is one of Income, Expense, Transfer-In/Out, Adjustment-In/Out; for
transfers, Category holds the counter-account and both halves share a
TransferId; Adjustment rows are reconciliation entries.
"""

import pandas as pd

EXPORT_COLUMNS = ["Id", "Date", "Type", "Account", "Category", "Subcategory",
                  "Amount", "Currency", "Note", "Description", "TransferId"]

DATE_FMT = "%Y-%m-%d %H:%M:%S"


def export_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Shape a cleaned ledger DataFrame into the neutral export layout,
    oldest row first. Handles an empty frame (headers-only export)."""
    out = pd.DataFrame({
        "Id": df["Id"],
        "Date": df["Period"].dt.strftime(DATE_FMT),
        "Type": df["Income/Expense"],
        "Account": df["Account"],
        "Category": df["Category"],
        "Subcategory": df["Subcategory"],
        "Amount": df["Amount"],
        "Currency": df["Currency"],
        "Note": df["Note"],
        "Description": df["Description"],
        "TransferId": df["TransferId"].fillna(""),
    })
    return out.reindex(columns=EXPORT_COLUMNS)


def export_filename(scope: str, fmt: str) -> str:
    """`scope` is "all" or a month like "2026-07"; `fmt` is "csv"/"xlsx"."""
    return f"transactions_{scope}.{fmt}"
