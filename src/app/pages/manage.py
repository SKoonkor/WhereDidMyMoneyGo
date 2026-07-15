"""Manage accounts & categories — staged rename / delete / organise.

Reached from Settings → Account tools. Every edit (rename, delete, move a
subcategory, add a subcategory) is **staged** in an in-memory draft and shown
live, but nothing is written to config/ledger until the user clicks **Save
settings** and confirms the change summary. Deletes are undo-able (a deleted item
stays visible, greyed with a ✕, until Save).

Rename rewrites matching past transactions on apply; delete is only allowed for
items no transaction uses.
"""

from __future__ import annotations

import copy

import dash
from dash import (dcc, html, callback, clientside_callback, ctx, ALL,
                  Input, Output, State, no_update)
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card
from src.app.i18n import get_lang, make_t
from src.app.data import (account_names, refresh, refresh_config,
                          emergency_fund_config)
from src.io import store
from src.analytics import accounts as A
from src.analytics import transaction_categories as TC
from src.analytics import budget as B
from src.utils.config import save_settings

t = make_t("manage")

dash.register_page(__name__, path="/manage", name="Manage accounts & categories",
                   order=10)

_HIDDEN = {"display": "none"}
_OK = {"fontSize": "14px", "marginTop": "10px", "color": theme.ACCENT}
_ERR = {"fontSize": "14px", "marginTop": "10px", "color": theme.EXPENSE_COLOR}
_SMALL_BTN = {**theme.PERIOD_BUTTON_STYLE, "padding": "4px 10px", "fontSize": "13px"}
_DEL_BTN = {**_SMALL_BTN, "color": theme.EXPENSE_COLOR,
            "borderColor": theme.EXPENSE_COLOR}
_UNDO_BTN = {**_SMALL_BTN, "color": theme.MUTED}
_LABEL = {"fontSize": "16px", "fontWeight": 600, "color": theme.INK}


# ── staged-draft model ───────────────────────────────────────────────────────

def _initial_draft() -> dict:
    """Build the editable draft from the current on-disk config. Rebuilt on every
    page load, so leaving the page (without Save) discards pending edits."""
    cats = TC.load_categories()
    return {
        "accounts": [{"id": n, "name": n, "deleted": False}
                     for n in account_names()],
        "income": [{"id": c, "name": c, "deleted": False}
                   for c in cats.get("income", {})],
        "expense": [{"id": cat, "name": cat, "deleted": False,
                     "subs": [{"ocat": cat, "osub": s, "name": s,
                               "deleted": False, "new": False} for s in subs]}
                    for cat, subs in cats.get("expense", {}).items()],
    }


def _uses(n: int) -> str:
    """'N uses' — English keeps proper singular/plural; Thai has no plural."""
    if get_lang() == "th":
        return t("{n} uses").format(n=n)
    return f"{n} use{'s' if n != 1 else ''}"


def _find(entries: list, _id: str):
    for i, e in enumerate(entries):
        if e["id"] == _id:
            return i, e
    return None, None


def _is_dirty(draft: dict) -> bool:
    if not draft:
        return False
    for a in draft["accounts"]:
        if a["deleted"] or a["name"] != a["id"]:
            return True
    for c in draft["income"]:
        if c["deleted"] or c["name"] != c["id"]:
            return True
    for e in draft["expense"]:
        if e["deleted"] or e["name"] != e["id"]:
            return True
        for s in e["subs"]:
            if (s["deleted"] or s.get("new") or s["name"] != s.get("osub")
                    or s.get("ocat") != e["id"]):
                return True
    return False


