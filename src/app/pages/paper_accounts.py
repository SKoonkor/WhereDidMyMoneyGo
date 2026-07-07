"""Paper Trading — Accounts (sessions) picker.

The landing page for Paper Trading: lists every practice account, lets you create
or delete them (soft-delete with a restore list), and opens the trading page for
whichever account you select. State lives in one file per account under
config/paper_accounts/ (see src.analytics.paper).
"""

from dash import (dcc, html, callback, Input, Output, State, ctx, no_update, ALL,
                  register_page)
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card
from src.analytics import paper as P

register_page(__name__, path="/paper", name="Paper Trading (Live Market Data)",
              order=9)

_HIDDEN = {"display": "none"}
_FLEX = {"display": "flex", "gap": "8px", "alignItems": "center", "flexWrap": "wrap"}


def _money(v: float) -> str:
    return f"{v:,.2f}"


def _pl_class(v: float) -> str:
    return "amt-income" if v > 0 else "amt-expense" if v < 0 else ""


def _date(iso: str) -> str:
    return (iso or "")[:10]


# ── Render helpers ────────────────────────────────────────────────────────────

def _account_card(a: dict) -> html.Div:
    pl = a["pl"]
    stats = html.Div(
        [
            html.Div(a["name"], className="paper-acct-name"),
            html.Div([
                html.Span(f"${_money(a['value'])}", className="paper-acct-value"),
                html.Span(f"  {pl:+,.2f} ({a['pl_pct']:+.2f}%)",
                          className=_pl_class(pl), style={"fontSize": "13px"}),
            ]),
            html.Div(f"Created {_date(a['created'])} · {a['positions']} open position"
                     f"{'' if a['positions'] == 1 else 's'}",
                     style={"color": theme.MUTED, "fontSize": "12px"}),
        ],
        id={"type": "paper-acct-open", "id": a["id"]}, n_clicks=0,
        className="paper-acct-open",
    )
    delete = html.Button("🗑", id={"type": "paper-acct-del", "id": a["id"]},
                         n_clicks=0, className="paper-acct-del", title="Delete account")
    cls = "paper-acct-card" + (" selected" if a.get("selected") else "")
    return html.Div([stats, delete], className=cls)


def _accounts_list() -> html.Div:
    accounts = P.list_accounts()
    if not accounts:
        return html.Div("No accounts yet — create one below to start trading.",
                        style={"color": theme.MUTED, "padding": "8px 0"})
    return html.Div([_account_card(a) for a in accounts], className="paper-acct-grid")


def _deleted_list() -> html.Div | None:
    backups = P.list_backups()
    if not backups:
        return None
    rows = []
    for b in backups:
        rows.append(html.Div(
            [
                html.Div([
                    html.Span(b["name"], style={"fontWeight": 600}),
                    html.Span(f"  created {_date(b['created'])}",
                              style={"color": theme.MUTED, "fontSize": "12px"}),
                ]),
                html.Button("Restore", id={"type": "paper-acct-restore",
                                           "file": b["file"]}, n_clicks=0,
                            style=theme.PERIOD_BUTTON_STYLE),
            ],
            className="paper-acct-deleted-row",
        ))
    return card(
        [html.H4("Recently deleted", style={"margin": "0 0 8px"}), *rows],
        style={"marginTop": "20px"},
    )


# ── Layout ────────────────────────────────────────────────────────────────────

