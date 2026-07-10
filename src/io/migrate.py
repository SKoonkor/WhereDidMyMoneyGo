"""One-time migration: legacy Realbyte-format xlsx → the SQLite ledger.

The legacy workbook (`<data_dir>/raw/transactions.xlsx`) carries a duplicate
"Accounts" header (read back as "Accounts.1"), a "GBP" column that mirrors
Amount, expenses labeled "Exp.", and a Currency column hardcoded to "GBP"
even though the amounts are in the user's base currency. This module parses
that layout once, writes `<data_dir>/raw/ledger.db`, and archives the xlsx
to `<data_dir>/backups/transactions_legacy_<stamp>.xlsx`.

Safety posture: the database is built as a temp file and moved into place
atomically; any failure leaves the xlsx untouched and re-raises so the app
fails loudly rather than starting on an empty ledger. Runs from bootstrap()
on every launch but gates itself out when a ledger.db already exists.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import shutil
import sqlite3
import uuid

import pandas as pd

from src.io.store import _DDL, _INSERT, PERIOD_FMT
from src.utils.config import load_config

LEGACY_TYPE_MAP = {
    "Exp.": "Expense",
    "Income Balance": "Adjustment-In",
    "Expense Balance": "Adjustment-Out",
}
VALID_TYPES = {"Income", "Expense", "Transfer-In", "Transfer-Out",
               "Adjustment-In", "Adjustment-Out", "Saving", "Transfer"}
LEGACY_RECON_CATEGORY = "Modified Bal."


def _log(msg: str) -> None:
    print(f"[migrate] {msg}")


def _clean(v) -> str:
    if pd.isna(v):
        return ""
    return str(v).strip()


def _link_transfers(df: pd.DataFrame) -> tuple[dict[int, str], int]:
    """Greedy 1:1 pairing of Transfer-In rows to unconsumed Transfer-Out rows
    on (Period, Amount, swapped Accounts/Category). Returns {df index ->
    transfer_id} and the count of orphaned halves. Matches on the raw
    Timestamps, before second-precision formatting, so truncation can never
    split a pair."""
    outs: dict[tuple, list[int]] = {}
    out_mask = df["Income/Expense"] == "Transfer-Out"
    for idx in df.index[out_mask]:
        r = df.loc[idx]
        outs.setdefault((r["Period"], r["Amount"], r["Accounts"], r["Category"]),
                        []).append(idx)

    links: dict[int, str] = {}
    for idx in df.index[df["Income/Expense"] == "Transfer-In"]:
        r = df.loc[idx]
        key = (r["Period"], r["Amount"], r["Category"], r["Accounts"])
        candidates = outs.get(key)
        if candidates:
            out_idx = candidates.pop(0)
            link = uuid.uuid4().hex
            links[idx] = link
            links[out_idx] = link

    n_transfers = int((df["Income/Expense"].isin(["Transfer-In", "Transfer-Out"])).sum())
    orphans = n_transfers - len(links)
    return links, orphans


def migrate_legacy_xlsx(root: Path | str = ".") -> bool:
    """Convert the legacy xlsx to ledger.db. Returns True when a migration
    ran, False when there was nothing to do."""
    root = Path(root)
    cfg = load_config(root / "config")
    general = cfg.get("settings", {}).get("general", {})
    data_dir = root / general.get("data_dir", "data")
    currency = general.get("base_currency", "THB")

    xlsx = data_dir / "raw" / "transactions.xlsx"
    db = data_dir / "raw" / "ledger.db"

    if db.exists():
        if xlsx.exists():
            _log(f"ledger.db already exists — ignoring {xlsx}. To re-import "
                 "the xlsx, remove/rename ledger.db first.")
        return False
    if not xlsx.exists():
        return False

    _log(f"migrating {xlsx} -> {db}")
    df = pd.read_excel(xlsx)
    total = len(df)
    df = df.drop(columns=[c for c in ("GBP", "Accounts.1") if c in df.columns])

    df["Period"] = pd.to_datetime(df["Period"], errors="coerce")
    bad = df[df["Period"].isna()]
    if len(bad):
        _log(f"WARNING: skipping {len(bad)} row(s) with unparseable dates "
             f"(raw rows {list(bad.index)}); they remain in the archived xlsx.")
        df = df.dropna(subset=["Period"])

    for col in ("Accounts", "Category", "Subcategory", "Note", "Description",
                "Income/Expense"):
        df[col] = df[col].map(_clean)
    df["Amount"] = pd.to_numeric(df["Amount"], errors="coerce").fillna(0.0)
    df["Income/Expense"] = df["Income/Expense"].map(
        lambda t: LEGACY_TYPE_MAP.get(t, t))

    unknown = set(df["Income/Expense"]) - VALID_TYPES
    if unknown:
        raise ValueError(f"Legacy ledger contains unknown transaction types "
                         f"{sorted(unknown)}; refusing to migrate.")

    df.loc[df["Category"] == LEGACY_RECON_CATEGORY, "Category"] = "Reconciliation"

    links, orphans = _link_transfers(df)
    if orphans:
        _log(f"WARNING: {orphans} transfer half/halves have no matching "
             "counterpart; migrated unlinked (same behavior as before).")

    rows = [
        (uuid.uuid4().hex,
         r["Period"].strftime(PERIOD_FMT),
         r["Accounts"], r["Category"], r["Subcategory"], r["Note"],
         r["Description"], r["Income/Expense"], float(r["Amount"]),
         currency, links.get(idx))
        for idx, r in df.iterrows()
    ]

    tmp = db.with_suffix(".db.tmp")
    try:
        db.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(tmp)
        try:
            conn.executescript(_DDL)
            with conn:
                conn.executemany(_INSERT, rows)
        finally:
            conn.close()
        tmp.replace(db)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    backups = data_dir / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive = backups / f"transactions_legacy_{stamp}.xlsx"
    shutil.move(xlsx, archive)

    _log(f"done: {len(rows)}/{total} rows migrated "
         f"({len(links) // 2} transfer pairs linked, {orphans} orphaned, "
         f"{total - len(df)} skipped), currency={currency}. "
         f"Legacy xlsx archived at {archive}.")
    return True
