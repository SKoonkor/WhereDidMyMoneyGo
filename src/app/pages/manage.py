"""Manage accounts & categories — rename / delete / organise.

Reached from Settings → Account tools. Lets the user tidy up the account and
category lists that imports tend to fill with names they never chose:

- **Accounts:** rename (rewrites the ledger, including transfer counterparties)
  or delete (only when unused).
- **Categories:** a drag-and-drop board (Income vs Spending) to reorder and
  reclassify top-level categories, with a detail panel to rename/delete the
  category and manage its subcategories.

Rename always rewrites matching past transactions so history stays consistent;
delete is blocked while an item is still used by any transaction.
"""

from __future__ import annotations

import dash
from dash import dcc, html, callback, ctx, ALL, Input, Output, State, no_update
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card
from src.app.data import (account_names, refresh, refresh_config,
                          emergency_fund_config)
from src.io import store
from src.analytics import accounts as A
from src.analytics import transaction_categories as TC
from src.analytics import budget as B
from src.utils.config import save_settings

dash.register_page(__name__, path="/manage", name="Manage accounts & categories",
                   order=10)

_HIDDEN = {"display": "none"}
_OK = {"fontSize": "14px", "marginTop": "10px", "color": theme.ACCENT}
_ERR = {"fontSize": "14px", "marginTop": "10px", "color": theme.EXPENSE_COLOR}
_SMALL_BTN = {**theme.PERIOD_BUTTON_STYLE, "padding": "4px 10px", "fontSize": "13px"}
_DEL_BTN = {**_SMALL_BTN, "color": theme.EXPENSE_COLOR,
            "borderColor": theme.EXPENSE_COLOR}


# ── orchestration (ledger + config + downstream, then cache refresh) ──────────

def _rename_account_everywhere(old: str, new: str) -> None:
    store.rename_account(old, new)          # ledger (account + transfer legs)
    A.rename_account(old, new)              # accounts.json
    ef = emergency_fund_config()            # keep the EF savings pool valid
    if old in ef["savings_accounts"]:
        pool = list(dict.fromkeys(new if a == old else a
                                  for a in ef["savings_accounts"]))
        save_settings({"emergency_fund": {"savings_accounts": pool}})
        refresh_config()
    refresh()


def _rename_category_everywhere(kind: str, old: str, new: str) -> None:
    store.rename_category(kind, old, new)   # ledger
    TC.rename_category(kind, old, new)      # categories.json
    if kind == "expense":                   # mirror into the budget buckets
        cfg = B.load_budget()
        asg = cfg.get("assignments", {})
        if old in asg:
            asg[new] = asg.pop(old)
            B.save_budget(cfg)
    refresh()


def _delete_category_everywhere(kind: str, name: str) -> None:
    TC.delete_category(kind, name)          # config only (guarded: unused)
    if kind == "expense":
        cfg = B.load_budget()
        asg = cfg.get("assignments", {})
        if name in asg:
            asg.pop(name)
            B.save_budget(cfg)


def _rename_subcategory_everywhere(kind: str, category: str, old: str, new: str) -> None:
    store.rename_subcategory(kind, category, old, new)
    TC.rename_subcategory(kind, category, old, new)
    refresh()


# ── renderers ────────────────────────────────────────────────────────────────

def _account_cards() -> list:
    usage = store.account_usage()
    cards = []
    for i, name in enumerate(account_names()):
        n = usage.get(name, 0)
        cards.append(html.Div(
            [
                html.Div(name, className="manage-card-name"),
                html.Div(f"{n} use{'s' if n != 1 else ''}", className="manage-count"),
                html.Div(
                    [
                        html.Button("Rename", id={"type": "acct-rename", "index": i},
                                    n_clicks=0, style=_SMALL_BTN),
                        html.Button("Delete", id={"type": "acct-del", "index": i},
                                    n_clicks=0, style=_DEL_BTN),
                    ],
                    className="manage-card-btns",
                ),
            ],
            className="manage-card",
        ))
    return cards


