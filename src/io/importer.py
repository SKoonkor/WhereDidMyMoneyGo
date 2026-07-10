"""Transaction import pipeline: sniff → map → parse → validate → dedupe → commit.

Pure functions over pandas frames + the SQLite store, so the whole pipeline is
testable without Dash. The /import wizard page drives it.

A **mapping profile** describes how a foreign file maps onto the ledger:

    {
      "name": "My bank",
      "columns": {<target field>: <source column or None>, ...},
      "options": {"date_order": "auto", "decimal": "dot"},
    }

`date_order` is one of auto/dmy/mdy/ymd/ydm (date field ordering); `decimal` is
"dot" (1,234.56) or "comma" (1.234,56). Legacy profiles with the older
`dayfirst`/`decimal_comma` booleans are still read (see ``parse_rows``).

Target fields: Date, Type, Amount, Inflow, Outflow, Account, Category,
Subcategory, Note, Description, Currency, Id, TransferId.
Amount modes (derived from what's mapped):
  * Type column + Amount column        — labels decide the type
  * signed Amount only                 — sign decides Income/Expense
  * Inflow / Outflow columns           — two-column bank/YNAB style

Built-in presets are matched by header fingerprint; user profiles live in
``config/import_profiles/*.json``.
"""

from __future__ import annotations

import csv as _csv
import io
import json
import re
import uuid
from pathlib import Path

import pandas as pd

from src.io.store import PERIOD_FMT, base_currency
from src.io.exporter import EXPORT_COLUMNS

TARGET_FIELDS = ["Date", "Type", "Amount", "Inflow", "Outflow", "Account",
                 "Category", "Subcategory", "Note", "Description", "Currency",
                 "Id", "TransferId"]

PROFILE_DIR = Path("config/import_profiles")

# ── canonical type labels ───────────────────────────────────────────────────

TYPE_SYNONYMS = {
    "income": "Income", "in": "Income", "credit": "Income", "deposit": "Income",
    "expense": "Expense", "exp.": "Expense", "exp": "Expense", "debit": "Expense",
    "withdrawal": "Expense", "spending": "Expense",
    "transfer-out": "Transfer-Out", "transfer out": "Transfer-Out",
    "transfer": "Transfer-Out",
    "transfer-in": "Transfer-In", "transfer in": "Transfer-In",
    "adjustment-in": "Adjustment-In", "income balance": "Adjustment-In",
    "adjustment-out": "Adjustment-Out", "expense balance": "Adjustment-Out",
    "saving": "Saving",
}

_TRANSFER_TYPES = ("Transfer-In", "Transfer-Out")

# ── built-in presets ────────────────────────────────────────────────────────

def _cols(**kw) -> dict:
    base = {f: None for f in TARGET_FIELDS}
    base.update(kw)
    return base


PRESETS = [
    {
        "name": "Money Tracker export",
        "fingerprint": set(EXPORT_COLUMNS),
        "columns": _cols(Date="Date", Type="Type", Amount="Amount",
                         Account="Account", Category="Category",
                         Subcategory="Subcategory", Note="Note",
                         Description="Description", Currency="Currency",
                         Id="Id", TransferId="TransferId"),
        "options": {"date_order": "auto", "decimal": "dot"},
    },
    {
        "name": "Realbyte Money Manager",
        "fingerprint": {"Period", "Accounts", "Income/Expense", "Amount"},
        "columns": _cols(Date="Period", Type="Income/Expense", Amount="Amount",
                         Account="Accounts", Category="Category",
                         Subcategory="Subcategory", Note="Note",
                         Description="Description"),
        "options": {"date_order": "auto", "decimal": "dot"},
    },
    {
        "name": "YNAB register",
        "fingerprint": {"Payee", "Outflow", "Inflow"},
        "columns": _cols(Date="Date", Inflow="Inflow", Outflow="Outflow",
                         Account="Account", Category="Category", Note="Payee",
                         Description="Memo"),
        "options": {"date_order": "auto", "decimal": "dot"},
    },
]

# header-name → target-field guesses for unknown files
_HEADER_GUESSES = {
    "Date": ["date", "period", "transaction date", "posted", "time", "datetime"],
    "Type": ["type", "income/expense", "transaction type", "direction"],
    "Amount": ["amount", "value", "sum"],
    "Inflow": ["inflow", "credit amount", "money in", "paid in"],
    "Outflow": ["outflow", "debit amount", "money out", "paid out"],
    "Account": ["account", "accounts", "wallet", "source"],
    "Category": ["category"],
    "Subcategory": ["subcategory", "sub category", "sub-category"],
    "Note": ["note", "payee", "merchant"],
    "Description": ["description", "memo", "details", "reference"],
    "Currency": ["currency", "ccy"],
    "Id": ["id", "transaction id"],
    "TransferId": ["transferid", "transfer id"],
}


