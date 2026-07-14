"""Income/Expense composition histogram (bar-chart twin of the donuts).

``build_hist_figure`` is Dash-free — it takes a ledger DataFrame — so these tests build a
small ledger with ``make_df`` and assert the bars mirror the pie's data prep and colours.
"""

import pandas as pd

from src.app.figures.pie import (build_hist_figure, _category_breakdown, _shade,
                                 _HIDDEN_COLOR)
from src.analytics import budget as B
from tests.conftest import make_df

_START, _END = "2026-06-01", "2026-06-30"


def _ledger():
    return make_df([
        {"Period": "2026-06-05", "Income/Expense": "Income", "Category": "Salary",
         "Amount": 40_000},
        {"Period": "2026-06-06", "Income/Expense": "Income", "Category": "Bonus",
         "Amount": 8_000},
        {"Period": "2026-06-07", "Income/Expense": "Expense", "Category": "Food",
         "Amount": 6_000},
        {"Period": "2026-06-08", "Income/Expense": "Expense", "Category": "Social Life",
         "Amount": 4_000},
        {"Period": "2026-06-09", "Income/Expense": "Expense", "Category": "Bills",
         "Amount": 3_000},
    ])


def _bars(fig):
    return [t for t in fig.data if t.type == "bar"]


def test_two_bar_traces_income_and_expense():
    fig = build_hist_figure(_ledger(), _START, _END)
    bars = _bars(fig)
    assert len(bars) == 2


def test_bar_categories_and_order_match_category_breakdown():
    df = _ledger()
    fig = build_hist_figure(df, _START, _END, expense_order="amount")
    data = df[(df["Period"] >= pd.Timestamp(_START))]
    inc = _category_breakdown(data, "Income")
    exp = _category_breakdown(data, "Expense")
    income_bar, expense_bar = _bars(fig)
    assert list(income_bar.x) == list(inc["Category"])       # amount-desc, like the pie
    assert list(expense_bar.x) == list(exp["Category"])


def test_bar_colours_match_pie_shade():
    fig = build_hist_figure(_ledger(), _START, _END, expense_order="amount")
    income_bar, expense_bar = _bars(fig)
    assert list(income_bar.marker.color) == _shade(len(income_bar.x), "Greens")
    assert list(expense_bar.marker.color) == _shade(len(expense_bar.x), "Reds")


def test_bucket_mode_orders_needs_before_wants():
    fig = build_hist_figure(_ledger(), _START, _END, expense_order="bucket")
    expense_bar = _bars(fig)[1]
    cats = list(expense_bar.x)
    # Food + Bills are Needs; Social Life is Wants — Needs come first.
    assert cats.index("Food") < cats.index("Social Life")
    assert cats.index("Bills") < cats.index("Social Life")
    # Needs blue, Wants orange (first Needs bar vs the Wants bar).
    colors = list(expense_bar.marker.color)
    assert colors[cats.index("Social Life")] in _shade(1, "Oranges")


def test_hidden_cost_adds_slate_bar():
    df = make_df([
        {"Period": "2026-06-05", "Income/Expense": "Expense", "Category": "Food",
         "Amount": 5_000},
        {"Period": "2026-06-06", "Income/Expense": "Adjustment-Out", "Category": "x",
         "Amount": 1_200},
    ])
    fig = build_hist_figure(df, _START, _END)
    expense_bar = next(t for t in _bars(fig)
                       if "Hidden cost (untracked)" in list(t.x))
    assert list(expense_bar.marker.color)[-1] == _HIDDEN_COLOR


def test_censor_masks_values():
    fig = build_hist_figure(_ledger(), _START, _END, censor=True)
    income_bar = _bars(fig)[0]
    assert "*****" in income_bar.hovertemplate
    assert all(t == "" for t in income_bar.text)          # no printed amounts
    assert fig.layout.yaxis.showticklabels is False


def test_empty_data_has_no_bars_but_notes_it():
    fig = build_hist_figure(make_df([]), _START, _END)
    assert _bars(fig) == []
    texts = [a.text for a in fig.layout.annotations]
    assert texts.count("No data") == 2
