"""Data-access layer for the Dash app.

Loads transactions once (cached at module level) from the SQLite ledger and
provides relative-window helpers anchored to the latest transaction date.
"""

from functools import lru_cache
import pandas as pd

from src.io.store import load_transactions
from src.processing.summaries import filter_by_date
from src.utils.config import load_config


@lru_cache(maxsize=1)
def get_config() -> dict:
    return load_config("config")


def currency() -> str:
    """Display currency from settings.toml (rows also carry their own Currency).

    Read live through the cached config so a changed ``base_currency`` applies as
    soon as Settings saves (``refresh_config`` clears the cache) — no restart.
    """
    return (get_config().get("settings", {})
            .get("general", {}).get("base_currency", "THB"))


@lru_cache(maxsize=1)
def get_df() -> pd.DataFrame:
    """Load and cache the cleaned transactions DataFrame."""
    return load_transactions()


@lru_cache(maxsize=1)
def month_periods() -> pd.PeriodIndex:
    """Cached month (``freq='M'``) key for every row, aligned to ``get_df()``.

    Lets the Transactions page filter a month without recomputing
    ``.dt.to_period('M')`` over the whole frame on every render. Invalidated
    alongside ``get_df`` in :func:`refresh`.
    """
    return get_df()["Period"].dt.to_period("M")


def refresh() -> None:
    """Drop the cached DataFrame after the transactions file is modified."""
    get_df.cache_clear()
    month_periods.cache_clear()


def refresh_config() -> None:
    """Drop the cached config after settings.toml is modified.

    Values read through ``get_config()`` (e.g. ``currency()`` and the
    emergency-fund settings) then reflect the new file on the next render.
    """
    get_config.cache_clear()


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


def privacy_config() -> dict:
    """Auto-privacy settings: hide amounts after the home page sits idle."""
    p = settings().get("privacy", {})
    return {
        "auto_enabled": bool(p.get("auto_enabled", True)),
        "idle_seconds": int(p.get("idle_seconds", 10)),
    }
