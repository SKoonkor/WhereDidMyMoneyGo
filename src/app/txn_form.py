"""Shared add/edit transaction form (slides 10–19).

Lives outside ``pages/`` because Dash auto-imports every module in the pages
folder and the add + edit pages must share these callbacks (defining them
twice would raise duplicate-callback errors). Component ids are shared too —
safe, since only one of the two pages is ever mounted at a time.
"""

from __future__ import annotations

from datetime import date

from dash import ALL, ctx, dcc, html, callback, Input, Output, State, no_update
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header
from src.app.data import account_names, refresh
from src.analytics.accounts import add_account
from src.analytics.transaction_categories import (load_categories, add_category,
                                                  add_subcategory)
from src.io import store

_TYPES = ["Income", "Expense", "Transfer"]
_PLACEHOLDER = "Select category…"
_ACCT_PLACEHOLDER = "Select account…"
_NO_SUB = "(no subcategory)"

_LABEL_STYLE = {"color": theme.MUTED, "fontSize": "13px"}
_HIDDEN = {"display": "none"}


def _field(label, component, label_id: str | None = None):
    kwargs = {"id": label_id} if label_id else {}
    return html.Div([html.Label(label, style=_LABEL_STYLE, **kwargs), component])


def _cat_btn_text(category: str, subcategory: str) -> str:
    if not category:
        return _PLACEHOLDER
    return f"{category} › {subcategory}" if subcategory else category


def build_form(mode: str, initial: dict | None = None,
               origin_month: str | None = None) -> html.Div:
    init = initial or {}
    ui_type = init.get("ui_type", "Expense")
    category = init.get("category", "")
    subcategory = init.get("subcategory", "")
    period = init.get("period")
    title = "Edit Transaction" if mode == "edit" else "Add Transaction"
    # "‹ Transactions" returns to the month the user came from.
    back_href = f"/transactions?month={origin_month}" if origin_month else "/transactions"

    is_edit = mode == "edit"
    mode_data = {"mode": mode}
    if is_edit:
        mode_data["txn_id"] = init["id"]

    form_card = html.Div(
        [
            dcc.RadioItems(
                id="txn-type", options=_TYPES, value=ui_type,
                className="txn-tabs",
            ),
            _field("Date", dcc.DatePickerSingle(
                id="txn-date",
                date=(period.date() if period is not None else date.today()),
                display_format="DD/MM/YYYY",
                style={"marginBottom": "12px", "display": "block"},
            )),
            _field("Amount", dcc.Input(
                id="txn-amount", type="number", min=0,
                value=init.get("amount"), placeholder="0.00",
                style=theme.INPUT_STYLE,
            )),
            html.Div(
                _field("Category", html.Button(
                    _cat_btn_text(category, subcategory),
                    id="txn-cat-btn", n_clicks=0, className="txn-field-btn",
                )),
                id="txn-cat-field",
                style=_HIDDEN if ui_type == "Transfer" else {},
            ),
            _field("From" if ui_type == "Transfer" else "Account",
                   html.Button(init.get("account") or _ACCT_PLACEHOLDER,
                               id="txn-acct-from-btn", n_clicks=0,
                               className="txn-field-btn"),
                   label_id="txn-from-label"),
            html.Div(
                _field("To", html.Button(init.get("to_account") or _ACCT_PLACEHOLDER,
                                         id="txn-acct-to-btn", n_clicks=0,
                                         className="txn-field-btn")),
                id="txn-to-field",
                style={} if ui_type == "Transfer" else _HIDDEN,
            ),
            _field("Note", dcc.Input(
                id="txn-note", type="text", value=init.get("note", ""),
                placeholder="Shown on the summary page",
                style=theme.INPUT_STYLE,
            )),
            _field("Description", dcc.Input(
                id="txn-desc", type="text", value=init.get("description", ""),
                placeholder="Optional details", style=theme.INPUT_STYLE,
            )),
            html.Div(
                [
                    html.Button("Save", id="txn-save", n_clicks=0,
                                style={**theme.BUTTON_STYLE, "flex": "1"}),
                    html.Button("Continue", id="txn-continue", n_clicks=0,
                                style={**theme.PERIOD_BUTTON_STYLE,
                                       **(_HIDDEN if is_edit else {})}),
                    html.Button("Delete", id="txn-delete", n_clicks=0,
                                style={**theme.PERIOD_BUTTON_STYLE,
                                       "color": theme.EXPENSE_COLOR,
                                       "borderColor": theme.EXPENSE_COLOR,
                                       **({} if is_edit else _HIDDEN)}),
                ],
                style={"display": "flex", "gap": "10px", "marginTop": "8px"},
            ),
            html.Div(id="txn-form-msg", style={"marginTop": "12px", "fontSize": "14px"}),
        ],
        style={**theme.CARD_STYLE, "maxWidth": "520px"},
    )

    def _picker_modal(modal_id, title_txt, close_id, body_id,
                      input_id, input_placeholder, add_id):
        return html.Div(
            html.Div(
                [
                    html.Div(
                        [
                            html.H3(title_txt, style={"flex": "1"}),
                            html.Button("✕", id=close_id, n_clicks=0,
                                        className="theme-toggle"),
                        ],
                        style={"display": "flex", "alignItems": "center",
                               "gap": "10px"},
                    ),
                    html.Div(id=body_id, className="cat-grid"),
                    html.Div(
                        [
                            dcc.Input(id=input_id, type="text",
                                      placeholder=input_placeholder,
                                      style={**theme.INPUT_STYLE, "marginBottom": 0}),
                            html.Button("+ Add", id=add_id, n_clicks=0,
                                        style=theme.BUTTON_STYLE),
                        ],
                        style={"display": "flex", "gap": "10px", "marginTop": "14px"},
                    ),
                ],
                className="modal-card",
            ),
            id=modal_id, className="modal-overlay", style=_HIDDEN,
        )

    cat_modal = _picker_modal("txn-cat-modal", "Category", "txn-cat-close",
                              "txn-cat-modal-body", "txn-new-cat",
                              "New category name", "txn-cat-add-confirm")
    acct_modal = _picker_modal("txn-acct-modal", "Account", "txn-acct-close",
                               "txn-acct-modal-body", "txn-new-acct",
                               "New account name", "txn-acct-add-confirm")

    return html.Div(
        [
            dcc.Location(id="txn-redirect", refresh="callback-nav"),
            dcc.Store(id="txn-form-mode", data=mode_data),
            dcc.Store(id="txn-cats-store", data=load_categories()),
            dcc.Store(id="txn-category",
                      data={"category": category, "subcategory": subcategory}),
            dcc.Store(id="txn-cat-pane", data={"level": "top"}),
            dcc.Store(id="txn-accts-store", data=account_names()),
            dcc.Store(id="txn-account", data=init.get("account")),
            dcc.Store(id="txn-account-to", data=init.get("to_account")),
            dcc.Store(id="txn-acct-target", data="from"),
            dcc.ConfirmDialog(id="txn-del-confirm"),
            page_header(title, "Recorded straight into your transactions file.",
                        back=("Transactions", back_href)),
            html.Div(form_card, id="txn-accent",
                     className=f"accent-{ui_type.lower()}"),
            cat_modal,
            acct_modal,
        ],
        style=theme.PAGE_STYLE,
    )


