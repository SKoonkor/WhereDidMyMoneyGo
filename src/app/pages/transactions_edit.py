"""Transaction tracking — edit/delete page (slide 19)."""

import dash
from dash import dcc, html

from src.app import theme
from src.app.txn_form import build_form
from src.io import store

dash.register_page(__name__, path_template="/transactions/edit/<txn_id>",
                   name="Edit Transaction")


def layout(txn_id=None, **_):
    txn = store.get_transaction(txn_id) if txn_id else None
    if txn is None:
        return html.Div(
            [
                html.H1("Transaction not found", style=theme.H1_STYLE),
                html.P("It may have been deleted.", style={"color": theme.MUTED}),
                dcc.Link("‹ Back to transactions", href="/transactions",
                         style={"color": theme.ACCENT}),
            ],
            style=theme.PAGE_STYLE,
        )
    if txn.get("ui_type") == "Adjustment":
        return html.Div(
            [
                html.H1("Balance adjustment", style=theme.H1_STYLE),
                html.P("This is a reconciliation entry (hidden cost). Manage your "
                       "balances from the Reconcile page.", style={"color": theme.MUTED}),
                dcc.Link("Go to Reconcile Balances", href="/reconcile",
                         style={"color": theme.ACCENT}),
            ],
            style=theme.PAGE_STYLE,
        )
    # Return to the month this transaction belongs to.
    origin_month = txn["period"].strftime("%Y-%m")
    return build_form("edit", initial=txn, origin_month=origin_month)
