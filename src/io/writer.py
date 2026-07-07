"""Write access to the raw transactions workbook.

Operates on the raw file directly (no cleaning) so row positions and the
legacy column layout are preserved exactly. The raw header contains TWO
columns named "Accounts" (pandas reads the second as "Accounts.1"); writing
with header aliases restores the duplicate so the file format stays
compatible with the original Realbyte export.

Row identity ("row_id") is the 0-based position in the raw file — the same
value the loader exposes as the RowId column.

Transfers are stored as paired rows sharing one timestamp and amount:
    Transfer-Out: Accounts=from, Category=to
    Transfer-In:  Accounts=to,   Category=from
"""

from datetime import datetime
from pathlib import Path
import shutil

import pandas as pd

RAW_PATH = Path("data/raw/transactions.xlsx")
BACKUP_DIR = Path("data/backups")
MAX_BACKUPS = 20
SHEET_NAME = "Sheet1"

# Internal (pandas) column order; written back with "Accounts.1" → "Accounts".
COLUMNS = ["Period", "Accounts", "Category", "Subcategory", "Note", "GBP",
           "Income/Expense", "Description", "Amount", "Currency", "Accounts.1"]
WRITE_HEADER = [c if c != "Accounts.1" else "Accounts" for c in COLUMNS]

# Raw type labels used in the file.
RAW_EXPENSE = "Exp."
RAW_INCOME = "Income"
RAW_TRANSFER_IN = "Transfer-In"
RAW_TRANSFER_OUT = "Transfer-Out"
RAW_INCOME_BALANCE = "Income Balance"
RAW_EXPENSE_BALANCE = "Expense Balance"
RECON_CATEGORY = "Modified Bal."

_UI_TYPE = {
    RAW_EXPENSE: "Expense",
    "Expense": "Expense",
    RAW_INCOME: "Income",
    RAW_INCOME_BALANCE: "Adjustment",
    RAW_EXPENSE_BALANCE: "Adjustment",
    RAW_TRANSFER_IN: "Transfer",
    RAW_TRANSFER_OUT: "Transfer",
}


def _read_raw(path: Path = RAW_PATH) -> pd.DataFrame:
    path = Path(path)
    if not path.exists():
        # Fresh install with no ledger yet — start from an empty raw workbook.
        return pd.DataFrame(columns=COLUMNS)
    df = pd.read_excel(path)
    return df.reindex(columns=COLUMNS)


def _backup(path: Path = RAW_PATH) -> Path | None:
    path = Path(path)
    if not path.exists():
        # Nothing to back up before the first write.
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    dest = BACKUP_DIR / f"transactions_{stamp}.xlsx"
    shutil.copy2(path, dest)
    backups = sorted(BACKUP_DIR.glob("transactions_*.xlsx"))
    for old in backups[:-MAX_BACKUPS]:
        old.unlink()
    return dest


def _write_raw(df: pd.DataFrame, path: Path = RAW_PATH) -> None:
    _backup(path)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    df = df.reindex(columns=COLUMNS)
    df.to_excel(path, index=False, sheet_name=SHEET_NAME, header=WRITE_HEADER)


def _make_row(period: pd.Timestamp, account: str, category: str, subcategory: str,
              note: str, description: str, amount: float, raw_type: str) -> dict:
    return {
        "Period": period,
        "Accounts": account,
        "Category": category or None,
        "Subcategory": subcategory or None,
        "Note": note or None,
        "GBP": amount,
        "Income/Expense": raw_type,
        "Description": description or None,
        "Amount": amount,
        "Currency": "GBP",
        "Accounts.1": amount,
    }


def _transfer_rows(period, amount, account, to_account, note, description) -> list[dict]:
    out_row = _make_row(period, account, to_account, "", note, description,
                        amount, RAW_TRANSFER_OUT)
    in_row = _make_row(period, to_account, account, "", note, description,
                       amount, RAW_TRANSFER_IN)
    return [out_row, in_row]


def find_transfer_pair(raw: pd.DataFrame, row_id: int) -> int | None:
    """Locate the other half of a transfer pair, or None if unpaired."""
    row = raw.iloc[row_id]
    t = row["Income/Expense"]
    if t not in (RAW_TRANSFER_IN, RAW_TRANSFER_OUT):
        return None
    other_t = RAW_TRANSFER_OUT if t == RAW_TRANSFER_IN else RAW_TRANSFER_IN
    mask = (
        (raw["Income/Expense"] == other_t)
        & (raw["Period"] == row["Period"])
        & (raw["Amount"] == row["Amount"])
        & (raw["Accounts"] == row["Category"])
        & (raw["Category"] == row["Accounts"])
    )
    matches = raw.index[mask]
    return int(matches[0]) if len(matches) else None


def _stamp(period) -> pd.Timestamp:
    """Combine a picked date with the current wall-clock time so rows keep
    intra-day order and transfer pairs match on a unique timestamp."""
    d = pd.Timestamp(period)
    now = datetime.now()
    return d.normalize() + pd.Timedelta(hours=now.hour, minutes=now.minute,
                                        seconds=now.second)


