"""Settings page — edit config/settings.toml values in the app.

Reads the current values from the cached config and writes changes back with
``config.save_settings`` (in-place, comment-preserving). After saving it clears
the config cache so emergency-fund settings take effect on the next render.
"""

from __future__ import annotations

import dash
from dash import dcc, html, callback, ctx, ALL, Input, Output, State
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header
from src.app.data import (get_config, emergency_fund_config, privacy_config,
                          account_names, refresh_config)
from src.utils.config import save_settings

dash.register_page(__name__, path="/settings", name="Settings", order=8)


def _field(label: str, control, hint: str | None = None) -> html.Div:
    children = [html.Label(label, style={"color": theme.MUTED, "fontSize": "13px"}),
                control]
    if hint:
        children.append(html.Div(hint, style={"color": theme.MUTED, "fontSize": "12px",
                                               "marginTop": "4px"}))
    return html.Div(children, style={"marginBottom": "14px"})


def _savings_rows(accounts: list[str]) -> list:
    """One dropdown per pooled savings account; a remove button appears per row
    only once there is more than one account."""
    accounts = accounts or ["Savings"]
    removable = len(accounts) > 1
    names = account_names()
    rows = []
    for i, acct in enumerate(accounts):
        # Keep the chosen account selectable even if it isn't in the current list.
        options = list(dict.fromkeys([*names, acct])) if acct else names
        children = [
            dcc.Dropdown(id={"type": "set-ef-acct", "index": i},
                         options=[{"label": a, "value": a} for a in options],
                         value=acct, clearable=False,
                         style={"flex": "1", "maxWidth": "260px"}),
        ]
        if removable:
            children.append(
                html.Button("− remove account",
                            id={"type": "set-ef-acct-remove", "index": i}, n_clicks=0,
                            className="nav-btn",
                            style={"color": theme.EXPENSE_COLOR,
                                   "borderColor": theme.EXPENSE_COLOR,
                                   "whiteSpace": "nowrap"}))
        rows.append(html.Div(children, style={"display": "flex", "gap": "8px",
                                              "alignItems": "center",
                                              "marginTop": "6px"}))
    return rows


def layout(**_):
    general = get_config().get("settings", {}).get("general", {})
    ef = emergency_fund_config()

    general_card = html.Div(
        [
            html.H2("General", style={"color": theme.INK, "marginTop": 0}),
            _field("App name",
                   dcc.Input(id="set-app-name", type="text",
                             value=general.get("app_name", "Money Tracker"),
                             style={**theme.INPUT_STYLE, "marginTop": "4px"})),
            _field("Base currency",
                   dcc.Input(id="set-currency", type="text",
                             value=general.get("base_currency", "THB"),
                             style={**theme.INPUT_STYLE, "marginTop": "4px", "width": "120px",
                                    "marginLeft": "10px"}),
                   hint="Stamped on new transactions. The display currency across figures "
                        "updates fully after an app restart."),
        ],
        style=theme.CARD_STYLE,
    )

    ef_card = html.Div(
        [
            html.H2("Emergency fund", style={"color": theme.INK, "marginTop": 0}),
            _field("Monthly required expenses",
                   dcc.Input(id="set-ef-monthly", type="number", min=0,
                             value=ef["monthly_required"], className="no-spin",
                             style={**theme.INPUT_STYLE, "marginTop": "4px", "width": "180px",
                                    "marginLeft": "10px"})),
            _field("Target months",
                   dcc.Input(id="set-ef-months", type="number", min=1, max=60, step=1,
                             value=ef["target_months"], className="no-spin",
                             style={**theme.INPUT_STYLE, "marginTop": "4px", "width": "120px",
                                    "marginLeft": "10px"}),
                   hint="Emergency-fund target = target months × monthly required expenses."),
            _field("Savings account(s)",
                   html.Div(
                       [
                           dcc.Store(id="set-ef-accounts-store",
                                     data=ef["savings_accounts"]),
                           html.Div(id="set-ef-accounts"),
                           html.Button("+ savings account", id="set-ef-acct-add",
                                       n_clicks=0, className="nav-btn today",
                                       style={"marginTop": "6px"}),
                       ]),
                   hint="The Financial Goals savings pool combines the balances of "
                        "all listed accounts."),
        ],
        style={**theme.CARD_STYLE, "marginTop": "16px"},
    )

    pc = privacy_config()
    privacy_card = html.Div(
        [
            html.H2("Privacy", style={"color": theme.INK, "marginTop": 0}),
            _field(
                "Auto-privacy",
                dcc.Checklist(
                    id="set-privacy-auto",
                    options=[{"label": " Hide amounts automatically when the home "
                                       "page is left idle", "value": "on"}],
                    value=(["on"] if pc["auto_enabled"] else []),
                    style={"marginTop": "4px", "color": theme.INK, "fontSize": "14px"},
                    inputStyle={"marginRight": "6px"},
                ),
            ),
            _field(
                "Idle delay (seconds)",
                dcc.Input(id="set-privacy-seconds", type="number", min=1, max=3600, step=1,
                          value=pc["idle_seconds"], className="no-spin",
                          style={**theme.INPUT_STYLE, "marginTop": "4px", "width": "120px",
                                 "marginLeft": "10px"}),
                hint="Amounts stay hidden until you click the eye toggle to reveal them.",
            ),
        ],
        style={**theme.CARD_STYLE, "marginTop": "16px"},
    )

    save_row = html.Div(
        [
            html.Button("Save settings", id="set-save", n_clicks=0, style=theme.BUTTON_STYLE),
            html.Span(id="set-msg", style={"alignSelf": "center", "fontSize": "14px"}),
        ],
        style={"display": "flex", "gap": "14px", "alignItems": "center", "marginTop": "16px"},
    )

    tools_card = html.Div(
        [
            html.H2("Account tools", style={"color": theme.INK, "marginTop": 0}),
            html.Div("Transaction data", style={"color": theme.MUTED, "fontSize": "13px",
                                                "marginTop": "6px"}),
            html.Div(
                [
                    dcc.Link("⬇ Import", href="/import", className="home-action-btn view",
                             style={"flex": "1", "margin": "8px 0 0"}),
                    dcc.Link("⬆ Export", href="/transactions", className="home-action-btn view",
                             style={"flex": "1", "margin": "8px 0 0"}),
                ],
                style={"display": "flex", "gap": "10px"},
            ),
            dcc.Link("Reconcile balances", href="/reconcile", className="home-action-btn view"),
            dcc.Link("Manage accounts & categories", href="/manage",
                     className="home-action-btn view"),
            dcc.Link("Backup & restore", href="/backup", className="home-action-btn view"),

            html.Hr(style={"border": "none", "borderTop": "1px solid var(--border)",
                           "margin": "16px 0 10px"}),
            html.Button("Remove transactions", id="set-remove-btn", n_clicks=0,
                        style={**theme.BUTTON_STYLE, "background": theme.EXPENSE_COLOR,
                               "color": "#fff", "width": "100%"}),
            dcc.ConfirmDialog(
                id="set-remove-confirm",
                message="⚠ Danger Zone\n\nThe next screen lets you permanently "
                        "delete transactions within a date range you choose. "
                        "Deletions are backed up first, but cannot be undone from "
                        "that page.\n\nOpen the Remove Transactions tool?"),
            dcc.Location(id="set-remove-nav", refresh="callback-nav"),
        ],
        style=theme.CARD_STYLE,
    )

    return html.Div(
        [
            page_header("Settings", "Edit your app configuration.", back=("Home", "/")),
            html.Div(
                [
                    html.Div([general_card, ef_card, privacy_card, save_row],
                             style={"flex": "1", "maxWidth": "560px", "marginRight": "20px"}),
                    html.Div(tools_card, style={"flex": "0 0 260px"}),
                ],
                style={"display": "flex", "alignItems": "flex-start"},
            ),
        ],
        style=theme.PAGE_STYLE,
    )