def _expense_board() -> list:
    """One column per expense category; each chip is a draggable subcategory.

    Dragging a chip to another column reassigns that subcategory's parent
    category (see manage_cat_dnd.js → _apply_submove). Tapping a column header
    selects the category for the detail panel below.
    """
    expense = TC.load_categories().get("expense", {})
    cols = []
    for cat, subs in expense.items():
        chips = [html.Div(s, className="manage-chip", **{"data-sub": s})
                 for s in subs]
        cols.append(html.Div(
            [
                html.Div(cat, className="manage-col-head"),
                html.Div(chips, className="manage-chip-list"),
            ],
            className="manage-col",
            **{"data-cat": cat, "data-select": f"expense|{cat}"},
        ))
    return cols


def _income_cards() -> list:
    """Income categories have no subcategories; show them as tappable cards
    (bold name only → tap opens the detail panel for rename/delete)."""
    income = TC.load_categories().get("income", {})
    return [html.Div(html.Div(c, className="manage-card-name"),
                     className="manage-card", **{"data-select": f"income|{c}"})
            for c in income]


def _subcat_detail(selected: str | None) -> list:
    """Detail panel for the tapped category: rename/delete + subcategories."""
    if not selected or "|" not in selected:
        return [html.P("Tap a category to rename it, delete it, or edit its "
                       "subcategories.", style={"color": theme.MUTED})]
    kind, category = selected.split("|", 1)
    cats = TC.load_categories().get(kind, {})
    if category not in cats:
        return [html.P("Tap a category to manage it.", style={"color": theme.MUTED})]
    subs = cats[category]
    usage = store.category_usage(kind).get(category, 0)
    kind_label = "Income" if kind == "income" else "Spending"

    header = html.Div(
        [
            html.H3(category, style={"margin": 0, "color": theme.INK}),
            html.Span(f"{kind_label} · {usage} use{'s' if usage != 1 else ''}",
                      style={"color": theme.MUTED, "fontSize": "13px"}),
        ],
        style={"display": "flex", "gap": "12px", "alignItems": "baseline"},
    )
    rename_row = html.Div(
        [
            dcc.Input(id="manage-catname", type="text", value=category,
                      style={**theme.INPUT_STYLE, "marginBottom": 0,
                             "maxWidth": "220px"}),
            html.Button("Rename category", id="manage-cat-rename-btn", n_clicks=0,
                        style=_SMALL_BTN),
            html.Button("Delete category", id="manage-cat-del-btn", n_clicks=0,
                        style=_DEL_BTN),
        ],
        style={"display": "flex", "gap": "8px", "alignItems": "center",
               "margin": "10px 0"},
    )

    # Income categories have no subcategories — just the rename/delete controls.
    if kind == "income":
        return [header, rename_row]

    sub_rows = []
    for i, s in enumerate(subs):
        sn = store.subcategory_usage(kind, category).get(s, 0)
        sub_rows.append(html.Div(
            [
                dcc.Input(id={"type": "subcat-input", "index": i}, type="text",
                          value=s, style={**theme.INPUT_STYLE, "marginBottom": 0,
                                          "maxWidth": "200px"}),
                html.Span(f"{sn} use{'s' if sn != 1 else ''}",
                          className="manage-count"),
                html.Button("Rename", id={"type": "subcat-rename", "index": i},
                            n_clicks=0, style=_SMALL_BTN),
                html.Button("Delete", id={"type": "subcat-del", "index": i},
                            n_clicks=0, style=_DEL_BTN),
            ],
            className="manage-row",
        ))
    add_row = html.Div(
        [
            dcc.Input(id="manage-subcat-new", type="text",
                      placeholder="New subcategory",
                      style={**theme.INPUT_STYLE, "marginBottom": 0,
                             "maxWidth": "200px"}),
            html.Button("+ Add subcategory", id="manage-subcat-add", n_clicks=0,
                        style=_SMALL_BTN),
        ],
        style={"display": "flex", "gap": "8px", "alignItems": "center",
               "marginTop": "8px"},
    )
    return [
        header, rename_row,
        html.Div("Subcategories", style={"color": theme.MUTED, "fontSize": "13px",
                                         "marginTop": "6px"}),
        html.Div(sub_rows or [html.P("None yet.", style={"color": theme.MUTED,
                                                         "fontSize": "13px"})]),
        add_row,
    ]


# ── layout ───────────────────────────────────────────────────────────────────

