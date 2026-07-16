"""The 'Tax already paid' pop-up helpers: ordinal-day rendering and the by-month
grouping (paid months with their transactions, unpaid months flagged)."""

import datetime

# Instantiate the Dash app first so the page module can register.
import src.app.app  # noqa: F401
from src.app.pages.income_tax import _ordinal, _month_groups, _payment_label


def _suffix(n):
    # _ordinal(n) -> [str(n), html.Sup(suffix)]
    return _ordinal(n)[1].children


def test_ordinal_suffixes():
    assert _ordinal(1)[0] == "1" and _suffix(1) == "st"
    assert _suffix(2) == "nd"
    assert _suffix(3) == "rd"
    assert _suffix(4) == "th"
    assert _suffix(11) == "th" and _suffix(12) == "th" and _suffix(13) == "th"
    assert _suffix(21) == "st" and _suffix(22) == "nd" and _suffix(23) == "rd"


def _pay(date, amount, cat="Bills", sub="Tax"):
    return {"date": date, "amount": amount, "category": cat, "subcategory": sub}


def test_month_groups_marks_paid_and_unpaid_completed_year():
    payments = [_pay("10-Mar-2026", 2_000.0), _pay("10-Sep-2026", 3_000.0)]
    groups = _month_groups(payments, 2026, today=datetime.date(2027, 1, 1))
    assert len(groups) == 12                       # completed year → all months
    mar = groups[2]
    assert mar["label"] == "Mar 2026" and mar["paid"] and mar["total"] == 2_000.0
    assert mar["items"] == [{"day": 10, "label": "Bills / Tax", "amount": 2_000.0}]
    assert groups[8]["paid"] and groups[8]["total"] == 3_000.0
    # Every other month is unpaid with no items.
    assert not groups[0]["paid"] and groups[0]["items"] == []
    assert sum(g["paid"] for g in groups) == 2


def test_month_groups_truncates_at_current_month_for_current_year():
    payments = [_pay("05-Feb-2026", 1_000.0)]
    groups = _month_groups(payments, 2026, today=datetime.date(2026, 7, 15))
    assert [g["label"] for g in groups] == [
        "Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026",
        "Jun 2026", "Jul 2026"]                     # future months not listed
    assert groups[1]["paid"] and not groups[0]["paid"]


def test_month_groups_groups_multiple_payments_in_a_month():
    payments = [_pay("20-Apr-2026", 1_500.0, sub="WHT"),
                _pay("05-Apr-2026", 2_000.0, sub="Tax")]
    groups = _month_groups(payments, 2026, today=datetime.date(2027, 1, 1))
    apr = groups[3]
    assert apr["total"] == 3_500.0
    # Items are ordered by day, oldest first.
    assert [it["day"] for it in apr["items"]] == [5, 20]
    assert apr["items"][0]["label"] == "Bills / Tax"
    assert apr["items"][1]["label"] == "Bills / WHT"


def test_payment_label_without_subcategory():
    assert _payment_label({"category": "Bills", "subcategory": ""}) == "Bills"
    assert _payment_label({"category": "Bills", "subcategory": "Tax"}) == "Bills / Tax"
