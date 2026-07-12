"""SQLite ledger integrity: writes, transfers, deletes, backups, restore.

Every test runs under ``ledger_env`` (a throwaway CWD), so the real ledger is
never touched. ``store`` resolves its DB relative to the CWD's ``config/``.
"""

import datetime

import pytest

from src.io import store


def _d(y=2026, m=1, day=15):
    return datetime.datetime(y, m, day, 9, 0, 0)


def test_empty_ledger_is_typed_and_empty(ledger_env):
    df = store.load_transactions()
    assert df.empty
    assert list(df.columns) == store.DF_COLUMNS
    assert str(df["Period"].dtype).startswith("datetime64")   # .dt access safe


def test_add_income_and_expense(ledger_env):
    store.add_transaction(period=_d(), txn_type="Income", amount=1000,
                          account="Bank", category="Salary")
    store.add_transaction(period=_d(day=16), txn_type="Expense", amount=250,
                          account="Bank", category="Food", subcategory="Lunch")
    df = store.load_transactions()
    assert len(df) == 2
    assert set(df["Income/Expense"]) == {"Income", "Expense"}
    assert df["Currency"].iloc[0] == "THB"        # stamped from settings


def test_transfer_creates_linked_pair(ledger_env):
    store.add_transaction(period=_d(), txn_type="Transfer", amount=500,
                          account="Bank", to_account="Savings")
    df = store.load_transactions()
    assert len(df) == 2
    legs = set(df["Income/Expense"])
    assert legs == {"Transfer-Out", "Transfer-In"}
    # Both legs share one transfer id.
    tids = df["TransferId"].dropna().unique()
    assert len(tids) == 1 and tids[0] is not None
    # Out leg is on Bank, In leg on Savings.
    out = df[df["Income/Expense"] == "Transfer-Out"].iloc[0]
    inn = df[df["Income/Expense"] == "Transfer-In"].iloc[0]
    assert out["Account"] == "Bank" and inn["Account"] == "Savings"


def test_delete_transfer_removes_both_legs(ledger_env):
    store.add_transaction(period=_d(), txn_type="Transfer", amount=500,
                          account="Bank", to_account="Savings")
    df = store.load_transactions()
    one_leg = df["Id"].iloc[0]
    store.delete_transaction(one_leg)
    assert store.load_transactions().empty       # deleting one leg clears the pair


def test_update_transaction_in_place(ledger_env):
    tid = store.add_transaction(period=_d(), txn_type="Expense", amount=100,
                                account="Bank", category="Food")
    store.update_transaction(tid, period=_d(), txn_type="Expense", amount=175,
                             account="Bank", category="Food", subcategory="Lunch")
    df = store.load_transactions()
    assert len(df) == 1
    assert df["Amount"].iloc[0] == 175
    assert df["Subcategory"].iloc[0] == "Lunch"


def test_count_and_delete_period(ledger_env):
    store.add_transaction(period=_d(m=1), txn_type="Expense", amount=10,
                          account="Bank", category="Food")
    store.add_transaction(period=_d(m=2), txn_type="Expense", amount=20,
                          account="Bank", category="Food")
    assert store.count_period("2026-01-01", "2026-01-31") == 1
    n, _backup = store.delete_period("2026-01-01", "2026-01-31")
    assert n == 1
    assert len(store.load_transactions()) == 1   # only February remains


def test_usage_counts(ledger_env):
    store.add_transaction(period=_d(), txn_type="Expense", amount=10,
                          account="Bank", category="Food", subcategory="Lunch")
    store.add_transaction(period=_d(day=16), txn_type="Expense", amount=20,
                          account="Bank", category="Food", subcategory="Lunch")
    assert store.account_usage().get("Bank") == 2
    assert store.category_usage("expense").get("Food") == 2
    assert store.subcategory_usage("expense", "Food").get("Lunch") == 2


def test_rename_account_rewrites_rows(ledger_env):
    store.add_transaction(period=_d(), txn_type="Income", amount=10,
                          account="Bank", category="Salary")
    n = store.rename_account("Bank", "Checking")
    assert n == 1
    assert set(store.load_transactions()["Account"]) == {"Checking"}


def test_backup_created_and_pruned(ledger_env):
    # First write has nothing to back up yet (no db file). Subsequent writes back up.
    store.add_transaction(period=_d(), txn_type="Income", amount=1,
                          account="Bank", category="Salary")
    for i in range(store.MAX_BACKUPS + 5):
        store.add_transaction(period=_d(day=(i % 27) + 1), txn_type="Expense",
                              amount=i + 1, account="Bank", category="Food")
    backups = sorted(store.backups_dir().glob("ledger_*.db"))
    assert len(backups) == store.MAX_BACKUPS      # pruned to the cap


def test_restore_backup_roundtrip(ledger_env):
    store.add_transaction(period=_d(), txn_type="Income", amount=100,
                          account="Bank", category="Salary")
    snapshot = store.backup_now()                 # capture 1-row state
    assert snapshot is not None
    store.add_transaction(period=_d(day=16), txn_type="Expense", amount=5,
                          account="Bank", category="Food")
    assert len(store.load_transactions()) == 2
    store.restore_backup(snapshot)
    assert len(store.load_transactions()) == 1    # back to the snapshot


def test_replace_import(ledger_env):
    tid = store.add_transaction(period=_d(), txn_type="Income", amount=100,
                                account="Bank", category="Salary")
    new_row = store._row(store._new_id(), "2026-02-01 09:00:00", "Bank",
                         "Food", "", "", "", store.TYPE_EXPENSE, 40)
    store.replace_import([tid], [new_row])
    df = store.load_transactions()
    assert len(df) == 1 and df["Income/Expense"].iloc[0] == "Expense"


def test_apply_reconciliation_writes_adjustments(ledger_env):
    n = store.apply_reconciliation({"Bank": -300.0, "Cash": 0.0}, period=_d())
    assert n == 1                                 # only the non-zero delta
    df = store.load_transactions()
    assert df["Income/Expense"].iloc[0] == "Adjustment-Out"
    assert df["Amount"].iloc[0] == 300.0