# ── reading the uploaded file ───────────────────────────────────────────────

def read_table(filename: str, content: bytes) -> pd.DataFrame:
    """Load an uploaded .csv or .xlsx into a raw string-typed frame.
    CSV: sniff encoding (utf-8/sig → cp874 Thai → latin-1) and delimiter."""
    if filename.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(io.BytesIO(content), dtype=str)
    text = None
    for enc in ("utf-8-sig", "utf-8", "cp874", "latin-1"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    try:
        dialect = _csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        sep = dialect.delimiter
    except _csv.Error:
        sep = ","
    return pd.read_csv(io.StringIO(text), sep=sep, dtype=str,
                       skip_blank_lines=True)


# ── profiles: detection, guessing, persistence ──────────────────────────────

def detect_preset(headers: list[str]) -> dict | None:
    """Match a built-in preset, then a saved user profile, by header set."""
    hs = set(headers)
    for preset in PRESETS:
        if preset["fingerprint"] <= hs:
            return {k: preset[k] for k in ("name", "columns", "options")}
    for prof in load_profiles():
        mapped = {c for c in prof["columns"].values() if c}
        if mapped and mapped <= hs:
            return prof
    return None


def guess_mapping(headers: list[str]) -> dict:
    """Best-effort header→field guess for files no preset matches."""
    columns = {f: None for f in TARGET_FIELDS}
    used = set()
    for field, names in _HEADER_GUESSES.items():
        for h in headers:
            if h in used:
                continue
            if h.strip().lower() in names:
                columns[field] = h
                used.add(h)
                break
    return {"name": "", "columns": columns,
            "options": {"date_order": "auto", "decimal": "dot"}}


def load_profiles(profile_dir: Path | str = PROFILE_DIR) -> list[dict]:
    profile_dir = Path(profile_dir)
    profiles = []
    if profile_dir.exists():
        for f in sorted(profile_dir.glob("*.json")):
            try:
                with open(f, encoding="utf-8") as fh:
                    prof = json.load(fh)
                if isinstance(prof.get("columns"), dict):
                    profiles.append(prof)
            except (json.JSONDecodeError, OSError):
                continue
    return profiles


def save_profile(profile: dict, profile_dir: Path | str = PROFILE_DIR) -> Path:
    profile_dir = Path(profile_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", profile["name"].lower()).strip("-") or "profile"
    path = profile_dir / f"{slug}.json"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(profile, fh, indent=2, ensure_ascii=False)
    return path


# ── parsing ─────────────────────────────────────────────────────────────────

_AMOUNT_JUNK = re.compile(r"[^0-9,.\-()]")


def _parse_amount(raw, decimal_comma: bool) -> float | None:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip()
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = _AMOUNT_JUNK.sub("", s).strip("()")
    if decimal_comma:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def _clean(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    s = str(v).strip()
    return "" if s.lower() == "nan" else s


# (dayfirst, yearfirst) for each explicit date ordering; "auto" infers per value.
_DATE_ORDER_FLAGS = {
    "dmy": (True, False),    # DD/MM/YYYY
    "mdy": (False, False),   # MM/DD/YYYY
    "ymd": (False, True),    # YYYY/MM/DD
    "ydm": (True, True),     # YYYY/DD/MM
}


def _parse_dates(series: pd.Series, date_order: str) -> pd.Series:
    """Parse a date column under the chosen ordering. ``auto`` infers each value
    individually; the explicit orders pass day/year-first hints and stay
    separator-agnostic (works for ``/``, ``-``, ``.``)."""
    if date_order not in _DATE_ORDER_FLAGS:
        return pd.to_datetime(series, errors="coerce", dayfirst=False,
                              format="mixed")
    dayfirst, yearfirst = _DATE_ORDER_FLAGS[date_order]
    return pd.to_datetime(series, errors="coerce",
                          dayfirst=dayfirst, yearfirst=yearfirst)


def parse_rows(df: pd.DataFrame, profile: dict) -> dict:
    """Turn a raw uploaded frame into ledger-ready row dicts.

    Returns {"rows": [dict], "issues": {reason: count}, "skipped": int}.
    Row dicts carry the ledger fields plus a `_source_row` index for messages.
    """
    cols = profile["columns"]
    opts = profile.get("options", {})
    date_order = opts.get("date_order") or ("dmy" if opts.get("dayfirst") else "auto")
    decimal = opts.get("decimal") or ("comma" if opts.get("decimal_comma") else "dot")
    decimal_comma = decimal == "comma"

    def col(field):
        c = cols.get(field)
        return df[c] if c and c in df.columns else None

    dates = col("Date")
    if dates is None:
        raise ValueError("No Date column is mapped.")
    parsed_dates = _parse_dates(dates, date_order)

    amount_s, inflow_s, outflow_s = col("Amount"), col("Inflow"), col("Outflow")
    type_s = col("Type")
    if amount_s is None and inflow_s is None and outflow_s is None:
        raise ValueError("No Amount (or Inflow/Outflow) column is mapped.")

    rows, issues = [], {}

    def issue(reason):
        issues[reason] = issues.get(reason, 0) + 1

    for i in range(len(df)):
        dt = parsed_dates.iloc[i]
        if pd.isna(dt):
            issue("unparseable date")
            continue

        # amount + type resolution
        if inflow_s is not None or outflow_s is not None:
            inflow = _parse_amount(inflow_s.iloc[i], decimal_comma) if inflow_s is not None else None
            outflow = _parse_amount(outflow_s.iloc[i], decimal_comma) if outflow_s is not None else None
            inflow, outflow = inflow or 0.0, outflow or 0.0
            if inflow == 0.0 and outflow == 0.0:
                issue("no amount")
                continue
            if inflow >= outflow:
                amount, txn_type = inflow - outflow, "Income"
            else:
                amount, txn_type = outflow - inflow, "Expense"
        else:
            amount = _parse_amount(amount_s.iloc[i], decimal_comma)
            if amount is None:
                issue("unparseable amount")
                continue
            if type_s is not None:
                label = _clean(type_s.iloc[i]).lower()
                txn_type = TYPE_SYNONYMS.get(label)
                if txn_type is None:
                    issue(f"unknown type {label!r}")
                    continue
                amount = abs(amount)
            else:
                txn_type = "Income" if amount >= 0 else "Expense"
                amount = abs(amount)

        account = _clean(col("Account").iloc[i]) if col("Account") is not None else ""
        if not account:
            issue("missing account")
            continue

        currency = _clean(col("Currency").iloc[i]) if col("Currency") is not None else ""
        rows.append({
            "period": pd.Timestamp(dt),
            "txn_type": txn_type,
            "amount": round(float(amount), 2),
            "account": account,
            "category": _clean(col("Category").iloc[i]) if col("Category") is not None else "",
            "subcategory": _clean(col("Subcategory").iloc[i]) if col("Subcategory") is not None else "",
            "note": _clean(col("Note").iloc[i]) if col("Note") is not None else "",
            "description": _clean(col("Description").iloc[i]) if col("Description") is not None else "",
            "currency": currency or base_currency(),
            "id": _clean(col("Id").iloc[i]) if col("Id") is not None else "",
            "transfer_group": _clean(col("TransferId").iloc[i]) if col("TransferId") is not None else "",
            "_source_row": i,
        })

    _link_transfer_pairs(rows)
    return {"rows": rows, "issues": issues, "skipped": sum(issues.values())}


def _link_transfer_pairs(rows: list[dict]) -> None:
    """Give transfer halves a shared transfer_group when the file didn't
    provide one — same greedy 1:1 match the legacy migration used
    (equal timestamp + amount, swapped account/category)."""
    if any(r["transfer_group"] for r in rows):
        return  # the file carries its own linking (e.g. our own export)
    outs: dict[tuple, list[dict]] = {}
    for r in rows:
        if r["txn_type"] == "Transfer-Out":
            key = (r["period"], r["amount"], r["account"], r["category"])
            outs.setdefault(key, []).append(r)
    for r in rows:
        if r["txn_type"] == "Transfer-In":
            key = (r["period"], r["amount"], r["category"], r["account"])
            candidates = outs.get(key)
            if candidates:
                mate = candidates.pop(0)
                link = uuid.uuid4().hex
                r["transfer_group"] = mate["transfer_group"] = link


# ── validation extras & dedupe ──────────────────────────────────────────────

def unknown_names(rows: list[dict], known_accounts: list[str],
                  known_categories: set[str]) -> dict:
    """Accounts / categories present in the import but not configured.
    Transfer rows are excluded from the category check (their Category holds
    the counter-account)."""
    accounts = {r["account"] for r in rows} - set(known_accounts)
    accounts |= {r["category"] for r in rows
                 if r["txn_type"] in _TRANSFER_TYPES and r["category"]} - set(known_accounts)
    categories = {r["category"] for r in rows
                  if r["txn_type"] not in _TRANSFER_TYPES and r["category"]}
    return {"accounts": sorted(accounts),
            "categories": sorted(categories - known_categories)}


def mark_duplicates(rows: list[dict], ledger: pd.DataFrame) -> dict:
    """Tag each row dict in place with `_dup`:
      "exact"   — the row's Id already exists in the ledger (our own export
                  re-imported): always skipped;
      "suspect" — same calendar day + amount + account + type as an existing
                  ledger row: user decides;
      None      — clean.
    Returns counts {"exact": n, "suspect": n}."""
    existing_ids = set(ledger["Id"]) if len(ledger) else set()
    if len(ledger):
        key = pd.MultiIndex.from_arrays([
            ledger["Period"].dt.normalize(),
            ledger["Amount"].round(2),
            ledger["Account"],
            ledger["Income/Expense"],
        ])
        existing_keys = set(key)
    else:
        existing_keys = set()

    counts = {"exact": 0, "suspect": 0}
    for r in rows:
        if r["id"] and r["id"] in existing_ids:
            r["_dup"] = "exact"
            counts["exact"] += 1
        elif (r["period"].normalize(), round(r["amount"], 2),
              r["account"], r["txn_type"]) in existing_keys:
            r["_dup"] = "suspect"
            counts["suspect"] += 1
        else:
            r["_dup"] = None
    return counts


# ── commit ──────────────────────────────────────────────────────────────────

def build_insert_tuples(rows: list[dict],
                        account_map: dict[str, str] | None = None) -> list[tuple]:
    """Convert accepted row dicts to store._INSERT tuples. `account_map`
    renames unknown accounts the user chose to map onto existing ones.
    File ids are kept when they look like our uuids (round-trip fidelity);
    transfer groups always get fresh link ids."""
    account_map = account_map or {}
    link_map: dict[str, str] = {}
    out = []
    for r in rows:
        rid = r["id"] if re.fullmatch(r"[0-9a-f]{32}", r["id"] or "") else uuid.uuid4().hex
        transfer_id = None
        if r["transfer_group"]:
            transfer_id = link_map.setdefault(r["transfer_group"], uuid.uuid4().hex)
        account = account_map.get(r["account"], r["account"])
        category = r["category"]
        if r["txn_type"] in _TRANSFER_TYPES:
            category = account_map.get(category, category)
        out.append((rid, r["period"].strftime(PERIOD_FMT), account, category,
                    r["subcategory"], r["note"], r["description"],
                    r["txn_type"], float(r["amount"]), r["currency"],
                    transfer_id))
    return out


def commit_rows(rows: list[dict], account_map: dict[str, str] | None = None,
                replace_ids: list[str] | None = None):
    """Insert the accepted rows, optionally deleting an earlier import's rows
    first (``replace_ids``). Returns ``(inserted_count, backup_path, new_ids)``
    where ``new_ids`` are the ledger ids of the rows just inserted (for the
    last-import manifest)."""
    from src.io import store
    tuples = build_insert_tuples(rows, account_map)
    new_ids = [t[0] for t in tuples]
    backup = store.replace_import(replace_ids or [], tuples)
    return len(tuples), backup, new_ids


# ── last-import manifest & file archive ──────────────────────────────────────
# The wizard records its most recent import so a later import can optionally
# replace exactly those rows, and archives each uploaded file next to the ledger
# backups so the source is never lost.

def _last_import_path() -> Path:
    from src.io import store
    return store.db_path().parent / "last_import.json"


def load_last_import() -> dict | None:
    path = _last_import_path()
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, OSError):
        return None


def save_last_import(manifest: dict) -> None:
    path = _last_import_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)


def clear_last_import() -> None:
    path = _last_import_path()
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def archive_upload(filename: str, content: bytes) -> Path:
    """Copy the raw uploaded file next to the ledger backups so the source of an
    import is always retrievable. Returns the archive path."""
    from datetime import datetime
    from src.io import store
    dest_dir = store.backups_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename or "import").strip("_") or "import"
    dest = dest_dir / f"import_{stamp}_{safe}"
    dest.write_bytes(content)
    return dest