# ── Type selector drives which fields are visible ─────────────────────────────

@callback(
    Output("txn-cat-field", "style"),
    Output("txn-to-field", "style"),
    Output("txn-from-label", "children"),
    Output("txn-accent", "className"),
    Input("txn-type", "value"),
)
def _type_ui(txn_type):
    if txn_type == "Transfer":
        return _HIDDEN, {}, "From", "accent-transfer"
    return {}, _HIDDEN, "Account", f"accent-{txn_type.lower()}"


# ── Category picker modal ─────────────────────────────────────────────────────

@callback(
    Output("txn-cat-modal", "style"),
    Output("txn-cat-pane", "data"),
    Input("txn-cat-btn", "n_clicks"),
    Input("txn-cat-close", "n_clicks"),
    prevent_initial_call=True,
)
def _open_close_modal(_open, _close):
    if ctx.triggered_id == "txn-cat-btn":
        return {}, {"level": "top"}
    return _HIDDEN, {"level": "top"}


@callback(
    Output("txn-cat-modal-body", "children"),
    Output("txn-new-cat", "placeholder"),
    Input("txn-cat-pane", "data"),
    Input("txn-cats-store", "data"),
    Input("txn-type", "value"),
)
def _render_pane(pane, cats, txn_type):
    kind = "income" if txn_type == "Income" else "expense"
    tree = (cats or {}).get(kind, {})
    pane = pane or {"level": "top"}

    if pane.get("level") == "sub":
        cat = pane.get("category", "")
        subs = tree.get(cat, [])
        tiles = [html.Button("‹ Back", id={"role": "cat-back", "name": "back"},
                             n_clicks=0, className="cat-tile parent")]
        tiles += [html.Button(_NO_SUB, n_clicks=0, className="cat-tile",
                              id={"role": "sub-tile", "name": _NO_SUB})]
        tiles += [html.Button(s, n_clicks=0, className="cat-tile",
                              id={"role": "sub-tile", "name": s}) for s in subs]
        return tiles, f"New subcategory in {cat}"

    tiles = []
    for name, subs in tree.items():
        label = f"{name} ▾" if subs else name
        cls = "cat-tile parent" if subs else "cat-tile"
        tiles.append(html.Button(label, n_clicks=0, className=cls,
                                 id={"role": "cat-tile", "name": name}))
    return tiles, "New category name"