def layout(**_):
    return html.Div(
        [
            page_header(["Paper Trading ",
                         html.Span("(Live Market Data)", className="title-sub")],
                        "Your practice accounts. Pick one to start trading, or "
                        "create a new account below."),
            dcc.Location(id="paper-acct-nav", refresh=True),
            dcc.Store(id="paper-acct-refresh", data=0),
            dcc.Store(id="paper-del-target"),
            dcc.Store(id="paper-acct-pending"),   # account create awaiting confirm
            html.Div(id="paper-acct-list", style={"marginTop": "8px"}),
            card(
                [
                    html.H4("New account", style={"margin": "0 0 10px"}),
                    html.Div(
                        [
                            dcc.Input(id="paper-acct-name", type="text",
                                      placeholder="Account name (e.g. Growth)",
                                      style={**theme.INPUT_STYLE, "marginBottom": 0,
                                             "flex": "1", "minWidth": "160px"}),
                            dcc.Input(id="paper-acct-cash", type="number", min=0,
                                      step=1000, placeholder="Starting $ (optional)",
                                      style={**theme.INPUT_STYLE, "marginBottom": 0,
                                             "width": "170px"}),
                            html.Button("Create account", id="paper-acct-create",
                                        n_clicks=0, style=theme.BUTTON_STYLE),
                        ],
                        style=_FLEX,
                    ),
                    html.Div(id="paper-acct-msg",
                             style={"fontSize": "13px", "marginTop": "8px",
                                    "minHeight": "18px"}),
                ],
                style={"marginTop": "20px"},
            ),
            html.Div(id="paper-acct-deleted"),
            # Delete confirmation modal.
            html.Div(
                html.Div(
                    [
                        html.H3("Delete account"),
                        html.P(["Delete ", html.Span(id="paper-del-name",
                                                     style={"fontWeight": 600}),
                                "? It moves to Recently deleted and can be restored."],
                               style={"color": theme.MUTED}),
                        html.Div(
                            [
                                html.Button("Delete", id="paper-del-yes", n_clicks=0,
                                            style={**theme.PERIOD_BUTTON_STYLE,
                                                   "color": theme.EXPENSE_COLOR,
                                                   "borderColor": theme.EXPENSE_COLOR}),
                                html.Button("Cancel", id="paper-del-no", n_clicks=0,
                                            style=theme.PERIOD_BUTTON_STYLE),
                            ],
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card",
                ),
                id="paper-del-modal", className="modal-overlay", style=_HIDDEN,
            ),
            # Create-account confirmation (only when a starting balance is given).
            html.Div(
                html.Div(
                    [
                        html.H3("Confirm new account"),
                        html.Div(id="paper-acct-confirm-body",
                                 style={"margin": "8px 0 4px", "lineHeight": "1.7"}),
                        html.Div(
                            [
                                html.Button("Confirm", id="paper-acct-confirm-yes",
                                            n_clicks=0, style=theme.BUTTON_STYLE),
                                html.Button("Cancel", id="paper-acct-confirm-no",
                                            n_clicks=0, style=theme.PERIOD_BUTTON_STYLE),
                            ],
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card",
                ),
                id="paper-acct-confirm-modal", className="modal-overlay", style=_HIDDEN,
            ),
        ],
        style=theme.PAGE_STYLE,
    )


# ── Callbacks ─────────────────────────────────────────────────────────────────

@callback(
    Output("paper-acct-list", "children"),
    Output("paper-acct-deleted", "children"),
    Input("paper-acct-refresh", "data"),
)
def _render_lists(_refresh):
    return _accounts_list(), _deleted_list()


def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# Create directly when opening empty ($0); confirm first when a starting balance is set.
@callback(
    Output("paper-acct-refresh", "data", allow_duplicate=True),
    Output("paper-acct-msg", "children"),
    Output("paper-acct-name", "value"),
    Output("paper-acct-cash", "value"),
    Output("paper-acct-confirm-modal", "style"),
    Output("paper-acct-confirm-body", "children"),
    Output("paper-acct-pending", "data"),
    Input("paper-acct-create", "n_clicks"),
    State("paper-acct-name", "value"),
    State("paper-acct-cash", "value"),
    State("paper-acct-refresh", "data"),
    prevent_initial_call=True,
)
def _create(_n, name, cash, refresh):
    amount = _to_float(cash)
    if amount and amount > 0:                     # guard money injection with a popup
        if not (name or "").strip():
            return no_update, "Enter an account name.", no_update, no_update, \
                no_update, no_update, no_update
        body = html.Div([html.Span("Create account "),
                         html.Span(f"“{name.strip()}”",
                                   style={"fontWeight": 700}),
                         html.Span(" with "),
                         html.Span(f"${amount:,.2f}", style={"fontWeight": 700}),
                         html.Span(" starting cash.")])
        return no_update, "", no_update, no_update, {"display": "flex"}, body, \
            {"name": name, "cash": amount}
    try:                                          # $0 → create straight away
        P.create_account(name, cash)
    except P.TradeError as exc:
        return no_update, str(exc), no_update, no_update, no_update, no_update, no_update
    return (refresh or 0) + 1, "", None, None, no_update, no_update, no_update


@callback(
    Output("paper-acct-confirm-modal", "style", allow_duplicate=True),
    Output("paper-acct-refresh", "data", allow_duplicate=True),
    Output("paper-acct-msg", "children", allow_duplicate=True),
    Output("paper-acct-name", "value", allow_duplicate=True),
    Output("paper-acct-cash", "value", allow_duplicate=True),
    Output("paper-acct-pending", "data", allow_duplicate=True),
    Input("paper-acct-confirm-yes", "n_clicks"),
    Input("paper-acct-confirm-no", "n_clicks"),
    State("paper-acct-pending", "data"),
    State("paper-acct-refresh", "data"),
    prevent_initial_call=True,
)
def _acct_confirm(_yes, _no, pending, refresh):
    if ctx.triggered_id == "paper-acct-confirm-no" or not pending:
        return _HIDDEN, no_update, no_update, no_update, no_update, None
    try:
        P.create_account(pending["name"], pending["cash"])
    except P.TradeError as exc:
        return _HIDDEN, no_update, str(exc), no_update, no_update, None
    return _HIDDEN, (refresh or 0) + 1, "", None, None, None


@callback(
    Output("paper-acct-nav", "href"),
    Input({"type": "paper-acct-open", "id": ALL}, "n_clicks"),
    prevent_initial_call=True,
)
def _select(clicks):
    if not any(clicks or []):
        raise PreventUpdate
    P.select_account(ctx.triggered_id["id"])
    return "/paper/trade"


@callback(
    Output("paper-del-modal", "style"),
    Output("paper-del-target", "data"),
    Output("paper-del-name", "children"),
    Input({"type": "paper-acct-del", "id": ALL}, "n_clicks"),
    prevent_initial_call=True,
)
def _del_open(clicks):
    if not any(clicks or []):
        raise PreventUpdate
    acct_id = ctx.triggered_id["id"]
    name = next((a["name"] for a in P.list_accounts() if a["id"] == acct_id), "this account")
    return {"display": "flex"}, acct_id, name


@callback(
    Output("paper-del-modal", "style", allow_duplicate=True),
    Output("paper-acct-refresh", "data", allow_duplicate=True),
    Input("paper-del-yes", "n_clicks"),
    Input("paper-del-no", "n_clicks"),
    State("paper-del-target", "data"),
    State("paper-acct-refresh", "data"),
    prevent_initial_call=True,
)
def _del_confirm(_yes, _no, target, refresh):
    if ctx.triggered_id == "paper-del-yes" and target:
        P.delete_account(target)
        return _HIDDEN, (refresh or 0) + 1
    return _HIDDEN, no_update


@callback(
    Output("paper-acct-refresh", "data", allow_duplicate=True),
    Input({"type": "paper-acct-restore", "file": ALL}, "n_clicks"),
    State("paper-acct-refresh", "data"),
    prevent_initial_call=True,
)
def _restore(clicks, refresh):
    if not any(clicks or []):
        raise PreventUpdate
    try:
        P.restore_account(ctx.triggered_id["file"])
    except P.TradeError:
        raise PreventUpdate
    return (refresh or 0) + 1
