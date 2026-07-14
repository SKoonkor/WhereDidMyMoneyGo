"""Budget "Spending trend" drill-down: monthly series + grouped bar figure.

Both layers are pure (numpy/pandas/plotly, no Dash), so tests build a small multi-month
ledger with ``make_df``.
"""

import pandas as pd

from src.analytics.budget import monthly_category_series
from src.app.figures.budget_trend import build_spending_trend
from tests.conftest import make_df


def _ledger():
    return make_df([
        {"Period": "2026-03-05", "Income/Expense": "Expense", "Category": "Health",
         "Subcategory": "Gym", "Amount": 1000},
        {"Period": "2026-05-05", "Income/Expense": "Expense", "Category": "Health",
         "Subcategory": "Gym", "Amount": 1200},
        {"Period": "2026-07-05", "Income/Expense": "Expense", "Category": "Health",
         "Subcategory": "Gym", "Amount": 1500},
        {"Period": "2026-07-06", "Income/Expense": "Expense", "Category": "Health",
         "Subcategory": "Clinic", "Amount": 800},
        {"Period": "2026-07-07", "Income/Expense": "Expense", "Category": "Social Life",
         "Subcategory": "Nightout", "Amount": 2000},
        # Income must never appear in a spending trend.
        {"Period": "2026-07-08", "Income/Expense": "Income", "Category": "Salary",
         "Amount": 40000},
    ])


# ── monthly_category_series ───────────────────────────────────────────────────

def test_series_sums_per_month_and_zero_fills():
    s = monthly_category_series(_ledger(), "Health", "Gym")
    assert [(str(m), v) for m, v in s] == [
        ("2026-03", 1000.0), ("2026-04", 0.0), ("2026-05", 1200.0),
        ("2026-06", 0.0), ("2026-07", 1500.0)]


def test_whole_category_equals_sum_of_subs():
    df = _ledger()
    whole = dict((m, v) for m, v in monthly_category_series(df, "Health"))
    gym = dict((m, v) for m, v in monthly_category_series(df, "Health", "Gym"))
    clinic = dict((m, v) for m, v in monthly_category_series(df, "Health", "Clinic"))
    for m in whole:
        assert whole[m] == gym[m] + clinic[m]
    # July has both subs.
    assert whole[pd.Period("2026-07", "M")] == 2300.0


def test_series_shares_month_axis_across_categories():
    df = _ledger()
    a = [m for m, _ in monthly_category_series(df, "Health", "Gym")]
    b = [m for m, _ in monthly_category_series(df, "Social Life", "Nightout")]
    assert a == b                       # same zero-filled month span → aligned bars


def test_series_ascending_and_empty_for_missing():
    df = _ledger()
    s = monthly_category_series(df, "Nope")
    assert [v for _, v in s] == [0.0, 0.0, 0.0, 0.0, 0.0]
    months = [m for m, _ in s]
    assert months == sorted(months)


# ── build_spending_trend ──────────────────────────────────────────────────────

def _series(df, cat, sub):
    ser = monthly_category_series(df, cat, sub)
    label = f"{cat}:{sub}" if sub else cat
    return {"label": label, "months": [m for m, _ in ser],
            "values": [v for _, v in ser]}


def test_one_bar_trace_per_selection_grouped():
    df = _ledger()
    fig = build_spending_trend([_series(df, "Health", "Gym"),
                                _series(df, "Social Life", "Nightout")])
    bars = [t for t in fig.data if t.type == "bar"]
    assert len(bars) == 2
    assert fig.layout.barmode == "group"
    assert {t.name for t in bars} == {"Health:Gym", "Social Life:Nightout"}
    assert fig.layout.showlegend is True


def test_single_selection_hides_legend():
    fig = build_spending_trend([_series(_ledger(), "Health", "Gym")])
    assert fig.layout.showlegend is False


def test_default_range_spans_five_months():
    fig = build_spending_trend([_series(_ledger(), "Health", "Gym")], default_months=5)
    lo, hi = pd.Timestamp(fig.layout.xaxis.range[0]), pd.Timestamp(fig.layout.xaxis.range[1])
    # Mar→Jul inclusive is ~5 months; padded by ~half a month each side.
    assert 140 <= (hi - lo).days <= 170


def test_censor_masks_values():
    fig = build_spending_trend([_series(_ledger(), "Health", "Gym")], censor=True)
    assert "*****" in fig.data[0].hovertemplate
    assert fig.layout.yaxis.showticklabels is False
