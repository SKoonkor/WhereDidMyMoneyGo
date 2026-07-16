"""Import pipeline: amount/date parsing, header guessing, and row assembly."""

import pandas as pd

from src.io.importer import (
    TYPE_SYNONYMS, _parse_amount, _parse_dates, detect_preset, guess_mapping,
    parse_rows, read_table)


def test_parse_amount_dot_decimal():
    assert _parse_amount("1,234.56", decimal_comma=False) == 1234.56
    assert _parse_amount("$1,000", decimal_comma=False) == 1000.0


def test_parse_amount_comma_decimal():
    assert _parse_amount("1.234,56", decimal_comma=True) == 1234.56


def test_parse_amount_parentheses_are_negative():
    assert _parse_amount("(50.00)", decimal_comma=False) == -50.0


def test_parse_amount_blank_and_junk():
    assert _parse_amount("", decimal_comma=False) is None
    assert _parse_amount(None, decimal_comma=False) is None
    assert _parse_amount("n/a", decimal_comma=False) is None


def test_parse_dates_orderings():
    s = pd.Series(["05/03/2026"])
    assert _parse_dates(s, "dmy").iloc[0] == pd.Timestamp("2026-03-05")
    assert _parse_dates(s, "mdy").iloc[0] == pd.Timestamp("2026-05-03")


def test_guess_mapping_matches_known_headers():
    g = guess_mapping(["Date", "Amount", "Account", "Memo"])
    cols = g["columns"]
    assert cols["Date"] == "Date"
    assert cols["Amount"] == "Amount"
    assert cols["Account"] == "Account"
    assert cols["Description"] == "Memo"          # memo -> Description


def test_parse_rows_signed_amount_mode(ledger_env):
    # No Type column: the sign of Amount decides Income vs Expense.
    raw = pd.DataFrame({"Date": ["2026-01-05", "2026-01-06"],
                        "Amount": ["1000", "-250"],
                        "Account": ["Bank", "Bank"]})
    profile = {"columns": {"Date": "Date", "Amount": "Amount", "Account": "Account"},
               "options": {"date_order": "ymd", "decimal": "dot"}}
    out = parse_rows(raw, profile)
    assert out["skipped"] == 0
    types = [(r["txn_type"], r["amount"]) for r in out["rows"]]
    assert ("Income", 1000.0) in types
    assert ("Expense", 250.0) in types            # sign dropped, type derived


def test_parse_rows_reports_bad_date(ledger_env):
    raw = pd.DataFrame({"Date": ["not-a-date"], "Amount": ["10"],
                        "Account": ["Bank"]})
    profile = {"columns": {"Date": "Date", "Amount": "Amount", "Account": "Account"},
               "options": {"date_order": "auto", "decimal": "dot"}}
    out = parse_rows(raw, profile)
    assert out["rows"] == []
    assert out["skipped"] == 1
    assert "unparseable date" in out["issues"]


def test_parse_rows_requires_account(ledger_env):
    raw = pd.DataFrame({"Date": ["2026-01-05"], "Amount": ["10"],
                        "Account": [""]})
    profile = {"columns": {"Date": "Date", "Amount": "Amount", "Account": "Account"},
               "options": {"date_order": "ymd", "decimal": "dot"}}
    out = parse_rows(raw, profile)
    assert out["skipped"] == 1 and "missing account" in out["issues"]


# ── Thai app support (MeowJot et al.) ────────────────────────────────────────

def test_parse_dates_buddhist_era():
    # BE 2568 = CE 2025; CE years must pass through untouched.
    s = pd.Series(["1/12/2568", "05/03/2026"])
    parsed = _parse_dates(s, "dmy")
    assert parsed.iloc[0] == pd.Timestamp("2025-12-01")
    assert parsed.iloc[1] == pd.Timestamp("2026-03-05")


def test_parse_dates_buddhist_era_auto_order():
    assert _parse_dates(pd.Series(["2568-12-01"]), "auto").iloc[0] == \
        pd.Timestamp("2025-12-01")


def test_thai_type_synonyms():
    assert TYPE_SYNONYMS["รายรับ"] == "Income"
    assert TYPE_SYNONYMS["รายจ่าย"] == "Expense"
    assert TYPE_SYNONYMS["โอนเข้า"] == "Transfer-In"
    assert TYPE_SYNONYMS["โอนออก"] == "Transfer-Out"


def test_guess_mapping_thai_headers():
    g = guess_mapping(["วันที่", "ประเภท", "จำนวน", "หมวดหมู่", "บันทึก"])
    cols = g["columns"]
    assert cols["Date"] == "วันที่"
    assert cols["Type"] == "ประเภท"
    assert cols["Amount"] == "จำนวน"
    assert cols["Category"] == "หมวดหมู่"
    assert cols["Note"] == "บันทึก"


# Header + rows modeled on the official sample export
# (meowjot.com/example/Export_sample.csv).
_MEOWJOT_HEADERS = ["วันที่", "เวลา", "ประเภท", "หมวดหมู่", "แท็ก", "จำนวน",
                    "โน๊ต", "ช่องทางจ่าย", "จ่ายจาก", "ธนาคารผู้รับ", "ผู้รับ"]


def test_meowjot_preset_detected():
    preset = detect_preset(_MEOWJOT_HEADERS)
    assert preset is not None and "MeowJot" in preset["name"]
    assert preset["columns"]["Date"] == "วันที่"
    assert preset["columns"]["Account"] == "จ่ายจาก"
    assert preset["options"]["date_order"] == "dmy"


def test_meowjot_rows_parse(ledger_env):
    raw = pd.DataFrame([
        ["1/12/2568", "12:35", "รายจ่าย", "อาหาร", "#ข้าวกลางวัน", "-290",
         "ข้าวมันไก่", "บัญชี", "กสิกรไทย", "-", "บริษัท สบาย สบาย จำกัด"],
        ["3/12/2568", "17:55", "รายจ่าย", "สุขภาพ, ดูแลตัวเอง", "-", "-20",
         "-", "บัญชี", "กรุงไทย", "กสิกรไทย", "การกีฬาสุขภาพดี"],
        ["4/12/2568", "09:00", "รายรับ", "เงินเดือน", "-", "50000",
         "-", "บัญชี", "กสิกรไทย", "-", "-"],
    ], columns=_MEOWJOT_HEADERS)
    out = parse_rows(raw, detect_preset(_MEOWJOT_HEADERS))
    assert out["skipped"] == 0 and len(out["rows"]) == 3

    lunch, health, salary = out["rows"]
    assert lunch["period"] == pd.Timestamp("2025-12-01")     # BE → CE
    assert (lunch["txn_type"], lunch["amount"]) == ("Expense", 290.0)
    assert lunch["category"] == "อาหาร"
    assert lunch["account"] == "กสิกรไทย"
    assert lunch["note"] == "ข้าวมันไก่"
    assert health["category"] == "สุขภาพ, ดูแลตัวเอง"        # quoted comma kept
    assert health["note"] == ""                              # "-" placeholder
    assert (salary["txn_type"], salary["amount"]) == ("Income", 50000.0)


def test_read_table_utf16():
    # Money Lover CSV exports are UTF-16 with a BOM.
    content = "Date,Amount,Wallet\n2026-01-05,-100,Cash\n".encode("utf-16")
    df = read_table("moneylover.csv", content)
    assert list(df.columns) == ["Date", "Amount", "Wallet"]
    assert df.iloc[0]["Wallet"] == "Cash"