@callback(
    Output("txn-cat-pane", "data", allow_duplicate=True),
    Output("txn-category", "data"),
    Output("txn-cat-btn", "children"),
    Output("txn-cat-modal", "style", allow_duplicate=True),
    Input({"role": "cat-tile", "name": ALL}, "n_clicks"),
    Input({"role": "sub-tile", "name": ALL}, "n_clicks"),
    Input({"role": "cat-back", "name": ALL}, "n_clicks"),
    State("txn-type", "value"),
    State("txn-cat-pane", "data"),
    State("txn-cats-store", "data"),
    prevent_initial_call=True,
)
def _tile_click(cat_clicks, sub_clicks, back_clicks, txn_type, pane, cats):
    trigger = ctx.triggered_id
    # Pattern inputs also fire when the tiles (re)render — ignore those.
    if not ctx.triggered[0]["value"]:
        raise PreventUpdate

    if trigger.get("role") == "cat-back":
        return {"level": "top"}, no_update, no_update, no_update

    if trigger.get("role") == "cat-tile":
        name = trigger["name"]
        kind = "income" if txn_type == "Income" else "expense"
        subs = (cats or {}).get(kind, {}).get(name, [])
        if subs:
            return {"level": "sub", "category": name}, no_update, no_update, no_update
        sel = {"category": name, "subcategory": ""}
        return {"level": "top"}, sel, _cat_btn_text(name, ""), _HIDDEN

    # Subcategory tile (or "(no subcategory)").
    sub = trigger["name"]
    sub = "" if sub == _NO_SUB else sub
    cat = (pane or {}).get("category", "")
    sel = {"category": cat, "subcategory": sub}
    return {"level": "top"}, sel, _cat_btn_text(cat, sub), _HIDDEN


@callback(
    Output("txn-cats-store", "data"),
    Output("txn-new-cat", "value"),
    Input("txn-cat-add-confirm", "n_clicks"),
    State("txn-new-cat", "value"),
    State("txn-cat-pane", "data"),
    State("txn-type", "value"),
    prevent_initial_call=True,
)
def _add_cat(_n, name, pane, txn_type):
    if not name or not name.strip():
        raise PreventUpdate
    kind = "income" if txn_type == "Income" else "expense"
    if (pane or {}).get("level") == "sub":
        cats = add_subcategory(kind, pane.get("category", ""), name)
    else:
        cats = add_category(kind, name)
    return cats, ""


# ── Account picker modal (same pattern as the category picker) ───────────────

@callback(
    Output("txn-acct-modal", "style"),
    Output("txn-acct-target", "data"),
    Input("txn-acct-from-btn", "n_clicks"),
    Input("txn-acct-to-btn", "n_clicks"),
    Input("txn-acct-close", "n_clicks"),
    prevent_initial_call=True,
)
def _open_close_acct_modal(_f, _t, _c):
    if not ctx.triggered[0]["value"]:
        raise PreventUpdate
    trigger = ctx.triggered_id
    if trigger == "txn-acct-from-btn":
        return {}, "from"
    if trigger == "txn-acct-to-btn":
        return {}, "to"
    return _HIDDEN, no_update


@callback(Output("txn-acct-modal-body", "children"),
          Input("txn-accts-store", "data"))
def _render_acct_grid(accounts):
    return [html.Button(a, n_clicks=0, className="cat-tile",
                        id={"role": "acct-tile", "name": a})
            for a in (accounts or [])]