def _summarize(draft: dict) -> tuple[list, list]:
    """Human-readable change lists, grouped (account changes, category changes).
    Only items currently staged (deletes not undone) are included."""
    acct, cat = [], []
    for a in draft["accounts"]:
        if a["deleted"]:
            acct.append(t('"{name}" deleted').format(name=a["id"]))
        elif a["name"] != a["id"]:
            acct.append(t('"{old}" renamed to → "{new}"').format(
                old=a["id"], new=a["name"]))
    for c in draft["income"]:
        if c["deleted"]:
            cat.append(t('income category "{name}" deleted').format(name=c["id"]))
        elif c["name"] != c["id"]:
            cat.append(t('income category "{old}" renamed to → "{new}"').format(
                old=c["id"], new=c["name"]))
    for e in draft["expense"]:
        if e["deleted"]:
            cat.append(t('category "{name}" deleted').format(name=e["id"]))
            continue
        if e["name"] != e["id"]:
            cat.append(t('category "{old}" renamed to → "{new}"').format(
                old=e["id"], new=e["name"]))
        for s in e["subs"]:
            if s.get("new"):
                if not s["deleted"]:
                    cat.append(t('sub "{sub}" added to "{cat}"').format(
                        sub=s["name"], cat=e["name"]))
                continue
            if s["deleted"]:
                cat.append(t('sub "{sub}" deleted from "{cat}"').format(
                    sub=s["osub"], cat=s["ocat"]))
                continue
            if s["ocat"] != e["id"]:
                cat.append(t('sub "{sub}" moved from "{old}" → "{new}"').format(
                    sub=s["name"], old=s["ocat"], new=e["name"]))
            if s["osub"] != s["name"]:
                cat.append(t('sub "{old}" renamed to → "{new}"').format(
                    old=s["osub"], new=s["name"]))
    return acct, cat


# ── apply the draft to config + ledger ───────────────────────────────────────

def _apply_draft(draft: dict) -> None:
    # 1) Config (write final structures directly).
    A.save_accounts([a["name"] for a in draft["accounts"] if not a["deleted"]])
    income = {c["name"]: [] for c in draft["income"] if not c["deleted"]}
    expense = {e["name"]: [s["name"] for s in e["subs"] if not s["deleted"]]
               for e in draft["expense"] if not e["deleted"]}
    TC.save_categories({"income": income, "expense": expense})

    # Budget assignments follow expense-category renames/deletes.
    cfg = B.load_budget()
    asg = cfg.get("assignments", {})
    changed = False
    for e in draft["expense"]:
        if e["deleted"] and e["id"] in asg:
            asg.pop(e["id"]); changed = True
        elif not e["deleted"] and e["name"] != e["id"] and e["id"] in asg:
            asg[e["name"]] = asg.pop(e["id"]); changed = True
    if changed:
        B.save_budget(cfg)

    # Emergency-fund pool follows account renames/deletes.
    amap = {a["id"]: (None if a["deleted"] else a["name"]) for a in draft["accounts"]}
    pool = emergency_fund_config()["savings_accounts"]
    newpool = []
    for p in pool:
        if p in amap:
            if amap[p] is not None:
                newpool.append(amap[p])
        else:
            newpool.append(p)
    newpool = list(dict.fromkeys(newpool))
    if newpool != pool:
        save_settings({"emergency_fund": {"savings_accounts": newpool or ["Savings"]}})
        refresh_config()

    # 2) Ledger (one backup, then batched updates keyed on ORIGINAL names).
    store.backup_now()
    for e in draft["expense"]:                       # (1) subcategory moves
        if e["deleted"]:
            continue
        for s in e["subs"]:
            if s["deleted"] or s.get("new"):
                continue
            if s["ocat"] != e["id"]:
                store.move_subcategory(s["ocat"], e["id"], s["osub"], backup=False)
    for e in draft["expense"]:                       # (2) subcategory renames
        if e["deleted"]:
            continue
        for s in e["subs"]:
            if s["deleted"] or s.get("new"):
                continue
            if s["osub"] != s["name"]:
                store.rename_subcategory("expense", e["id"], s["osub"], s["name"],
                                         backup=False)
    for kind in ("income", "expense"):               # (3) category renames
        for e in draft[kind]:
            if not e["deleted"] and e["name"] != e["id"]:
                store.rename_category(kind, e["id"], e["name"], backup=False)
    for a in draft["accounts"]:                      # (4) account renames
        if not a["deleted"] and a["name"] != a["id"]:
            store.rename_account(a["id"], a["name"], backup=False)
    refresh()


