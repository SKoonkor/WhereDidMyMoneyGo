"""Date filtering helpers for transaction DataFrames."""

import pandas as pd


def filter_by_date(df: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    """Filter transactions between start and end date strings (inclusive)."""
    mask = (df["Period"] >= pd.Timestamp(start)) & (df["Period"] <= pd.Timestamp(end))
    return df[mask].copy()
