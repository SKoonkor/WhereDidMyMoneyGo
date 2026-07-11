"""Account list persistence (config/accounts.json).

Accounts are a simple ordered list of names, seeded with the accounts from
the design (slide 13). New accounts can be added from the account picker in
the transaction form.
"""

from __future__ import annotations

import json
from pathlib import Path

ACCOUNTS_PATH = Path("config/accounts.json")

DEFAULT_ACCOUNTS = [
    "Cash", "Bank Accounts", "Wallet", "Credit Card", "Brokerage", "Savings",
]


def load_accounts(path: str | Path = ACCOUNTS_PATH) -> list[str]:
    """Load accounts from disk, seeding the defaults if missing."""
    path = Path(path)
    if not path.exists():
        save_accounts(DEFAULT_ACCOUNTS, path)
        return list(DEFAULT_ACCOUNTS)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_accounts(accounts: list[str], path: str | Path = ACCOUNTS_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(accounts, f, indent=2, ensure_ascii=False)


def add_account(name: str, path: str | Path = ACCOUNTS_PATH) -> list[str]:
    """Add an account (no-op if it already exists). Returns the list."""
    accounts = load_accounts(path)
    name = name.strip()
    if name and name not in accounts:
        accounts.append(name)
        save_accounts(accounts, path)
    return accounts


def rename_account(old: str, new: str, path: str | Path = ACCOUNTS_PATH) -> list[str]:
    """Rename an account in the list (preserving position). No-op if ``old`` is
    absent; merges onto an existing ``new`` by dropping the duplicate."""
    accounts = load_accounts(path)
    new = new.strip()
    if not new or old not in accounts:
        return accounts
    accounts = [new if a == old else a for a in accounts]
    accounts = list(dict.fromkeys(accounts))  # drop a dup if new already existed
    save_accounts(accounts, path)
    return accounts


def delete_account(name: str, path: str | Path = ACCOUNTS_PATH) -> list[str]:
    """Remove an account from the list (no-op if absent)."""
    accounts = [a for a in load_accounts(path) if a != name]
    save_accounts(accounts, path)
    return accounts
