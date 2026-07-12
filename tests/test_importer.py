"""Import pipeline: amount/date parsing, header guessing, and row assembly."""

import pandas as pd

from src.io.importer import (
    _parse_amount, _parse_dates, guess_mapping, parse_rows)


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
