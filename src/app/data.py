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
    # Prefer the list key; fall back to the legacy single-account scalar.
    raw = ef.get("savings_accounts")
    if raw is None:
        legacy = ef.get("savings_account")
        raw = [legacy] if legacy else ["Savings"]
    elif isinstance(raw, str):
        raw = [raw]
    # Drop blanks/duplicates, keep order; never return an empty list.
    accounts = list(dict.fromkeys(a for a in raw if a and str(a).strip()))
    return {
        "savings_accounts": accounts or ["Savings"],
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


def language_config() -> dict:
    """Language settings: whether the header language toggle is disabled, and which
    second language it switches to (English is always the first language)."""
    lang = settings().get("language", {})
    return {
        "toggle_disabled": bool(lang.get("toggle_disabled", False)),
        "second_language": (lang.get("second_language") or "th"),
    }


def _clean_selections(raw) -> list:
    """Drop blanks and dedupe a list of encoded selection strings, keeping order."""
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    return list(dict.fromkeys(
        str(s).strip() for s in raw if s and str(s).strip()))


def _resolve_paid_sub(sub: str) -> str:
    """Encode a legacy bare tax subcategory as "Parent / Sub" by finding its parent in
    the expense tree; if the parent can't be found, keep the bare name (best-effort)."""
    sub = str(sub).strip()
    if not sub or " / " in sub:
        return sub
    from src.analytics.transaction_categories import load_categories
    for cat, subs in load_categories().get("expense", {}).items():
        if sub in subs:
            return f"{cat} / {sub}"
    return sub


def tax_config() -> dict:
    """Income-tax settings: the category/subcategory *selections* that feed the
    gross-income figure (empty ⇒ all income) and that record tax payments, plus the
    country model. A selection is an encoded string: ``"Category"`` (whole category)
    or ``"Category / Subcategory"`` (a specific subcategory)."""
    t = settings().get("tax", {})

    # Income selections; empty ⇒ tax all income. The legacy ``income_categories`` held
    # bare category names, which are already valid whole-category selections.
    raw_inc = t.get("income_selections")
    if raw_inc is None:
        raw_inc = t.get("income_categories")
    income = _clean_selections(raw_inc)

    # Paid selections; empty ⇒ default to the "Tax" subcategory. Migrate the legacy
    # bare-subcategory list/scalar by resolving each sub to "Parent / Sub".
    raw_paid = t.get("paid_selections")
    if raw_paid is None:
        legacy = t.get("paid_subcategories")
        if legacy is None:
            one = t.get("paid_subcategory")
            legacy = [one] if one else ["Tax"]
        elif isinstance(legacy, str):
            legacy = [legacy]
        raw_paid = [_resolve_paid_sub(s) for s in legacy]
    paid = _clean_selections(raw_paid) or [_resolve_paid_sub("Tax")]

    return {
        "income_selections": income,
        "paid_selections": paid,
        "country": t.get("country") or "Thailand",
    }
