"""Income/Expense composition histogram (bar-chart twin of the donuts).

``build_hist_single`` is Dash-free — it takes a ledger DataFrame and a side ("Income"
or "Expense") and returns one bar figure (Income and Expense are separate figures so
narrow screens can stack them). These tests build a small ledger with ``make_df`` and
assert the bars mirror the pie's data prep and colours.
"""

import pandas as pd

from src.app.figures.pie import (build_hist_single, _category_breakdown, _shade,
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


def test_one_bar_trace_per_side():
    inc = build_hist_single(_ledger(), _START, _END, "Income")
    exp = build_hist_single(_ledger(), _START, _END, "Expense")
    assert len(_bars(inc)) == 1
    assert len(_bars(exp)) == 1


def test_interaction_is_locked():
    # No zoom/pan: both axes fixedrange, dragmode disabled — only hover/tap remains.
    fig = build_hist_single(_ledger(), _START, _END, "Income")
    assert fig.layout.xaxis.fixedrange is True
    assert fig.layout.yaxis.fixedrange is True
    assert fig.layout.dragmode is False


def test_bar_categories_and_order_match_category_breakdown():
    df = _ledger()
    inc_fig = build_hist_single(df, _START, _END, "Income", expense_order="amount")
    exp_fig = build_hist_single(df, _START, _END, "Expense", expense_order="amount")
    data = df[(df["Period"] >= pd.Timestamp(_START))]
    inc = _category_breakdown(data, "Income")
    exp = _category_breakdown(data, "Expense")
    assert list(_bars(inc_fig)[0].x) == list(inc["Category"])   # amount-desc, like the pie
    assert list(_bars(exp_fig)[0].x) == list(exp["Category"])


def test_bar_colours_match_pie_shade():
    inc_bar = _bars(build_hist_single(_ledger(), _START, _END, "Income"))[0]
    exp_bar = _bars(build_hist_single(_ledger(), _START, _END, "Expense"))[0]
    assert list(inc_bar.marker.color) == _shade(len(inc_bar.x), "Greens")
    assert list(exp_bar.marker.color) == _shade(len(exp_bar.x), "Reds")


def test_bucket_mode_orders_needs_before_wants():
    fig = build_hist_single(_ledger(), _START, _END, "Expense", expense_order="bucket")
    expense_bar = _bars(fig)[0]
    cats = list(expense_bar.x)
    # Food + Bills are Needs; Social Life is Wants — Needs come first.
    assert cats.index("Food") < cats.index("Social Life")
    assert cats.index("Bills") < cats.index("Social Life")
    # Needs blue, Wants orange (the Wants bar).
    colors = list(expense_bar.marker.color)
    assert colors[cats.index("Social Life")] in _shade(1, "Oranges")


def test_hidden_cost_adds_slate_bar():
    df = make_df([
        {"Period": "2026-06-05", "Income/Expense": "Expense", "Category": "Food",
         "Amount": 5_000},
        {"Period": "2026-06-06", "Income/Expense": "Adjustment-Out", "Category": "x",
         "Amount": 1_200},
    ])
    fig = build_hist_single(df, _START, _END, "Expense")
    expense_bar = _bars(fig)[0]
    assert "Hidden cost (untracked)" in list(expense_bar.x)
    assert list(expense_bar.marker.color)[-1] == _HIDDEN_COLOR


def test_censor_masks_values():
    fig = build_hist_single(_ledger(), _START, _END, "Income", censor=True)
    income_bar = _bars(fig)[0]
    assert "*****" in income_bar.hovertemplate
    assert all(t == "" for t in income_bar.text)          # no printed amounts
    assert fig.layout.yaxis.showticklabels is False


def test_empty_data_has_no_bars_but_notes_it():
    for side in ("Income", "Expense"):
        fig = build_hist_single(make_df([]), _START, _END, side)
        assert _bars(fig) == []
        texts = [a.text for a in fig.layout.annotations]
        assert texts.count("No data") == 1