def apply_reconciliation(adjustments: dict[str, float], period=None) -> int:
    """Append one balance-adjustment row per account whose actual balance
    differs from the tracked balance. `adjustments` maps account -> signed
    delta (actual - tracked). Returns the number of rows written.

    Positive delta -> "Income Balance"; negative -> "Expense Balance". These
    rows carry the recorded "hidden cost" (untracked amount).
    """
    from datetime import date as _date
    ts = _stamp(period or _date.today())
    rows = []
    for account, delta in adjustments.items():
        if delta is None or abs(delta) < 0.005:
            continue
        raw_type = RAW_INCOME_BALANCE if delta > 0 else RAW_EXPENSE_BALANCE
        rows.append(_make_row(ts, account, RECON_CATEGORY, "", "Reconciliation",
                              "", round(abs(delta), 2), raw_type))
    if not rows:
        return 0
    raw = _read_raw()
    raw = pd.concat([raw, pd.DataFrame(rows)], ignore_index=True)
    _write_raw(raw)
    return len(rows)


def add_transaction(*, period, txn_type: str, amount: float, account: str,
                    category: str = "", subcategory: str = "", note: str = "",
                    description: str = "", to_account: str | None = None) -> None:
    raw = _read_raw()
    ts = _stamp(period)
    if txn_type == "Transfer":
        rows = _transfer_rows(ts, amount, account, to_account, note, description)
    else:
        raw_type = RAW_EXPENSE if txn_type == "Expense" else RAW_INCOME
        rows = [_make_row(ts, account, category, subcategory, note, description,
                          amount, raw_type)]
    raw = pd.concat([raw, pd.DataFrame(rows)], ignore_index=True)
    _write_raw(raw)


def get_transaction(row_id: int) -> dict | None:
    raw = _read_raw()
    if not 0 <= row_id < len(raw):
        return None
    row = raw.iloc[row_id]

    def _s(v):
        return "" if pd.isna(v) else str(v)

    raw_type = _s(row["Income/Expense"])
    ui_type = _UI_TYPE.get(raw_type, "Expense")
    txn = {
        "row_id": row_id,
        "ui_type": ui_type,
        "period": pd.Timestamp(row["Period"]),
        "amount": float(row["Amount"]),
        "category": _s(row["Category"]),
        "subcategory": _s(row["Subcategory"]),
        "note": _s(row["Note"]),
        "description": _s(row["Description"]),
        "account": _s(row["Accounts"]),
        "to_account": None,
        "pair_row_id": None,
    }
    if ui_type == "Transfer":
        if raw_type == RAW_TRANSFER_OUT:
            txn["account"], txn["to_account"] = _s(row["Accounts"]), _s(row["Category"])
        else:
            txn["account"], txn["to_account"] = _s(row["Category"]), _s(row["Accounts"])
        txn["category"] = txn["subcategory"] = ""
        txn["pair_row_id"] = find_transfer_pair(raw, row_id)
    return txn


def _edit_stamp(raw: pd.DataFrame, row_id: int, period) -> pd.Timestamp:
    """Keep the original time of day when the date is unchanged or shifted."""
    old = pd.Timestamp(raw.iloc[row_id]["Period"])
    new_day = pd.Timestamp(period).normalize()
    return new_day + (old - old.normalize())


def update_transaction(row_id: int, *, period, txn_type: str, amount: float,
                       account: str, category: str = "", subcategory: str = "",
                       note: str = "", description: str = "",
                       to_account: str | None = None) -> None:
    raw = _read_raw()
    if not 0 <= row_id < len(raw):
        raise IndexError(f"No transaction at row {row_id}")
    old_type = raw.iloc[row_id]["Income/Expense"]
    was_transfer = old_type in (RAW_TRANSFER_IN, RAW_TRANSFER_OUT)
    is_transfer = txn_type == "Transfer"
    ts = _edit_stamp(raw, row_id, period)

    if was_transfer != is_transfer:
        # Type class changed: replace old row(s) with freshly appended one(s).
        drop = [row_id]
        if was_transfer:
            pair = find_transfer_pair(raw, row_id)
            if pair is not None:
                drop.append(pair)
        raw = raw.drop(index=drop).reset_index(drop=True)
        if is_transfer:
            rows = _transfer_rows(ts, amount, account, to_account, note, description)
        else:
            raw_type = RAW_EXPENSE if txn_type == "Expense" else RAW_INCOME
            rows = [_make_row(ts, account, category, subcategory, note, description,
                              amount, raw_type)]
        raw = pd.concat([raw, pd.DataFrame(rows)], ignore_index=True)
    elif is_transfer:
        pair = find_transfer_pair(raw, row_id)
        out_id = row_id if old_type == RAW_TRANSFER_OUT else pair
        in_id = row_id if old_type == RAW_TRANSFER_IN else pair
        out_row, in_row = _transfer_rows(ts, amount, account, to_account,
                                         note, description)
        if out_id is not None:
            raw.iloc[out_id] = pd.Series(out_row).reindex(COLUMNS)
        if in_id is not None:
            raw.iloc[in_id] = pd.Series(in_row).reindex(COLUMNS)
    else:
        raw_type = RAW_EXPENSE if txn_type == "Expense" else RAW_INCOME
        row = _make_row(ts, account, category, subcategory, note, description,
                        amount, raw_type)
        raw.iloc[row_id] = pd.Series(row).reindex(COLUMNS)

    _write_raw(raw)


def delete_transaction(row_id: int) -> None:
    raw = _read_raw()
    if not 0 <= row_id < len(raw):
        raise IndexError(f"No transaction at row {row_id}")
    drop = [row_id]
    pair = find_transfer_pair(raw, row_id)
    if pair is not None:
        drop.append(pair)
    raw = raw.drop(index=drop).reset_index(drop=True)
    _write_raw(raw)
