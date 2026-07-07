"""Account balance reconciliation page.

Register each account's real balance; the gap versus the tracked balance is
written as a dated balance-adjustment ("hidden cost") and the tracked balance
then matches reality going forward.
"""

from datetime import date

import dash
from dash import dcc, html, callback, ctx, ALL, Input, Output, State, no_update
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card, money_span
from src.app.data import get_df, account_names, refresh, CURRENCY
from src.analytics.reconciliation import (tracked_balances, hidden_cost_total,
                                          mark_reconciled, last_reconciled)
from src.io import writer

dash.register_page(__name__, path="/reconcile", name="Reconcile Balances", order=7)

_HEADER_STYLE = {"display": "flex", "gap": "12px", "alignItems": "center",
                 "padding": "8px 4px", "color": theme.MUTED, "fontSize": "13px",
                 "borderBottom": "1px solid var(--border)"}
_CELL = {"flex": "1", "textAlign": "right", "fontVariantNumeric": "tabular-nums"}
_NAME_CELL = {"flex": "1.4", "textAlign": "left"}


def _fmt(v: float) -> str:
    return f"{v:,.2f}"


def _diff_text(diff: float):
    cls = "amt-income" if diff > 0 else ("amt-expense" if diff < 0 else "")
    return money_span(f"{diff:+,.2f}" if diff else "0.00", className=cls)


def layout(**_):
    df = get_df()
    accounts = account_names()
    tracked = tracked_balances(df, accounts)
    order = list(tracked.keys())

    header = html.Div(
        [
            html.Div("Account", style=_NAME_CELL),
            html.Div("Tracked", style=_CELL),
            html.Div(f"Actual ({CURRENCY})", style={**_CELL, "flex": "1.2"}),
            html.Div("Discrepancy", style=_CELL),
        ],
        style=_HEADER_STYLE,
    )

    rows = []
    for acct in order:
        tb = tracked[acct]
        rows.append(html.Div(
            [
                html.Div(acct, style={**_NAME_CELL, "fontWeight": 600}),
                html.Div(money_span(_fmt(tb)),
                         style={**_CELL, "color": theme.MUTED}),
                html.Div(
                    dcc.Input(
                        id={"type": "recon-actual", "account": acct},
                        type="number", value=round(tb, 2),
                        style={**theme.INPUT_STYLE, "marginBottom": 0,
                               "textAlign": "right"},
                    ),
                    className="money-input", style={"flex": "1.2"},
                ),
                html.Div(_diff_text(0.0),
                         id={"type": "recon-diff", "account": acct}, style=_CELL),
            ],
            style={"display": "flex", "gap": "12px", "alignItems": "center",
                   "padding": "8px 4px", "borderBottom": "1px solid var(--border-soft)"},
        ))

    total_row = html.Div(
        [
            html.Div("Total discrepancy to record", style={"flex": "1", "fontWeight": 600}),
            html.Div(_diff_text(0.0), id="recon-total",
                     style={**_CELL, "fontWeight": 600, "fontSize": "16px"}),
        ],
        style={"display": "flex", "alignItems": "center", "padding": "12px 4px",
               "marginTop": "6px", "borderTop": "2px solid var(--border)"},
    )

    last = last_reconciled()
    last_txt = last.strftime("%d %b %Y") if last else "never"
    hidden = hidden_cost_total(df)

    return html.Div(
        [
            page_header("Reconcile Balances",
                        "Register each account's real balance. The gap is recorded "
                        "as a hidden cost (untracked amount)."),
            card(
                [
                    html.P("Enter balances as the app shows them — liabilities like "
                           "Credit Card are negative. Accounts you leave unchanged "
                           "record nothing.",
                           style={"color": theme.MUTED, "marginTop": 0, "fontSize": "13px"}),
                    header,
                    *rows,
                    total_row,
                    html.Div(
                        [
                            html.Button("Apply reconciliation", id="recon-save",
                                        n_clicks=0, style=theme.BUTTON_STYLE),
                            html.Div(id="recon-msg",
                                     style={"fontSize": "14px", "alignSelf": "center"}),
                        ],
                        style={"display": "flex", "gap": "16px", "marginTop": "18px",
                               "alignItems": "center"},
                    ),
                ],
                style={"maxWidth": "720px"},
            ),
            card(
                [
                    html.Div(
                        [html.Span("Recorded hidden cost (untracked)",
                                   style={"color": theme.MUTED}),
                         html.Span(money_span(f"{hidden:+,.2f} {CURRENCY}"),
                                   className=("amt-income" if hidden > 0
                                              else "amt-expense" if hidden < 0 else ""),
                                   style={"fontWeight": 600})],
                        style=theme.RESULT_ROW_STYLE,
                    ),
                    html.Div(
                        [html.Span("Last reconciled", style={"color": theme.MUTED}),
                         html.Span(last_txt, style={"fontWeight": 600})],
                        style={**theme.RESULT_ROW_STYLE, "borderBottom": "none"},
                    ),
                ],
                style={"maxWidth": "720px", "marginTop": "16px"},
            ),
        ],
        style=theme.PAGE_STYLE,
    )


@callback(
    Output({"type": "recon-diff", "account": ALL}, "children"),
    Output("recon-total", "children"),
    Input({"type": "recon-actual", "account": ALL}, "value"),
)
def _live_diff(actuals):
    accounts = [s["id"]["account"] for s in ctx.inputs_list[0]]
    tracked = tracked_balances(get_df(), account_names())
    diffs, total = [], 0.0
    for acct, actual in zip(accounts, actuals):
        diff = (float(actual) if actual is not None else tracked.get(acct, 0.0)) \
            - tracked.get(acct, 0.0)
        diffs.append(_diff_text(diff))
        total += diff
    return diffs, _diff_text(total)


@callback(
    Output("recon-msg", "children"),
    Output("recon-msg", "style"),
    Output({"type": "recon-actual", "account": ALL}, "value"),
    Input("recon-save", "n_clicks"),
    State({"type": "recon-actual", "account": ALL}, "value"),
    prevent_initial_call=True,
)
def _apply(n_clicks, actuals):
    if not n_clicks:
        raise PreventUpdate
    accounts = [s["id"]["account"] for s in ctx.states_list[0]]
    tracked = tracked_balances(get_df(), account_names())
    adjustments = {
        acct: (float(actual) - tracked.get(acct, 0.0))
        for acct, actual in zip(accounts, actuals)
        if actual is not None
    }
    written = writer.apply_reconciliation(adjustments)
    refresh()
    mark_reconciled(date.today())

    ok_style = {"fontSize": "14px", "alignSelf": "center", "color": theme.ACCENT}
    if written == 0:
        msg = "No discrepancies — nothing to record."
    else:
        msg = f"Recorded {written} balance adjustment{'s' if written != 1 else ''}."
    # Reset inputs to the new tracked balances (= entered actuals) so the live
    # callback redraws every discrepancy as 0.
    new_tracked = tracked_balances(get_df(), account_names())
    return msg, ok_style, [round(new_tracked.get(a, 0.0), 2) for a in accounts]