@callback(
    Output("txn-account", "data"),
    Output("txn-account-to", "data"),
    Output("txn-acct-from-btn", "children"),
    Output("txn-acct-to-btn", "children"),
    Output("txn-acct-modal", "style", allow_duplicate=True),
    Input({"role": "acct-tile", "name": ALL}, "n_clicks"),
    State("txn-acct-target", "data"),
    prevent_initial_call=True,
)
def _acct_tile_click(_clicks, target):
    # Pattern inputs also fire when the tiles (re)render — ignore those.
    if not ctx.triggered[0]["value"]:
        raise PreventUpdate
    name = ctx.triggered_id["name"]
    if target == "to":
        return no_update, name, no_update, name, _HIDDEN
    return name, no_update, name, no_update, _HIDDEN


@callback(
    Output("txn-accts-store", "data"),
    Output("txn-new-acct", "value"),
    Input("txn-acct-add-confirm", "n_clicks"),
    State("txn-new-acct", "value"),
    prevent_initial_call=True,
)
def _add_acct(_n, name):
    if not name or not name.strip():
        raise PreventUpdate
    return add_account(name), ""


# ── Delete guard ──────────────────────────────────────────────────────────────

@callback(
    Output("txn-del-confirm", "displayed"),
    Output("txn-del-confirm", "message"),
    Input("txn-delete", "n_clicks"),
    prevent_initial_call=True,
)
def _confirm_delete(n):
    if not n:
        raise PreventUpdate
    return True, ("Delete this transaction? Transfers remove both linked rows. "
                  "This cannot be undone (a backup is kept in data/backups).")


# ── Save / Continue / Delete ──────────────────────────────────────────────────

def _validate(txn_type, txn_date, amount, cat, account, to_account):
    if not txn_date:
        return "Pick a date."
    if amount is None or float(amount) <= 0:
        return "Enter an amount greater than zero."
    if txn_type == "Transfer":
        if not account or not to_account:
            return "Select both From and To accounts."
        if account == to_account:
            return "From and To must be different accounts."
    else:
        if not account:
            return "Select an account."
        if not (cat or {}).get("category"):
            return "Select a category."
    return None


@callback(
    Output("txn-redirect", "href"),
    Output("txn-form-msg", "children"),
    Output("txn-form-msg", "style"),
    Output("txn-amount", "value"),
    Output("txn-note", "value"),
    Output("txn-desc", "value"),
    Output("txn-category", "data", allow_duplicate=True),
    Output("txn-cat-btn", "children", allow_duplicate=True),
    Input("txn-save", "n_clicks"),
    Input("txn-continue", "n_clicks"),
    Input("txn-del-confirm", "submit_n_clicks"),
    State("txn-form-mode", "data"),
    State("txn-type", "value"),
    State("txn-date", "date"),
    State("txn-amount", "value"),
    State("txn-category", "data"),
    State("txn-account", "data"),
    State("txn-account-to", "data"),
    State("txn-note", "value"),
    State("txn-desc", "value"),
    prevent_initial_call=True,
)
def _submit(_s, _c, _d, mode, txn_type, txn_date, amount, cat,
            account, to_account, note, desc):
    trigger = ctx.triggered_id
    if not ctx.triggered[0]["value"]:
        raise PreventUpdate
    keep = (no_update,) * 5  # amount, note, desc, category, cat-btn
    err_style = {"marginTop": "12px", "fontSize": "14px", "color": theme.EXPENSE_COLOR}
    ok_style = {"marginTop": "12px", "fontSize": "14px", "color": theme.ACCENT}

    # Return to the month of the transaction so the user sees the result.
    back_to = "/transactions"
    if txn_date:
        back_to = f"/transactions?month={str(txn_date)[:7]}"

    if trigger == "txn-del-confirm":
        store.delete_transaction(mode["txn_id"])
        refresh()
        return back_to, no_update, no_update, *keep

    error = _validate(txn_type, txn_date, amount, cat, account, to_account)
    if error:
        return no_update, error, err_style, *keep

    fields = dict(
        period=txn_date, txn_type=txn_type, amount=float(amount),
        account=account, category=(cat or {}).get("category", ""),
        subcategory=(cat or {}).get("subcategory", ""),
        note=note or "", description=desc or "",
        to_account=to_account if txn_type == "Transfer" else None,
    )
    if mode["mode"] == "edit":
        store.update_transaction(mode["txn_id"], **fields)
    else:
        store.add_transaction(**fields)
    refresh()

    if trigger == "txn-continue":
        return (no_update, "Saved — add another.", ok_style,
                None, "", "", {"category": "", "subcategory": ""}, _PLACEHOLDER)
    return back_to, no_update, no_update, *keep