def layout(**_):
    accounts_card = card(
        [
            html.H2("Accounts", style={"marginTop": 0, "color": theme.INK}),
            html.P("Rename an account (updates every transaction, including "
                   "transfers) or delete one you no longer use.",
                   style={"color": theme.MUTED, "fontSize": "13px",
                          "marginTop": "4px"}),
            html.Div(_account_cards(), id="manage-accounts", className="manage-cardlist"),
            html.Div(id="manage-acct-msg"),
        ],
    )

    categories_card = card(
        [
            html.H2("Categories", style={"marginTop": 0, "color": theme.INK}),
            html.Div("Income", style={"color": theme.MUTED, "fontSize": "13px",
                                      "marginTop": "4px"}),
            html.Div(_income_cards(), id="manage-income-cats",
                     className="manage-cardlist"),
            html.Div("Spending — drag a subcategory to another category to move it",
                     style={"color": theme.MUTED, "fontSize": "13px",
                            "marginTop": "14px"}),
            html.Div(_expense_board(), id="manage-cat-cols", className="manage-board"),
            html.Hr(style={"border": "none", "borderTop": "1px solid var(--border)",
                           "margin": "16px 0"}),
            html.Div(_subcat_detail(None), id="manage-cat-detail"),
            html.Div(id="manage-cat-msg"),
        ],
        style={"marginTop": "16px"},
    )

    # Rename-account modal (shared; target held in a store).
    rename_modal = html.Div(
        html.Div(
            [
                html.H3("Rename account", style={"color": theme.INK}),
                dcc.Input(id="manage-acct-name", type="text",
                          style={**theme.INPUT_STYLE, "width": "100%"}),
                html.Div(
                    [
                        html.Button("Cancel", id="manage-acct-cancel", n_clicks=0,
                                    style=theme.PERIOD_BUTTON_STYLE),
                        html.Button("Save", id="manage-acct-save", n_clicks=0,
                                    style=theme.BUTTON_STYLE),
                    ],
                    style={"display": "flex", "gap": "10px", "justifyContent":
                           "flex-end", "marginTop": "14px"},
                ),
            ],
            className="modal-card",
        ),
        id="manage-acct-modal", className="modal-overlay", style=_HIDDEN,
    )

    return html.Div(
        [
            page_header("Manage accounts & categories",
                        "Tidy up the account and category lists.",
                        back=("Settings", "/settings")),
            dcc.Store(id="manage-refresh", data=0),
            dcc.Store(id="manage-submove"),
            dcc.Store(id="manage-cat-selected"),
            dcc.Store(id="manage-acct-target"),
            accounts_card,
            categories_card,
            rename_modal,
            dcc.ConfirmDialog(id="manage-acct-del-confirm"),
            dcc.ConfirmDialog(id="manage-cat-del-confirm"),
        ],
        style=theme.PAGE_STYLE,
    )


# ── accounts: rename ─────────────────────────────────────────────────────────

@callback(
    Output("manage-acct-modal", "style"),
    Output("manage-acct-name", "value"),
    Output("manage-acct-target", "data"),
    Input({"type": "acct-rename", "index": ALL}, "n_clicks"),
    prevent_initial_call=True,
)
def _open_rename_modal(_clicks):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    idx = ctx.triggered_id["index"]
    names = account_names()
    if idx >= len(names):
        raise PreventUpdate
    name = names[idx]
    return {}, name, name


@callback(
    Output("manage-acct-modal", "style", allow_duplicate=True),
    Input("manage-acct-cancel", "n_clicks"),
    prevent_initial_call=True,
)
def _close_rename_modal(_n):
    return _HIDDEN


@callback(
    Output("manage-accounts", "children"),
    Output("manage-acct-msg", "children"),
    Output("manage-acct-msg", "style"),
    Output("manage-acct-modal", "style", allow_duplicate=True),
    Input("manage-acct-save", "n_clicks"),
    State("manage-acct-name", "value"),
    State("manage-acct-target", "data"),
    prevent_initial_call=True,
)
def _do_rename_account(_n, new, old):
    new = (new or "").strip()
    if not old or not new:
        raise PreventUpdate
    if new == old:
        return no_update, "", _OK, _HIDDEN
    if new in account_names():
        return (no_update, f"An account named '{new}' already exists.", _ERR,
                no_update)
    _rename_account_everywhere(old, new)
    return _account_cards(), f"Renamed '{old}' → '{new}'.", _OK, _HIDDEN