# ── renderers (read the draft) ───────────────────────────────────────────────

def _x() -> html.Span:
    return html.Span("✕", className="manage-x")


def _account_cards(draft: dict) -> list:
    usage = store.account_usage()
    cards = []
    for i, e in enumerate(draft["accounts"]):
        used = usage.get(e["id"], 0)
        name = html.Div(e["name"], className="manage-card-name")
        count = html.Div(_uses(used), className="manage-count")
        if e["deleted"]:
            btns = html.Div(
                html.Button(t("✕ Undo delete"), id={"type": "acct-del", "index": i},
                            n_clicks=0, style=_UNDO_BTN),
                className="manage-card-btns")
            cards.append(html.Div([name, count, btns, _x()],
                                  className="manage-card deleted"))
        else:
            btns = html.Div(
                [html.Button(t("Rename"), id={"type": "acct-rename", "index": i},
                             n_clicks=0, style=_SMALL_BTN),
                 html.Button(t("Delete"), id={"type": "acct-del", "index": i},
                             n_clicks=0, style=_DEL_BTN)],
                className="manage-card-btns")
            cards.append(html.Div([name, count, btns], className="manage-card"))
    return cards


def _income_cards(draft: dict) -> list:
    out = []
    for e in draft["income"]:
        children = [html.Div(e["name"], className="manage-card-name")]
        cls = "manage-card"
        if e["deleted"]:
            children.append(_x()); cls = "manage-card deleted"
        out.append(html.Div(children, className=cls,
                            **{"data-select": f"income|{e['id']}"}))
    return out


def _expense_board(draft: dict) -> list:
    cols = []
    for e in draft["expense"]:
        col_deleted = e["deleted"]
        chips = []
        for s in e["subs"]:
            if s["deleted"] or col_deleted:
                chips.append(html.Div([s["name"], _x()],
                                      className="manage-chip deleted"))
            else:
                chips.append(html.Div(s["name"], className="manage-chip",
                                      **{"data-sub": s["name"]}))
        head = html.Div(e["name"], className="manage-col-head")
        children = [head, html.Div(chips, className="manage-chip-list")]
        cls = "manage-col"
        if col_deleted:
            children.append(_x()); cls = "manage-col deleted"
        cols.append(html.Div(children, className=cls,
                            **{"data-cat": e["id"], "data-select": f"expense|{e['id']}"}))
    return cols


