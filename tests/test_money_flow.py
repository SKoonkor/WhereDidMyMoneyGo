"""Money Flow figure: the interactive page chart locks the y-axis so pan/zoom act
only on the time axis; the compact home snapshot is left unlocked."""

from src.app.figures.money_flow import build_money_flow_figure
from tests.conftest import make_df


def _ledger():
    return make_df([
        {"Period": "2026-06-01", "Income/Expense": "Income", "Amount": 5000},
        {"Period": "2026-06-10", "Income/Expense": "Expense", "Amount": 1200},
        {"Period": "2026-06-20", "Income/Expense": "Expense", "Amount": 800},
    ])


def test_page_chart_locks_yaxis():
    fig = build_money_flow_figure(_ledger())          # compact=False (page chart)
    assert fig.layout.yaxis.fixedrange is True         # vertical pan/zoom disabled
    assert fig.layout.dragmode == "pan"                # horizontal pan stays


def test_compact_snapshot_leaves_yaxis_unlocked():
    fig = build_money_flow_figure(_ledger(), compact=True)
    assert not fig.layout.yaxis.fixedrange             # home snapshot untouched