# ── accounts: delete ─────────────────────────────────────────────────────────

@callback(
    Output("manage-acct-del-confirm", "displayed"),
    Output("manage-acct-del-confirm", "message"),
    Output("manage-acct-target", "data", allow_duplicate=True),
    Output("manage-acct-msg", "children", allow_duplicate=True),
    Output("manage-acct-msg", "style", allow_duplicate=True),
    Input({"type": "acct-del", "index": ALL}, "n_clicks"),
    prevent_initial_call=True,
)
def _ask_delete_account(_clicks):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    idx = ctx.triggered_id["index"]
    names = account_names()
    if idx >= len(names):
        raise PreventUpdate
    name = names[idx]
    used = store.account_usage().get(name, 0)
    if used:
        return (False, "", no_update,
                f"'{name}' is used by {used} transaction(s) — rename it or "
                f"reassign those first.", _ERR)
    return True, f"Delete the account '{name}'? It has no transactions.", name, "", _OK


@callback(
    Output("manage-accounts", "children", allow_duplicate=True),
    Output("manage-acct-msg", "children", allow_duplicate=True),
    Output("manage-acct-msg", "style", allow_duplicate=True),
    Input("manage-acct-del-confirm", "submit_n_clicks"),
    State("manage-acct-target", "data"),
    prevent_initial_call=True,
)
def _do_delete_account(_submit, name):
    if not name:
        raise PreventUpdate
    if store.account_usage().get(name, 0):          # re-check at commit time
        return no_update, f"'{name}' is now in use — not deleted.", _ERR
    A.delete_account(name)
    return _account_cards(), f"Deleted account '{name}'.", _OK


# ── categories: board (persist + render) ─────────────────────────────────────

@callback(
    Output("manage-cat-cols", "children"),
    Output("manage-income-cats", "children"),
    Input("manage-refresh", "data"),
)
def _render_categories(_r):
    return _expense_board(), _income_cards()


@callback(
    Output("manage-cat-detail", "children"),
    Input("manage-cat-selected", "data"),
    Input("manage-refresh", "data"),
)
def _render_detail(selected, _r):
    return _subcat_detail(selected)


@callback(
    Output("manage-refresh", "data"),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input("manage-submove", "data"),
    State("manage-refresh", "data"),
    prevent_initial_call=True,
)
def _apply_submove(move, refresh_n):
    """Move a subcategory to another expense category (drag-and-drop drop)."""
    if not move:
        raise PreventUpdate
    sub, frm, to = move.get("sub"), move.get("from"), move.get("to")
    exp = TC.load_categories().get("expense", {})
    if not (sub and frm and to) or frm == to or frm not in exp or to not in exp:
        raise PreventUpdate
    store.move_subcategory(frm, to, sub)   # ledger
    TC.move_subcategory(frm, to, sub)      # config
    refresh()
    return (refresh_n or 0) + 1, f"Moved '{sub}' → {to}.", _OK


# ── categories: rename / delete ──────────────────────────────────────────────