def _subcat_detail(draft: dict, selected: str | None) -> list:
    if not draft or not selected or "|" not in selected:
        return [html.P(t("Tap a category to rename it, delete it, or edit its "
                         "subcategories."), style={"color": theme.MUTED})]
    kind, _id = selected.split("|", 1)
    _, entry = _find(draft.get(kind, []), _id)
    if entry is None:
        return [html.P(t("Tap a category to manage it."),
                       style={"color": theme.MUTED})]
    usage = store.category_usage(kind).get(entry["id"], 0)
    kind_label = t("Income") if kind == "income" else t("Spending")
    header = html.Div(
        [html.H3(entry["name"], style={"margin": 0, "color": theme.INK}),
         html.Span(f"{kind_label} · {_uses(usage)}",
                   style={"color": theme.MUTED, "fontSize": "13px"})],
        style={"display": "flex", "gap": "12px", "alignItems": "baseline"})

    if entry["deleted"]:
        return [header,
                html.Div(t("Marked for deletion — will be removed on Save."),
                         style={"color": theme.EXPENSE_COLOR, "fontSize": "13px",
                                "margin": "8px 0"}),
                html.Button(t("✕ Undo delete category"), id="manage-cat-del-btn",
                            n_clicks=0, style=_UNDO_BTN)]

    rename_row = html.Div(
        [dcc.Input(id="manage-catname", type="text", value=entry["name"],
                   style={**theme.INPUT_STYLE, "marginBottom": 0, "maxWidth": "220px"}),
         html.Button(t("Rename category"), id="manage-cat-rename-btn", n_clicks=0,
                     style=_SMALL_BTN),
         html.Button(t("Delete category"), id="manage-cat-del-btn", n_clicks=0,
                     style=_DEL_BTN)],
        style={"display": "flex", "gap": "8px", "alignItems": "center",
               "margin": "10px 0"})
    if kind == "income":
        return [header, rename_row]

    sub_usage = store.subcategory_usage(kind, entry["id"])
    sub_rows = []
    for j, s in enumerate(entry["subs"]):
        if s["deleted"]:
            sub_rows.append(html.Div(
                [html.Span(s["name"], className="manage-name",
                           style={"textDecoration": "line-through",
                                  "color": theme.MUTED}),
                 html.Button(t("✕ Undo"), id={"type": "subcat-del", "index": j},
                             n_clicks=0, style=_UNDO_BTN)],
                className="manage-row"))
            continue
        sn = 0 if s.get("new") else sub_usage.get(s["osub"], 0)
        sub_rows.append(html.Div(
            [dcc.Input(id={"type": "subcat-input", "index": j}, type="text",
                       value=s["name"], style={**theme.INPUT_STYLE, "marginBottom": 0,
                                               "maxWidth": "200px"}),
             html.Span(_uses(sn), className="manage-count"),
             html.Button(t("Rename"), id={"type": "subcat-rename", "index": j},
                         n_clicks=0, style=_SMALL_BTN),
             html.Button(t("Delete"), id={"type": "subcat-del", "index": j},
                         n_clicks=0, style=_DEL_BTN)],
            className="manage-row"))
    add_row = html.Div(
        [dcc.Input(id="manage-subcat-new", type="text", placeholder=t("New subcategory"),
                   style={**theme.INPUT_STYLE, "marginBottom": 0, "maxWidth": "200px"}),
         html.Button(t("+ Add subcategory"), id="manage-subcat-add", n_clicks=0,
                     style=_SMALL_BTN)],
        style={"display": "flex", "gap": "8px", "alignItems": "center",
               "marginTop": "8px"})
    return [header, rename_row,
            html.Div(t("Subcategories"), style={"color": theme.MUTED,
                                                "fontSize": "13px",
                                                "marginTop": "6px"}),
            html.Div(sub_rows or [html.P(t("None yet."), style={"color": theme.MUTED,
                                                                "fontSize": "13px"})]),
            add_row]


# ── layout ───────────────────────────────────────────────────────────────────

def _section_header(title: str, toggle_id: str) -> html.Div:
    return html.Div(
        [html.H2(t(title), style={"margin": 0, "color": theme.INK}),
         html.Span("▾", id=f"{toggle_id}-icon", className="manage-toggle-icon")],
        id=toggle_id, n_clicks=0, className="manage-header",
        title=t("Expand / collapse"))


