"""Shared fixtures and DataFrame builders for the test suite.

Two isolation strategies:

* Pure-calc tests take a ledger-shaped DataFrame from :func:`make_df` and need no
  filesystem at all.
* Tests that exercise the SQLite ledger or config-backed persistence use the
  ``ledger_env`` fixture, which ``chdir``s into a throwaway directory holding a
  minimal ``config/``. The store resolves its DB via ``load_config("config")``
  relative to the CWD, so every write lands under ``<tmp>/data/raw/ledger.db`` and
  the real ``config/`` / ``data/`` are never touched.
"""

from __future__ import annotations

import json

import pandas as pd
import pytest

from src.io.store import DF_COLUMNS

# Default currency stamped by the store in the isolated env.
TEST_CURRENCY = "THB"


def make_df(rows: list[dict]) -> pd.DataFrame:
    """Build a cleaned ledger DataFrame (the app-wide contract, ``DF_COLUMNS``).

    Each ``row`` supplies any of the ledger fields; the rest default to blanks.
    ``Period`` accepts anything ``pd.Timestamp`` understands and the column is
    coerced to ``datetime64`` so ``.dt`` access works even when ``rows`` is empty.
    """
    defaults = {"Period": None, "Account": "", "Category": "", "Subcategory": "",
                "Note": "", "Income/Expense": "Expense", "Description": "",
                "Amount": 0.0, "Currency": TEST_CURRENCY, "Id": "", "TransferId": None}
    built = [{**defaults, **r} for r in rows]
    df = pd.DataFrame(built, columns=DF_COLUMNS)
    df["Period"] = pd.to_datetime(df["Period"], errors="coerce")
    if df.empty:
        df["Period"] = df["Period"].astype("datetime64[ns]")
    df["Amount"] = pd.to_numeric(df["Amount"], errors="coerce").fillna(0.0)
    return df


@pytest.fixture
def ledger_env(tmp_path, monkeypatch):
    """Isolate the ledger + config in a throwaway CWD; yields the tmp root."""
    monkeypatch.chdir(tmp_path)
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "settings.toml").write_text(
        '[general]\n'
        'app_name = "Test"\n'
        f'base_currency = "{TEST_CURRENCY}"\n'
        'data_dir = "data"\n',
        encoding="utf-8",
    )
    (cfg / "accounts.json").write_text(
        json.dumps(["Bank", "Savings", "Cash"]), encoding="utf-8")
    (cfg / "transaction_categories.json").write_text(
        json.dumps({"income": {"Salary": []},
                    "expense": {"Bills": ["Tax", "Rent"], "Food": ["Lunch"]}}),
        encoding="utf-8")
    (tmp_path / "data" / "raw").mkdir(parents=True)
    return tmp_path