@callback(
    Output("set-msg", "children"),
    Output("set-msg", "style"),
    Input("set-save", "n_clicks"),
    State("set-app-name", "value"),
    State("set-currency", "value"),
    State("set-ef-monthly", "value"),
    State("set-ef-months", "value"),
    State({"type": "set-ef-acct", "index": ALL}, "value"),
    State("set-privacy-auto", "value"),
    State("set-privacy-seconds", "value"),
    prevent_initial_call=True,
)
def _save(n, app_name, currency, monthly, months, accounts, privacy_auto, privacy_seconds):
    if not n:
        raise PreventUpdate
    ok = {"alignSelf": "center", "fontSize": "14px", "color": theme.ACCENT}
    err = {"alignSelf": "center", "fontSize": "14px", "color": theme.EXPENSE_COLOR}
    # Dedupe, drop blanks, keep order; never persist an empty pool.
    savings = list(dict.fromkeys(
        a.strip() for a in (accounts or []) if a and a.strip())) or ["Savings"]
    try:
        save_settings({
            "general": {
                "app_name": (app_name or "Money Tracker").strip(),
                "base_currency": (currency or "THB").strip(),
            },
            "emergency_fund": {
                "monthly_required_expenses": float(monthly or 0),
                "target_months": int(months or 1),
                "savings_accounts": savings,
            },
            "privacy": {
                "auto_enabled": bool(privacy_auto),
                "idle_seconds": max(1, int(privacy_seconds or 10)),
            },
        })
        refresh_config()
        return "Saved.", ok
    except Exception as exc:  # surface any write/validation error to the user
        return f"Could not save: {exc}", err


@callback(
    Output("set-ef-accounts", "children"),
    Input("set-ef-accounts-store", "data"),
)
def _render_savings_rows(accounts):
    return _savings_rows(accounts)


@callback(
    Output("set-ef-accounts-store", "data"),
    Input("set-ef-acct-add", "n_clicks"),
    Input({"type": "set-ef-acct-remove", "index": ALL}, "n_clicks"),
    State({"type": "set-ef-acct", "index": ALL}, "value"),
    prevent_initial_call=True,
)
def _edit_savings_rows(_add, _removes, values):
    # Ignore the spurious fire when rows are rebuilt (new buttons start at 0/None).
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    accounts = [v for v in (values or [])]
    trig = ctx.triggered_id
    if trig == "set-ef-acct-add":
        names = account_names()
        nxt = next((a for a in names if a not in accounts),
                   (names[0] if names else "Savings"))
        return accounts + [nxt]
    if isinstance(trig, dict) and trig.get("type") == "set-ef-acct-remove":
        idx = trig.get("index")
        if isinstance(idx, int) and 0 <= idx < len(accounts) and len(accounts) > 1:
            accounts.pop(idx)
        return accounts
    raise PreventUpdate


@callback(
    Output("set-remove-confirm", "displayed"),
    Input("set-remove-btn", "n_clicks"),
    prevent_initial_call=True,
)
def _open_danger_dialog(n):
    # Deletion lives on its own /remove page; this button only warns and, on
    # confirmation, navigates there (see _go_remove).
    return bool(n)


@callback(
    Output("set-remove-nav", "href"),
    Input("set-remove-confirm", "submit_n_clicks"),
    prevent_initial_call=True,
)
def _go_remove(submit_n):
    if not submit_n:
        raise PreventUpdate
    return "/remove"