def layout(**_):
    draft = _initial_draft()

    accounts_card = card([
        _section_header("Accounts", "manage-accounts-toggle"),
        html.Div(
            [html.P(t("Rename an account (updates every transaction, including "
                      "transfers) or delete one you no longer use."),
                    style={"color": theme.MUTED, "fontSize": "13px", "marginTop": "4px"}),
             html.Div(_account_cards(draft), id="manage-accounts",
                      className="manage-cardlist"),
             html.Div(id="manage-acct-msg")],
            id="manage-accounts-body", style=_HIDDEN),
    ])

    categories_card = card([
        _section_header("Categories", "manage-categories-toggle"),
        html.Div(
            [html.Div(t("Income"), style={**_LABEL, "marginTop": "4px"}),
             html.Div(_income_cards(draft), id="manage-income-cats",
                      className="manage-cardlist"),
             html.Div([html.Span(t("Spending"), style=_LABEL),
                       html.Span(t(" — drag a subcategory to another category to "
                                   "move it"),
                                 style={"fontSize": "13px", "color": theme.MUTED})],
                      style={"marginTop": "14px"}),
             html.Div(_expense_board(draft), id="manage-cat-cols",
                      className="manage-board"),
             html.Hr(style={"border": "none", "borderTop": "1px solid var(--border)",
                            "margin": "16px 0"}),
             html.Div(_subcat_detail(draft, None), id="manage-cat-detail"),
             html.Div(id="manage-cat-msg")],
            id="manage-categories-body", style=_HIDDEN),
    ], style={"marginTop": "16px"})

    save_row = html.Div(
        [html.Button(t("Save settings"), id="manage-save-btn", n_clicks=0,
                     style=theme.BUTTON_STYLE),
         html.Span(id="manage-save-msg", style={"alignSelf": "center",
                                                "fontSize": "14px"})],
        style={"display": "flex", "gap": "14px", "alignItems": "center",
               "marginTop": "18px"})

    rename_modal = html.Div(
        html.Div(
            [html.H3(t("Rename account"), style={"color": theme.INK}),
             dcc.Input(id="manage-acct-name", type="text",
                       style={**theme.INPUT_STYLE, "width": "100%"}),
             html.Div(
                 [html.Button(t("Cancel"), id="manage-acct-cancel", n_clicks=0,
                              style=theme.PERIOD_BUTTON_STYLE),
                  html.Button(t("Save"), id="manage-acct-save", n_clicks=0,
                              style=theme.BUTTON_STYLE)],
                 style={"display": "flex", "gap": "10px", "justifyContent": "flex-end",
                        "marginTop": "14px"})],
            className="modal-card"),
        id="manage-acct-modal", className="modal-overlay", style=_HIDDEN)

    save_modal = html.Div(
        html.Div(
            [html.H3(t("Review changes"), style={"color": theme.INK}),
             html.Div(id="manage-save-summary"),
             html.Div(
                 [html.Button(t("Cancel"), id="manage-cancel-btn", n_clicks=0,
                              style=theme.PERIOD_BUTTON_STYLE),
                  html.Button(t("Apply changes"), id="manage-apply-btn", n_clicks=0,
                              style=theme.BUTTON_STYLE)],
                 style={"display": "flex", "gap": "10px", "justifyContent": "flex-end",
                        "marginTop": "16px"})],
            className="modal-card"),
        id="manage-save-modal", className="modal-overlay", style=_HIDDEN)

    return html.Div(
        [page_header("Manage accounts & categories",
                     "Tidy up the account and category lists.",
                     back=("Settings", "/settings")),
         dcc.Store(id="manage-draft", data=draft),
         dcc.Store(id="manage-submove"),
         dcc.Store(id="manage-cat-selected"),
         dcc.Store(id="manage-acct-target"),
         dcc.Store(id="manage-open", data=None),
         dcc.Store(id="manage-dirty", data=False),
         dcc.Store(id="manage-dirty-sink"),
         accounts_card,
         categories_card,
         save_row,
         rename_modal,
         save_modal],
        style=theme.PAGE_STYLE)


# ── render from draft ────────────────────────────────────────────────────────

@callback(
    Output("manage-accounts", "children"),
    Output("manage-income-cats", "children"),
    Output("manage-cat-cols", "children"),
    Input("manage-draft", "data"),
)
def _render_all(draft):
    return _account_cards(draft), _income_cards(draft), _expense_board(draft)


@callback(
    Output("manage-cat-detail", "children"),
    Input("manage-draft", "data"),
    Input("manage-cat-selected", "data"),
)
def _render_detail(draft, selected):
    return _subcat_detail(draft, selected)


@callback(
    Output("manage-dirty", "data"),
    Input("manage-draft", "data"),
)
def _compute_dirty(draft):
    return _is_dirty(draft)


# Mirror the dirty flag to the browser for the leave-page guard (manage_guard.js).
clientside_callback(
    "function(d){ window.__manageDirty = !!d; return ''; }",
    Output("manage-dirty-sink", "data"),
    Input("manage-dirty", "data"),
)


# ── collapsible accordion (whole header row clickable) ───────────────────────