@callback(
    Output("manage-refresh", "data", allow_duplicate=True),
    Output("manage-cat-selected", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children"),
    Output("manage-cat-msg", "style"),
    Input("manage-cat-rename-btn", "n_clicks"),
    State("manage-catname", "value"),
    State("manage-cat-selected", "data"),
    State("manage-refresh", "data"),
    prevent_initial_call=True,
)
def _do_rename_category(_n, new, selected, refresh_n):
    if not selected or "|" not in selected:
        raise PreventUpdate
    kind, old = selected.split("|", 1)
    new = (new or "").strip()
    if not new or new == old:
        raise PreventUpdate
    if new in TC.load_categories().get(kind, {}):
        return no_update, no_update, f"A category named '{new}' already exists.", _ERR
    _rename_category_everywhere(kind, old, new)
    return (refresh_n or 0) + 1, f"{kind}|{new}", f"Renamed '{old}' → '{new}'.", _OK


@callback(
    Output("manage-cat-del-confirm", "displayed"),
    Output("manage-cat-del-confirm", "message"),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input("manage-cat-del-btn", "n_clicks"),
    State("manage-cat-selected", "data"),
    prevent_initial_call=True,
)
def _ask_delete_category(_n, selected):
    if not selected or "|" not in selected:
        raise PreventUpdate
    kind, name = selected.split("|", 1)
    used = store.category_usage(kind).get(name, 0)
    if used:
        return (False, "",
                f"'{name}' is used by {used} transaction(s) — rename or reassign "
                f"those first.", _ERR)
    return True, f"Delete the category '{name}' and its subcategories?", "", _OK


@callback(
    Output("manage-refresh", "data", allow_duplicate=True),
    Output("manage-cat-selected", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input("manage-cat-del-confirm", "submit_n_clicks"),
    State("manage-cat-selected", "data"),
    State("manage-refresh", "data"),
    prevent_initial_call=True,
)
def _do_delete_category(_submit, selected, refresh_n):
    if not selected or "|" not in selected:
        raise PreventUpdate
    kind, name = selected.split("|", 1)
    if store.category_usage(kind).get(name, 0):
        return no_update, no_update, f"'{name}' is now in use — not deleted.", _ERR
    _delete_category_everywhere(kind, name)
    return (refresh_n or 0) + 1, None, f"Deleted category '{name}'.", _OK


# ── subcategories: add / rename / delete ─────────────────────────────────────

@callback(
    Output("manage-refresh", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input("manage-subcat-add", "n_clicks"),
    State("manage-subcat-new", "value"),
    State("manage-cat-selected", "data"),
    State("manage-refresh", "data"),
    prevent_initial_call=True,
)
def _add_subcategory(_n, name, selected, refresh_n):
    name = (name or "").strip()
    if not name or not selected or "|" not in selected:
        raise PreventUpdate
    kind, category = selected.split("|", 1)
    if name in TC.load_categories().get(kind, {}).get(category, []):
        return no_update, f"'{name}' already exists.", _ERR
    TC.add_subcategory(kind, category, name)
    refresh()
    return (refresh_n or 0) + 1, f"Added subcategory '{name}'.", _OK


@callback(
    Output("manage-refresh", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input({"type": "subcat-rename", "index": ALL}, "n_clicks"),
    State({"type": "subcat-input", "index": ALL}, "value"),
    State("manage-cat-selected", "data"),
    State("manage-refresh", "data"),
    prevent_initial_call=True,
)
def _rename_subcategory(_clicks, values, selected, refresh_n):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    if not selected or "|" not in selected:
        raise PreventUpdate
    kind, category = selected.split("|", 1)
    idx = ctx.triggered_id["index"]
    subs = TC.load_categories().get(kind, {}).get(category, [])
    if idx >= len(subs) or idx >= len(values):
        raise PreventUpdate
    old = subs[idx]
    new = (values[idx] or "").strip()
    if not new or new == old:
        raise PreventUpdate
    if new in subs:
        return no_update, f"'{new}' already exists.", _ERR
    _rename_subcategory_everywhere(kind, category, old, new)
    return (refresh_n or 0) + 1, f"Renamed '{old}' → '{new}'.", _OK


@callback(
    Output("manage-refresh", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input({"type": "subcat-del", "index": ALL}, "n_clicks"),
    State("manage-cat-selected", "data"),
    State("manage-refresh", "data"),
    prevent_initial_call=True,
)
def _delete_subcategory(_clicks, selected, refresh_n):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    if not selected or "|" not in selected:
        raise PreventUpdate
    kind, category = selected.split("|", 1)
    idx = ctx.triggered_id["index"]
    subs = TC.load_categories().get(kind, {}).get(category, [])
    if idx >= len(subs):
        raise PreventUpdate
    sub = subs[idx]
    used = store.subcategory_usage(kind, category).get(sub, 0)
    if used:
        return no_update, (f"'{sub}' is used by {used} transaction(s) — rename or "
                           f"reassign those first."), _ERR
    TC.delete_subcategory(kind, category, sub)
    refresh()
    return (refresh_n or 0) + 1, f"Deleted subcategory '{sub}'.", _OK
