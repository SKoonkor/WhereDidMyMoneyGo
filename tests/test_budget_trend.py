"""Budget "Spending trend" drill-down: monthly series + grouped bar figure.

Both layers are pure (numpy/pandas/plotly, no Dash), so tests build a small multi-month
ledger with ``make_df``.
"""

import pandas as pd

from src.analytics.budget import monthly_category_series
from src.app.figures.budget_trend import build_spending_trend, home_window
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


def _long_series(label, n_months, value):
    """A single series spanning `n_months` consecutive months, constant `value`."""
    start = pd.Period("2020-01", "M")
    months = [start + i for i in range(n_months)]
    return {"label": label, "months": months, "values": [value] * n_months}


def test_default_range_spans_seven_months():
    # 8 months of history → the view opens on the last 7 (the new default window).
    fig = build_spending_trend([_long_series("Health", 8, 500.0)])
    lo, hi = pd.Timestamp(fig.layout.xaxis.range[0]), pd.Timestamp(fig.layout.xaxis.range[1])
    # 7 months inclusive is ~6 month-gaps; padded by ~half a month each side.
    assert 200 <= (hi - lo).days <= 230


def test_window_shrinks_to_cap_grouped_bars():
    # 4 selections × 7 months = 28 bars > 20 → window shrinks to 5 months (20 bars).
    df = _ledger()
    sel = [_long_series(f"S{i}", 12, 100.0) for i in range(4)]
    fig = build_spending_trend(sel, max_bars=20)
    lo, hi = pd.Timestamp(fig.layout.xaxis.range[0]), pd.Timestamp(fig.layout.xaxis.range[1])
    # 5 months → ~4 month-gaps (~120 days) + half-month padding each side.
    assert 130 <= (hi - lo).days <= 160


def test_bars_carry_formatted_labels_in_bar_colour():
    s = {"label": "Big", "months": [pd.Period("2026-05", "M"),
                                    pd.Period("2026-06", "M"),
                                    pd.Period("2026-07", "M")],
         "values": [1500.0, 2_300_000.0, 0.0]}
    fig = build_spending_trend([s])
    trace = fig.data[0]
    assert tuple(trace.text) == ("1.5k", "2.3M", "")   # k / M / blank-on-zero
    assert trace.textposition == "outside"
    assert trace.textfont.color == trace.marker.color   # label matches bar colour


def test_yaxis_is_locked():
    fig = build_spending_trend([_series(_ledger(), "Health", "Gym")])
    assert fig.layout.yaxis.fixedrange is True          # no vertical pan/zoom


# ── home_window (the Home-button / opening range) ─────────────────────────────

def _months(n):
    start = pd.Period("2020-01", "M")
    return [start + i for i in range(n)]


def test_home_window_none_when_empty():
    assert home_window([], 1) is None


def test_home_window_spans_seven_months_single_series():
    lo, hi = (pd.Timestamp(x) for x in home_window(_months(12), 1))
    assert 200 <= (hi - lo).days <= 230        # ~7 months + half-month padding


def test_home_window_shrinks_for_grouped_bars():
    # 4 series → 20//4 = 5 months (20 bars), even though 7 are requested.
    lo, hi = (pd.Timestamp(x) for x in home_window(_months(12), 4))
    assert 130 <= (hi - lo).days <= 160        # ~5 months


def test_home_window_clamped_to_available_history():
    # Only 3 months exist → window can't exceed them.
    lo, hi = (pd.Timestamp(x) for x in home_window(_months(3), 1))
    assert 70 <= (hi - lo).days <= 100         # ~3 months


def test_censor_masks_values():
    fig = build_spending_trend([_series(_ledger(), "Health", "Gym")], censor=True)
    assert "*****" in fig.data[0].hovertemplate
    assert fig.layout.yaxis.showticklabels is False
    # Value labels must not leak through in privacy mode.
    assert set(fig.data[0].text) == {""}