@callback(
    Output("manage-accounts-body", "style"),
    Output("manage-categories-body", "style"),
    Output("manage-accounts-toggle-icon", "children"),
    Output("manage-categories-toggle-icon", "children"),
    Output("manage-open", "data"),
    Input("manage-accounts-toggle", "n_clicks"),
    Input("manage-categories-toggle", "n_clicks"),
    State("manage-open", "data"),
    prevent_initial_call=True,
)
def _toggle_sections(_a, _c, current):
    name = "accounts" if ctx.triggered_id == "manage-accounts-toggle" else "categories"
    new = None if current == name else name
    show, hide = {"display": "block"}, {"display": "none"}
    return (show if new == "accounts" else hide,
            show if new == "categories" else hide,
            "▴" if new == "accounts" else "▾",
            "▴" if new == "categories" else "▾",
            new)


# ── accounts: rename (staged) ────────────────────────────────────────────────

@callback(
    Output("manage-acct-modal", "style"),
    Output("manage-acct-name", "value"),
    Output("manage-acct-target", "data"),
    Input({"type": "acct-rename", "index": ALL}, "n_clicks"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _open_rename_modal(_clicks, draft):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    idx = ctx.triggered_id["index"]
    if idx >= len(draft["accounts"]):
        raise PreventUpdate
    return {}, draft["accounts"][idx]["name"], idx


@callback(
    Output("manage-acct-modal", "style", allow_duplicate=True),
    Input("manage-acct-cancel", "n_clicks"),
    prevent_initial_call=True,
)
def _close_rename_modal(_n):
    return _HIDDEN


@callback(
    Output("manage-draft", "data", allow_duplicate=True),
    Output("manage-acct-msg", "children"),
    Output("manage-acct-msg", "style"),
    Output("manage-acct-modal", "style", allow_duplicate=True),
    Input("manage-acct-save", "n_clicks"),
    State("manage-acct-name", "value"),
    State("manage-acct-target", "data"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _stage_rename_account(_n, new, idx, draft):
    new = (new or "").strip()
    if idx is None or not new:
        raise PreventUpdate
    draft = copy.deepcopy(draft)
    entry = draft["accounts"][idx]
    if new == entry["name"]:
        return no_update, "", _OK, _HIDDEN
    others = {a["name"] for k, a in enumerate(draft["accounts"])
              if k != idx and not a["deleted"]}
    if new in others:
        return (no_update, t("An account named '{name}' already exists.").format(
            name=new), _ERR, no_update)
    entry["name"] = new
    return draft, t("Staged rename → '{name}'.").format(name=new), _OK, _HIDDEN


@callback(
    Output("manage-draft", "data", allow_duplicate=True),
    Output("manage-acct-msg", "children", allow_duplicate=True),
    Output("manage-acct-msg", "style", allow_duplicate=True),
    Input({"type": "acct-del", "index": ALL}, "n_clicks"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _toggle_delete_account(_clicks, draft):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    idx = ctx.triggered_id["index"]
    draft = copy.deepcopy(draft)
    entry = draft["accounts"][idx]
    if not entry["deleted"]:
        used = store.account_usage().get(entry["id"], 0)
        if used:
            return (no_update, t("'{name}' is used by {n} transaction(s) — rename "
                    "it or reassign those first.").format(
                        name=entry['name'], n=used), _ERR)
        entry["deleted"] = True
        return draft, t("Staged delete of '{name}'.").format(name=entry['name']), _OK
    entry["deleted"] = False
    return draft, t("Restored '{name}'.").format(name=entry['name']), _OK


# ── categories: rename / delete (staged) ─────────────────────────────────────

@callback(
    Output("manage-draft", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children"),
    Output("manage-cat-msg", "style"),
    Input("manage-cat-rename-btn", "n_clicks"),
    State("manage-catname", "value"),
    State("manage-cat-selected", "data"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _stage_rename_category(_n, new, selected, draft):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate          # ignore the fire when the button is (re)created
    if not selected or "|" not in selected:
        raise PreventUpdate
    kind, _id = selected.split("|", 1)
    new = (new or "").strip()
    draft = copy.deepcopy(draft)
    idx, entry = _find(draft[kind], _id)
    if entry is None or not new or new == entry["name"]:
        raise PreventUpdate
    others = {e["name"] for k, e in enumerate(draft[kind])
              if k != idx and not e["deleted"]}
    if new in others:
        return no_update, t("A category named '{name}' already exists.").format(
            name=new), _ERR
    entry["name"] = new
    return draft, t("Staged rename → '{name}'.").format(name=new), _OK


@callback(
    Output("manage-draft", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input("manage-cat-del-btn", "n_clicks"),
    State("manage-cat-selected", "data"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _toggle_delete_category(_n, selected, draft):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate          # ignore the fire when the button is (re)created
    if not selected or "|" not in selected:
        raise PreventUpdate
    kind, _id = selected.split("|", 1)
    draft = copy.deepcopy(draft)
    _, entry = _find(draft[kind], _id)
    if entry is None:
        raise PreventUpdate
    if not entry["deleted"]:
        used = store.category_usage(kind).get(entry["id"], 0)
        if used:
            return (no_update, t("'{name}' is used by {n} transaction(s) — rename "
                    "or reassign those first.").format(
                        name=entry['name'], n=used), _ERR)
        entry["deleted"] = True
        return draft, t("Staged delete of '{name}'.").format(name=entry['name']), _OK
    entry["deleted"] = False
    return draft, t("Restored '{name}'.").format(name=entry['name']), _OK


# ── subcategories: add / rename / delete (staged) ────────────────────────────

@callback(
    Output("manage-draft", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input("manage-subcat-add", "n_clicks"),
    State("manage-subcat-new", "value"),
    State("manage-cat-selected", "data"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _stage_add_subcategory(_n, name, selected, draft):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate          # ignore the fire when the button is (re)created
    name = (name or "").strip()
    if not name or not selected or "|" not in selected:
        raise PreventUpdate
    kind, _id = selected.split("|", 1)
    if kind != "expense":
        raise PreventUpdate
    draft = copy.deepcopy(draft)
    _, entry = _find(draft["expense"], _id)
    if entry is None:
        raise PreventUpdate
    if name in {s["name"] for s in entry["subs"] if not s["deleted"]}:
        return no_update, t("'{name}' already exists.").format(name=name), _ERR
    entry["subs"].append({"ocat": None, "osub": None, "name": name,
                          "deleted": False, "new": True})
    return draft, t("Staged new subcategory '{name}'.").format(name=name), _OK


@callback(
    Output("manage-draft", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input({"type": "subcat-rename", "index": ALL}, "n_clicks"),
    State({"type": "subcat-input", "index": ALL}, "value"),
    State({"type": "subcat-input", "index": ALL}, "id"),
    State("manage-cat-selected", "data"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _stage_rename_subcategory(_clicks, values, ids, selected, draft):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    if not selected or "|" not in selected:
        raise PreventUpdate
    kind, _id = selected.split("|", 1)
    j = ctx.triggered_id["index"]
    val = next((v for i, v in zip(ids, values) if i["index"] == j), None)
    new = (val or "").strip()
    draft = copy.deepcopy(draft)
    _, entry = _find(draft["expense"], _id)
    if entry is None or j >= len(entry["subs"]):
        raise PreventUpdate
    sub = entry["subs"][j]
    if not new or new == sub["name"]:
        raise PreventUpdate
    if new in {s["name"] for k, s in enumerate(entry["subs"])
               if k != j and not s["deleted"]}:
        return no_update, t("'{name}' already exists.").format(name=new), _ERR
    sub["name"] = new
    return draft, t("Staged rename → '{name}'.").format(name=new), _OK


@callback(
    Output("manage-draft", "data", allow_duplicate=True),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input({"type": "subcat-del", "index": ALL}, "n_clicks"),
    State("manage-cat-selected", "data"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _toggle_delete_subcategory(_clicks, selected, draft):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    if not selected or "|" not in selected:
        raise PreventUpdate
    kind, _id = selected.split("|", 1)
    j = ctx.triggered_id["index"]
    draft = copy.deepcopy(draft)
    _, entry = _find(draft["expense"], _id)
    if entry is None or j >= len(entry["subs"]):
        raise PreventUpdate
    sub = entry["subs"][j]
    if not sub["deleted"]:
        if not sub.get("new"):
            used = store.subcategory_usage("expense", sub["ocat"]).get(sub["osub"], 0)
            if used:
                return (no_update, t("'{name}' is used by {n} transaction(s) — "
                        "rename or reassign those first.").format(
                            name=sub['name'], n=used), _ERR)
        sub["deleted"] = True
        return draft, t("Staged delete of '{name}'.").format(name=sub['name']), _OK
    sub["deleted"] = False
    return draft, t("Restored '{name}'.").format(name=sub['name']), _OK


# ── subcategory drag-move (staged) ───────────────────────────────────────────

@callback(
    Output("manage-draft", "data"),
    Output("manage-cat-msg", "children", allow_duplicate=True),
    Output("manage-cat-msg", "style", allow_duplicate=True),
    Input("manage-submove", "data"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _stage_submove(move, draft):
    if not move:
        raise PreventUpdate
    sub_name, frm, to = move.get("sub"), move.get("from"), move.get("to")
    if not (sub_name and frm and to) or frm == to:
        raise PreventUpdate
    draft = copy.deepcopy(draft)
    _, src = _find(draft["expense"], frm)
    _, dst = _find(draft["expense"], to)
    if src is None or dst is None or src["deleted"] or dst["deleted"]:
        raise PreventUpdate
    pos = next((k for k, s in enumerate(src["subs"])
                if s["name"] == sub_name and not s["deleted"]), None)
    if pos is None:
        raise PreventUpdate
    if sub_name in {s["name"] for s in dst["subs"] if not s["deleted"]}:
        return no_update, t("'{cat}' already has a '{sub}'.").format(
            cat=dst['name'], sub=sub_name), _ERR
    dst["subs"].append(src["subs"].pop(pos))
    return draft, t("Moved '{sub}' → {cat}.").format(
        sub=sub_name, cat=dst['name']), _OK


# ── save settings → summary modal → apply ────────────────────────────────────

def _summary_block(title: str, lines: list) -> html.Div:
    return html.Div(
        [html.Div(title, style={"fontWeight": 600, "margin": "8px 0 4px"}),
         html.Ul([html.Li(x) for x in lines],
                 style={"margin": 0, "paddingLeft": "18px"})])


@callback(
    Output("manage-save-modal", "style"),
    Output("manage-save-summary", "children"),
    Output("manage-save-msg", "children"),
    Output("manage-save-msg", "style"),
    Input("manage-save-btn", "n_clicks"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _open_save(_n, draft):
    acct, cat = _summarize(draft)
    if not acct and not cat:
        return (_HIDDEN, no_update, t("No changes to apply."),
                {**_OK, "color": theme.MUTED})
    body = []
    if acct:
        body.append(_summary_block(t("Account changes:"), acct))
    if cat:
        body.append(_summary_block(t("Category changes:"), cat))
    return {}, body, "", _OK


@callback(
    Output("manage-save-modal", "style", allow_duplicate=True),
    Input("manage-cancel-btn", "n_clicks"),
    prevent_initial_call=True,
)
def _cancel_save(_n):
    return _HIDDEN


@callback(
    Output("manage-draft", "data", allow_duplicate=True),
    Output("manage-save-modal", "style", allow_duplicate=True),
    Output("manage-save-msg", "children", allow_duplicate=True),
    Output("manage-save-msg", "style", allow_duplicate=True),
    Input("manage-apply-btn", "n_clicks"),
    State("manage-draft", "data"),
    prevent_initial_call=True,
)
def _apply_save(_n, draft):
    try:
        _apply_draft(draft)
    except Exception as exc:  # surface any write error, keep the draft
        return no_update, no_update, t("Could not apply: {err}").format(err=exc), _ERR
    return _initial_draft(), _HIDDEN, t("Changes applied."), _OK
