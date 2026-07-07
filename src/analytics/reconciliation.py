"""Account balance reconciliation: state, tracked balances, and hidden cost.

Registering real account balances writes dated balance-adjustment rows (see
src/io/store.py:apply_reconciliation) using the "Adjustment-In" /
"Adjustment-Out" convention. The signed sum of those rows is the recorded
"hidden cost" — the money that moved without being tracked.
"""

import calendar
import json
from datetime import date
from pathlib import Path

import pandas as pd

from src.processing.balances import compute_account_balances

RECON_PATH = Path("config/reconciliation.json")
INCOME_BALANCE = "Adjustment-In"
EXPENSE_BALANCE = "Adjustment-Out"
_STALE_DAYS = 31


def load_recon_state(path: str | Path = RECON_PATH) -> dict:
    path = Path(path)
    if not path.exists():
        return {"last_reconciled": None}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_recon_state(state: dict, path: str | Path = RECON_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def mark_reconciled(when: date | None = None, path: str | Path = RECON_PATH) -> None:
    when = when or date.today()
    save_recon_state({"last_reconciled": when.isoformat()}, path)


def last_reconciled(path: str | Path = RECON_PATH) -> date | None:
    raw = load_recon_state(path).get("last_reconciled")
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except (ValueError, TypeError):
        return None


def is_reminder_due(today: date | None = None, path: str | Path = RECON_PATH) -> bool:
    """Due if never reconciled, last reconciliation is stale (>31 days), or it
    is the last day of the month and we haven't reconciled this month."""
    today = today or date.today()
    last = last_reconciled(path)
    if last is None:
        return True
    if (today - last).days > _STALE_DAYS:
        return True
    is_month_end = today.day == calendar.monthrange(today.year, today.month)[1]
    if is_month_end and (last.year, last.month) < (today.year, today.month):
        return True
    return False


def tracked_balances(df: pd.DataFrame, accounts: list[str] | None = None) -> dict:
    """Final tracked balance per account (adjustments included)."""
    if accounts is None:
        from src.app.data import account_names
        accounts = account_names()
    if df.empty:
        return {a: 0.0 for a in accounts}
    bal = compute_account_balances(df)
    finals = bal.groupby("Account")["balance"].last()
    # Union of configured accounts and any account present in the data.
    names = list(dict.fromkeys(list(accounts) + list(finals.index)))
    return {a: float(finals.get(a, 0.0)) for a in names}


def hidden_cost_by_account(df: pd.DataFrame) -> dict:
    """Signed hidden cost per account (Adjustment-In +, Adjustment-Out −)."""
    adj = df[df["Income/Expense"].isin([INCOME_BALANCE, EXPENSE_BALANCE])].copy()
    if adj.empty:
        return {}
    sign = adj["Income/Expense"].map({INCOME_BALANCE: 1, EXPENSE_BALANCE: -1})
    signed = sign * adj["Amount"]
    return {a: float(v) for a, v in signed.groupby(adj["Account"]).sum().items()}


def hidden_cost_total(df: pd.DataFrame) -> float:
    return float(sum(hidden_cost_by_account(df).values()))
