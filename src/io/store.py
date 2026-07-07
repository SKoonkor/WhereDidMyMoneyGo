"""SQLite-backed transaction ledger — the app-owned data store.

Replaces the legacy Realbyte-format xlsx (src/io/loader.py + writer.py).
Source of truth is ``<data_dir>/raw/ledger.db`` with one honest row per
transaction: a UUID primary key, real per-row currency, and clean type
labels (Income, Expense, Transfer-In/Out, Adjustment-In/Out).

Transfers are stored as paired Transfer-Out/Transfer-In rows sharing a
``transfer_id``; reconciliation writes Adjustment rows (category
"Reconciliation") carrying the recorded hidden cost.

Every public function opens its own short-lived connection (the Dash dev
server is multi-threaded). Every write backs up the database first
(``<data_dir>/backups/ledger_<stamp>.db``, newest 20 kept) and runs in a
single transaction.
"""

from datetime import datetime
from pathlib import Path
import sqlite3
import uuid

import pandas as pd

from src.utils.config import load_config

MAX_BACKUPS = 20
PERIOD_FMT = "%Y-%m-%d %H:%M:%S"
RECON_CATEGORY = "Reconciliation"

TYPE_INCOME = "Income"
TYPE_EXPENSE = "Expense"
TYPE_TRANSFER_IN = "Transfer-In"
TYPE_TRANSFER_OUT = "Transfer-Out"
TYPE_ADJUST_IN = "Adjustment-In"
TYPE_ADJUST_OUT = "Adjustment-Out"

_DDL = """
CREATE TABLE IF NOT EXISTS transactions (
    id          TEXT PRIMARY KEY,
    period      TEXT NOT NULL,
    account     TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT '',
    subcategory TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    txn_type    TEXT NOT NULL CHECK (txn_type IN
                  ('Income','Expense','Transfer-In','Transfer-Out',
                   'Adjustment-In','Adjustment-Out','Saving','Transfer')),
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL,
    transfer_id TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_txn_period ON transactions(period);
CREATE INDEX IF NOT EXISTS idx_txn_transfer ON transactions(transfer_id)
    WHERE transfer_id IS NOT NULL;
"""

_UI_TYPE = {
    TYPE_INCOME: "Income",
    TYPE_EXPENSE: "Expense",
    TYPE_TRANSFER_IN: "Transfer",
    TYPE_TRANSFER_OUT: "Transfer",
    TYPE_ADJUST_IN: "Adjustment",
    TYPE_ADJUST_OUT: "Adjustment",
}

# The cleaned-DataFrame contract consumed app-wide (see src/app/data.py).
DF_COLUMNS = ["Period", "Account", "Category", "Subcategory", "Note",
              "Income/Expense", "Description", "Amount", "Currency",
              "Id", "TransferId"]

_SELECT = ("SELECT id, period, account, category, subcategory, note, "
           "description, txn_type, amount, currency, transfer_id "
           "FROM transactions")


# ── paths & connections ─────────────────────────────────────────────────────

def _data_dir() -> Path:
    cfg = load_config("config")
    return Path(cfg.get("settings", {}).get("general", {}).get("data_dir", "data"))


def db_path() -> Path:
    return _data_dir() / "raw" / "ledger.db"


def base_currency() -> str:
    cfg = load_config("config")
    return cfg.get("settings", {}).get("general", {}).get("base_currency", "THB")


