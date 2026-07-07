"""Data-access layer for the Dash app.

Loads transactions once (cached at module level), relabels the currency to THB,
and provides relative-window helpers anchored to the latest transaction date.
"""

from functools import lru_cache
import pandas as pd

from src.io.loader import load_transactions
from src.processing.summaries import filter_by_date
from src.utils.config import load_config

CURRENCY = "THB"


@lru_cache(maxsize=1)
def get_config() -> dict:
    return load_config("config")


@lru_cache(maxsize=1)
def get_df() -> pd.DataFrame:
    """Load and cache the cleaned transactions DataFrame (currency = THB)."""
    cfg = get_config()
    data_dir = cfg.get("settings", {}).get("general", {}).get("data_dir", "data")
    df = load_transactions(f"{data_dir}/raw/transactions.xlsx")
    df = df.copy()
    df["Currency"] = CURRENCY
    return df


def refresh() -> None:
    """Drop the cached DataFrame after the transactions file is modified."""
    get_df.cache_clear()


def account_names() -> list[str]:
    """Accounts available in the transaction recorder (config/accounts.json)."""
    from src.analytics.accounts import load_accounts
    return load_accounts()


def reference_date() -> pd.Timestamp:
    """The 'today' anchor for relative windows = latest transaction date.

    Falls back to the current date when there are no transactions yet, so the
    app runs on a fresh install with an empty ledger.
    """
    latest = get_df()["Period"].max()
    if pd.isna(latest):
        return pd.Timestamp.now().normalize()
    return latest.normalize()


def window(df: pd.DataFrame, days: int) -> pd.DataFrame:
    """Return rows within the last `days` days up to the reference date."""
    ref = reference_date()
    start = ref - pd.Timedelta(days=days)
    # Include the whole reference day.
    end = ref + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    return filter_by_date(df, str(start), str(end))


def default_range(days: int = 90) -> tuple[str, str]:
    """Return (start, end) ISO date strings for the default window."""
    ref = reference_date()
    start = ref - pd.Timedelta(days=days)
    return start.date().isoformat(), ref.date().isoformat()


def settings() -> dict:
    return get_config().get("settings", {})


def emergency_fund_config() -> dict:
    ef = settings().get("emergency_fund", {})
    return {
        "savings_account": ef.get("savings_account", "Savings"),
        "monthly_required": ef.get("monthly_required_expenses", 20000.0),
        "target_months": ef.get("target_months", 3),
    }