def _connect(path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(path) if path is not None else db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(_DDL)
    conn.row_factory = sqlite3.Row
    return conn


def _backup(path: Path | str | None = None) -> Path | None:
    """Timestamped copy of the database before a write (newest 20 kept)."""
    src = Path(path) if path is not None else db_path()
    if not src.exists():
        return None
    backup_dir = src.parent.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    dest = backup_dir / f"ledger_{stamp}.db"
    with sqlite3.connect(src) as src_conn, sqlite3.connect(dest) as dst_conn:
        src_conn.backup(dst_conn)
    src_conn.close()
    dst_conn.close()
    # Prune only our own backups; legacy transactions_*.xlsx archives stay.
    backups = sorted(backup_dir.glob("ledger_*.db"))
    for old in backups[:-MAX_BACKUPS]:
        old.unlink()
    return dest


# ── timestamp helpers (same behavior as the old writer) ─────────────────────

def _stamp(period) -> str:
    """Combine a picked date with the current wall-clock time so rows keep
    intra-day order."""
    d = pd.Timestamp(period).normalize()
    now = datetime.now()
    ts = d + pd.Timedelta(hours=now.hour, minutes=now.minute, seconds=now.second)
    return ts.strftime(PERIOD_FMT)


def _edit_stamp(old_period: str, period) -> str:
    """Keep the original time of day when the date is unchanged or shifted."""
    old = pd.Timestamp(old_period)
    new_day = pd.Timestamp(period).normalize()
    return (new_day + (old - old.normalize())).strftime(PERIOD_FMT)


# ── row builders ────────────────────────────────────────────────────────────

def _new_id() -> str:
    return uuid.uuid4().hex


def _row(txn_id: str, period: str, account: str, category: str, subcategory: str,
         note: str, description: str, txn_type: str, amount: float,
         transfer_id: str | None = None) -> tuple:
    return (txn_id, period, account, category or "", subcategory or "",
            note or "", description or "", txn_type, float(amount),
            base_currency(), transfer_id)


_INSERT = ("INSERT INTO transactions (id, period, account, category, subcategory, "
           "note, description, txn_type, amount, currency, transfer_id) "
           "VALUES (?,?,?,?,?,?,?,?,?,?,?)")


def _transfer_rows(period: str, amount: float, account: str, to_account: str,
                   note: str, description: str) -> list[tuple]:
    """Paired rows: Out carries the destination in Category, In the source —
    same convention the app has always displayed."""
    link = _new_id()
    out_row = _row(_new_id(), period, account, to_account, "", note,
                   description, TYPE_TRANSFER_OUT, amount, link)
    in_row = _row(_new_id(), period, to_account, account, "", note,
                  description, TYPE_TRANSFER_IN, amount, link)
    return [out_row, in_row]


# ── reads ───────────────────────────────────────────────────────────────────

def load_transactions(db_path_: Path | str | None = None) -> pd.DataFrame:
    """Load the ledger as the cleaned DataFrame the app consumes.

    Missing/empty database yields an empty, correctly-typed frame so a fresh
    install still runs (Period must be datetime64 — pages call ``.dt``).
    """
    conn = _connect(db_path_)
    try:
        df = pd.read_sql_query(f"{_SELECT} ORDER BY period", conn)
    finally:
        conn.close()
    df = df.rename(columns={
        "id": "Id", "period": "Period", "account": "Account",
        "category": "Category", "subcategory": "Subcategory", "note": "Note",
        "description": "Description", "txn_type": "Income/Expense",
        "amount": "Amount", "currency": "Currency", "transfer_id": "TransferId",
    })
    df["Period"] = pd.to_datetime(df["Period"], format="ISO8601", errors="coerce")
    if df.empty:
        df["Period"] = df["Period"].astype("datetime64[ns]")
    df["Amount"] = pd.to_numeric(df["Amount"], errors="coerce").fillna(0.0)
    return df.reindex(columns=DF_COLUMNS)


def get_transaction(txn_id: str) -> dict | None:
    """Fetch one transaction as the UI dict used by the edit form."""
    conn = _connect()
    try:
        row = conn.execute(f"{_SELECT} WHERE id=?", (txn_id,)).fetchone()
        if row is None:
            return None
        pair = None
        if row["transfer_id"] is not None:
            pair = conn.execute(
                "SELECT id FROM transactions WHERE transfer_id=? AND id<>?",
                (row["transfer_id"], txn_id)).fetchone()
    finally:
        conn.close()

    ui_type = _UI_TYPE.get(row["txn_type"], "Expense")
    txn = {
        "id": row["id"],
        "ui_type": ui_type,
        "period": pd.Timestamp(row["period"]),
        "amount": float(row["amount"]),
        "category": row["category"],
        "subcategory": row["subcategory"],
        "note": row["note"],
        "description": row["description"],
        "account": row["account"],
        "to_account": None,
        "pair_id": pair["id"] if pair is not None else None,
    }
    if ui_type == "Transfer":
        if row["txn_type"] == TYPE_TRANSFER_OUT:
            txn["account"], txn["to_account"] = row["account"], row["category"]
        else:
            txn["account"], txn["to_account"] = row["category"], row["account"]
        txn["category"] = txn["subcategory"] = ""
    return txn


# ── writes ──────────────────────────────────────────────────────────────────

def add_transaction(*, period, txn_type: str, amount: float, account: str,
                    category: str = "", subcategory: str = "", note: str = "",
                    description: str = "", to_account: str | None = None) -> str:
    """Insert a transaction (a pair for transfers). Returns the new id
    (the Transfer-Out half's id for transfers)."""
    ts = _stamp(period)
    if txn_type == "Transfer":
        rows = _transfer_rows(ts, amount, account, to_account, note, description)
    else:
        t = TYPE_EXPENSE if txn_type == "Expense" else TYPE_INCOME
        rows = [_row(_new_id(), ts, account, category, subcategory, note,
                     description, t, amount)]
    _backup()
    conn = _connect()
    try:
        with conn:
            conn.executemany(_INSERT, rows)
    finally:
        conn.close()
    return rows[0][0]


def update_transaction(txn_id: str, *, period, txn_type: str, amount: float,
                       account: str, category: str = "", subcategory: str = "",
                       note: str = "", description: str = "",
                       to_account: str | None = None) -> None:
    """Rewrite a transaction in place. Changing between transfer and
    non-transfer replaces the old row(s) with fresh ones (new ids)."""
    conn = _connect()
    try:
        old = conn.execute(f"{_SELECT} WHERE id=?", (txn_id,)).fetchone()
        if old is None:
            raise KeyError(f"No transaction with id {txn_id!r}")
        was_transfer = old["txn_type"] in (TYPE_TRANSFER_IN, TYPE_TRANSFER_OUT)
        is_transfer = txn_type == "Transfer"
        ts = _edit_stamp(old["period"], period)
        _backup()
        with conn:
            if was_transfer != is_transfer:
                _delete_with_pair(conn, old)
                if is_transfer:
                    rows = _transfer_rows(ts, amount, account, to_account,
                                          note, description)
                else:
                    t = TYPE_EXPENSE if txn_type == "Expense" else TYPE_INCOME
                    rows = [_row(_new_id(), ts, account, category, subcategory,
                                 note, description, t, amount)]
                conn.executemany(_INSERT, rows)
            elif is_transfer:
                pairs = {TYPE_TRANSFER_OUT: (account, to_account),
                         TYPE_TRANSFER_IN: (to_account, account)}
                halves = [old]
                if old["transfer_id"] is not None:
                    halves = conn.execute(
                        f"{_SELECT} WHERE transfer_id=?",
                        (old["transfer_id"],)).fetchall()
                for h in halves:
                    acct, other = pairs[h["txn_type"]]
                    conn.execute(
                        "UPDATE transactions SET period=?, account=?, category=?, "
                        "subcategory='', note=?, description=?, amount=?, "
                        "updated_at=datetime('now') WHERE id=?",
                        (ts, acct, other, note or "", description or "",
                         float(amount), h["id"]))
            else:
                t = TYPE_EXPENSE if txn_type == "Expense" else TYPE_INCOME
                conn.execute(
                    "UPDATE transactions SET period=?, account=?, category=?, "
                    "subcategory=?, note=?, description=?, txn_type=?, amount=?, "
                    "updated_at=datetime('now') WHERE id=?",
                    (ts, account, category or "", subcategory or "", note or "",
                     description or "", t, float(amount), txn_id))
    finally:
        conn.close()


def _delete_with_pair(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """Delete a row and, for a linked transfer, its other half.
    The IS NOT NULL guard keeps unlinked rows from cascading."""
    if row["transfer_id"] is not None:
        conn.execute("DELETE FROM transactions WHERE transfer_id IS NOT NULL "
                     "AND transfer_id=?", (row["transfer_id"],))
    else:
        conn.execute("DELETE FROM transactions WHERE id=?", (row["id"],))


def delete_transaction(txn_id: str) -> None:
    conn = _connect()
    try:
        row = conn.execute(f"{_SELECT} WHERE id=?", (txn_id,)).fetchone()
        if row is None:
            raise KeyError(f"No transaction with id {txn_id!r}")
        _backup()
        with conn:
            _delete_with_pair(conn, row)
    finally:
        conn.close()


def bulk_insert(rows: list[tuple]) -> Path | None:
    """Insert pre-built _INSERT tuples in one transaction (used by the import
    wizard). Returns the pre-import backup path so the import can be undone;
    None when the ledger didn't exist yet (nothing to restore to)."""
    backup = _backup()
    conn = _connect()
    try:
        with conn:
            conn.executemany(_INSERT, rows)
    finally:
        conn.close()
    return backup


def restore_backup(backup_path: Path | str) -> None:
    """Replace the live ledger with a backup copy (import undo). The current
    state is backed up first, so an undo is itself undoable."""
    backup_path = Path(backup_path)
    if not backup_path.exists():
        raise FileNotFoundError(f"backup not found: {backup_path}")
    _backup()
    live = db_path()
    with sqlite3.connect(backup_path) as src, sqlite3.connect(live) as dst:
        src.backup(dst)
    src.close()
    dst.close()


def apply_reconciliation(adjustments: dict[str, float], period=None) -> int:
    """Append one balance-adjustment row per account whose actual balance
    differs from the tracked balance. `adjustments` maps account -> signed
    delta (actual - tracked). Returns the number of rows written.

    Positive delta -> Adjustment-In; negative -> Adjustment-Out. These rows
    carry the recorded "hidden cost" (untracked amount).
    """
    from datetime import date as _date
    ts = _stamp(period or _date.today())
    rows = []
    for account, delta in adjustments.items():
        if delta is None or abs(delta) < 0.005:
            continue
        t = TYPE_ADJUST_IN if delta > 0 else TYPE_ADJUST_OUT
        rows.append(_row(_new_id(), ts, account, RECON_CATEGORY, "",
                         "Reconciliation", "", t, round(abs(delta), 2)))
    if not rows:
        return 0
    _backup()
    conn = _connect()
    try:
        with conn:
            conn.executemany(_INSERT, rows)
    finally:
        conn.close()
    return len(rows)
