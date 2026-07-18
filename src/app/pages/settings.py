"""Settings page — edit config/settings.toml values in the app.

Reads the current values from the cached config and writes changes back with
``config.save_settings`` (in-place, comment-preserving). After saving it clears
the config cache so emergency-fund settings take effect on the next render.
"""

from __future__ import annotations

import dash
from dash import (dcc, html, callback, clientside_callback, ctx, ALL, no_update,
                  Input, Output, State)
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header
from src.app.i18n import make_t, LANGUAGES, second_lang_native
from src.app.data import (get_config, emergency_fund_config, privacy_config,
                          account_names, refresh_config, tax_config,
                          language_config, _resolve_paid_sub)
from src.analytics.transaction_categories import load_categories
from src.utils.config import save_settings

t = make_t("settings")

dash.register_page(__name__, path="/settings", name="Settings", order=8)


def _settings_changes(saved: dict, current: dict) -> list[str]:
    """Human-readable ``"{label}: {old} → {new}"`` lines for every setting whose
    ``current`` value differs from the ``saved`` one. Pure (so it is unit-testable);
    reuses the field-label translations. Returns ``[]`` when nothing changed."""
    def line(label, old, new):
        return t("{label}: {old} → {new}").format(label=label, old=old, new=new)

    def onoff(v):
        return t("on") if v else t("off")

    changes = []
    if saved["app_name"] != current["app_name"]:
        changes.append(line(t("App name"), saved["app_name"], current["app_name"]))
    if saved["base_currency"] != current["base_currency"]:
        changes.append(line(t("Base currency"), saved["base_currency"],
                            current["base_currency"]))
    if saved["monthly"] != current["monthly"]:
        changes.append(line(t("Monthly required expenses"), saved["monthly"],
                            current["monthly"]))
    if saved["months"] != current["months"]:
        changes.append(line(t("Target months"), saved["months"], current["months"]))
    if saved["accounts"] != current["accounts"]:
        changes.append(line(t("Savings account(s)"), ", ".join(saved["accounts"]),
                            ", ".join(current["accounts"])))
    if saved["privacy_auto"] != current["privacy_auto"]:
        changes.append(line(t("Auto-privacy"), onoff(saved["privacy_auto"]),
                            onoff(current["privacy_auto"])))
    if saved["privacy_seconds"] != current["privacy_seconds"]:
        changes.append(line(t("Idle delay (seconds)"), saved["privacy_seconds"],
                            current["privacy_seconds"]))
    if saved["income_sels"] != current["income_sels"]:
        allc = lambda xs: ", ".join(xs) if xs else t("All income")
        changes.append(line(t("Income categories (for tax)"),
                            allc(saved["income_sels"]), allc(current["income_sels"])))
    if saved["paid_sels"] != current["paid_sels"]:
        changes.append(line(t("Tax-payment subcategories"),
                            ", ".join(saved["paid_sels"]),
                            ", ".join(current["paid_sels"])))
    if saved["lang_disabled"] != current["lang_disabled"]:
        state = lambda v: t("disabled") if v else t("allowed")
        changes.append(line(t("Language toggle"), state(saved["lang_disabled"]),
                            state(current["lang_disabled"])))
    if saved["lang_second"] != current["lang_second"]:
        changes.append(line(t("Second language"),
                            second_lang_native(saved["lang_second"]),
                            second_lang_native(current["lang_second"])))
    return changes


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
                html.Button(t("− remove account"),
                            id={"type": "set-ef-acct-remove", "index": i}, n_clicks=0,
                            className="nav-btn",
                            style={"color": theme.EXPENSE_COLOR,
                                   "borderColor": theme.EXPENSE_COLOR,
                                   "whiteSpace": "nowrap"}))
        rows.append(html.Div(children, style={"display": "flex", "gap": "8px",
                                              "alignItems": "center",
                                              "marginTop": "6px"}))
    return rows


# ── Tax category/subcategory pickers (pop-up + addable list) ─────────────────
# A selection is an encoded string: "Category" (whole category) or
# "Category / Subcategory" (a specific subcategory).

def _selection_label(sel: str) -> str:
    """Row label for an encoded selection: 'Cat / Sub' stays as-is; a whole-category
    selection reads 'Cat (all)'."""
    if " / " in str(sel):
        return str(sel)
    return t("{cat} (all)").format(cat=sel)


def _pick_tiles(kind: str, pane: dict | None) -> list:
    """Drill-down tile grid shared by both tax pickers. ``kind`` is the categories
    tree to read ("income" or "expense"). Top level lists categories — those with
    subcategories drill in, those without are selected as a whole category on click.
    The sub level offers a Back tile, a "Whole category" tile, and one tile per
    subcategory."""
    tree = load_categories().get(kind, {})
    pane = pane or {"level": "top"}
    if pane.get("level") == "sub":
        cat = pane.get("category", "")
        tiles = [html.Button(t("‹ Back"), n_clicks=0, className="cat-tile parent",
                             id={"role": "tax-pick-back", "name": "back"}),
                 html.Button(t("Whole category"), n_clicks=0,
                             className="cat-tile add",
                             id={"role": "tax-pick-whole", "name": cat})]
        tiles += [html.Button(s, n_clicks=0, className="cat-tile",
                              id={"role": "tax-pick-sub", "name": s})
                  for s in tree.get(cat, [])]
        return tiles
    tiles = []
    for cat, subs in tree.items():
        if subs:
            tiles.append(html.Button(f"{cat} ▾", n_clicks=0, className="cat-tile parent",
                                     id={"role": "tax-pick-cat", "name": cat}))
        else:
            tiles.append(html.Button(cat, n_clicks=0, className="cat-tile",
                                     id={"role": "tax-pick-whole", "name": cat}))
    return tiles


def _pick_title(target: str, pane: dict | None) -> str:
    if (pane or {}).get("level") == "sub":
        return t("Select in {cat}").format(cat=(pane or {}).get("category", ""))
    return t("Select tax category") if target == "paid" else t("Select income category")


def _selected_rows(items: list[str], remove_type: str, label_fn=None) -> list:
    """EF-style rows: one "<label> · − remove" row per selected item."""
    rows = []
    for i, name in enumerate(items or []):
        label = label_fn(name) if label_fn else name
        rows.append(html.Div(
            [
                html.Span(label, style={"flex": "1", "color": theme.INK}),
                html.Button(t("− remove"),
                            id={"type": remove_type, "index": i}, n_clicks=0,
                            className="nav-btn",
                            style={"color": theme.EXPENSE_COLOR,
                                   "borderColor": theme.EXPENSE_COLOR,
                                   "whiteSpace": "nowrap"}),
            ],
            style={"display": "flex", "gap": "8px", "alignItems": "center",
                   "marginTop": "6px"}))
    return rows


def _tax_pick_modal() -> html.Div:
    """The shared pop-up used by both tax pickers (income + tax-payment)."""
    return html.Div(
        html.Div(
            [
                html.Div(
                    [html.H3(id="set-tax-pick-title", style={"flex": "1"}),
                     html.Button("✕", id="set-tax-pick-close", n_clicks=0,
                                 className="theme-toggle")],
                    style={"display": "flex", "alignItems": "center", "gap": "10px"}),
                html.Div(id="set-tax-pick-body", className="cat-grid"),
            ],
            className="modal-card"),
        id="set-tax-pick-modal", className="modal-overlay", style={"display": "none"},
        # Backdrop click → close button (handled in popup_dismiss.js).
        **{"data-close": "set-tax-pick-close"})


def layout(**_):
    general = get_config().get("settings", {}).get("general", {})
    ef = emergency_fund_config()

    general_card = html.Div(
        [
            html.H2(t("General"), style={"color": theme.INK, "marginTop": 0}),
            _field(t("App name"),
                   dcc.Input(id="set-app-name", type="text",
                             value=general.get("app_name", "Money Tracker"),
                             style={**theme.INPUT_STYLE, "marginTop": "4px"})),
            _field(t("Base currency"),
                   dcc.Input(id="set-currency", type="text",
                             value=general.get("base_currency", "THB"),
                             style={**theme.INPUT_STYLE, "marginTop": "4px", "width": "120px",
                                    "marginLeft": "10px"}),
                   hint=t("Stamped on new transactions. The display currency across figures "
                          "updates fully after an app restart.")),
        ],
        style=theme.CARD_STYLE,
    )

    ef_card = html.Div(
        [
            html.H2(t("Emergency fund"), style={"color": theme.INK, "marginTop": 0}),
            _field(t("Monthly required expenses"),
                   dcc.Input(id="set-ef-monthly", type="number", min=0,
                             value=ef["monthly_required"], className="no-spin",
                             style={**theme.INPUT_STYLE, "marginTop": "4px", "width": "180px",
                                    "marginLeft": "10px"})),
            _field(t("Target months"),
                   dcc.Input(id="set-ef-months", type="number", min=1, max=60, step=1,
                             value=ef["target_months"], className="no-spin",
                             style={**theme.INPUT_STYLE, "marginTop": "4px", "width": "120px",
                                    "marginLeft": "10px"}),
                   hint=t("Emergency-fund target = target months × monthly required expenses.")),
            _field(t("Savings account(s)"),
                   html.Div(
                       [
                           dcc.Store(id="set-ef-accounts-store",
                                     data=ef["savings_accounts"]),
                           html.Div(id="set-ef-accounts"),
                           html.Button(t("+ savings account"), id="set-ef-acct-add",
                                       n_clicks=0, className="nav-btn today",
                                       style={"marginTop": "6px"}),
                       ]),
                   hint=t("The Financial Goals savings pool combines the balances of "
                          "all listed accounts.")),
        ],
        style={**theme.CARD_STYLE, "marginTop": "16px"},
    )

    pc = privacy_config()
    privacy_card = html.Div(
        [
            html.H2(t("Privacy"), style={"color": theme.INK, "marginTop": 0}),
            _field(
                t("Auto-privacy"),
                dcc.Checklist(
                    id="set-privacy-auto",
                    options=[{"label": " " + t("Hide amounts automatically when the home "
                                              "page is left idle"), "value": "on"}],
                    value=(["on"] if pc["auto_enabled"] else []),
                    style={"marginTop": "4px", "color": theme.INK, "fontSize": "14px"},
                    inputStyle={"marginRight": "6px"},
                ),
            ),
            _field(
                t("Idle delay (seconds)"),
                dcc.Input(id="set-privacy-seconds", type="number", min=1, max=3600, step=1,
                          value=pc["idle_seconds"], className="no-spin",
                          style={**theme.INPUT_STYLE, "marginTop": "4px", "width": "120px",
                                 "marginLeft": "10px"}),
                hint=t("Amounts stay hidden until you click the eye toggle to reveal them."),
            ),
        ],
        style={**theme.CARD_STYLE, "marginTop": "16px"},
    )

    lc = language_config()
    language_card = html.Div(
        [
            html.H2(t("Language settings"), style={"color": theme.INK, "marginTop": 0}),
            _field(
                t("Language toggle"),
                dcc.Checklist(
                    id="set-lang-disable",
                    options=[{"label": " " + t("Disable language toggling"), "value": "on"}],
                    value=(["on"] if lc["toggle_disabled"] else []),
                    inputClassName="sq-tick",
                    style={"marginTop": "4px", "color": theme.INK, "fontSize": "14px"},
                ),
                hint=t("When disabled, the EN/ไทย switch at the top still shows but "
                       "cannot change the language."),
            ),
            _field(
                t("Second language"),
                dcc.Dropdown(
                    id="set-lang-second",
                    options=[{"label": f'{v["english"]} / {v["native"]}', "value": code}
                             for code, v in LANGUAGES.items()],
                    value=lc["second_language"], clearable=False,
                    style={"marginTop": "4px", "maxWidth": "260px"}),
                hint=t("English is always the first language. Choose the language the "
                       "toggle translates to."),
            ),
            dcc.Store(id="lang-disable-sink"),
        ],
        style={**theme.CARD_STYLE, "marginTop": "16px"},
    )

    tc = tax_config()
    tax_card = html.Div(
        [
            html.H2(t("Tax setting"), style={"color": theme.INK, "marginTop": 0}),
            _field(t("Income categories (for tax)"),
                   html.Div(
                       [
                           dcc.Store(id="set-tax-inc-store",
                                     data=tc["income_selections"]),
                           html.Div(id="set-tax-inc-rows"),
                           html.Button(t("+ add category"), id="set-tax-inc-add",
                                       n_clicks=0, className="nav-btn today",
                                       style={"marginTop": "6px"}),
                       ]),
                   hint=t("Leave empty to tax all income. The Income Tax page prefills "
                          "gross income from the categories you add here.")),
            _field(t("Tax-payment subcategories"),
                   html.Div(
                       [
                           dcc.Store(id="set-tax-paid-store",
                                     data=tc["paid_selections"]),
                           html.Div(id="set-tax-paid-rows"),
                           html.Button(t("+ add subcategory"), id="set-tax-paid-add",
                                       n_clicks=0, className="nav-btn today",
                                       style={"marginTop": "6px"}),
                       ]),
                   hint=t("The Income Tax page sums these expense subcategories over "
                          "the year as the tax you have already paid.")),
            dcc.Store(id="set-tax-pick-target", data="income"),
            dcc.Store(id="set-tax-pick-pane", data={"level": "top"}),
        ],
        style={**theme.CARD_STYLE, "marginTop": "16px"},
    )

    save_row = html.Div(
        [
            html.Button(t("Save settings"), id="set-save", n_clicks=0, style=theme.BUTTON_STYLE),
            html.Span(id="set-msg", style={"alignSelf": "center", "fontSize": "14px"}),
        ],
        style={"display": "flex", "gap": "14px", "alignItems": "center",
               "justifyContent": "center", "marginTop": "16px"},
    )

    tools_card = html.Div(
        [
            html.H2(t("Account tools"), style={"color": theme.INK, "marginTop": 0}),
            html.Div(t("Transaction data"), style={"color": theme.MUTED, "fontSize": "13px",
                                                "marginTop": "6px"}),
            html.Div(
                [
                    dcc.Link(t("⬇ Import"), href="/import", className="home-action-btn view",
                             style={"flex": "1", "margin": "8px 0 0"}),
                    dcc.Link(t("⬆ Export"), href="/transactions", className="home-action-btn view",
                             style={"flex": "1", "margin": "8px 0 0"}),
                ],
                style={"display": "flex", "gap": "10px"},
            ),
            dcc.Link(t("Reconcile balances"), href="/reconcile", className="home-action-btn view"),
            dcc.Link(t("Manage accounts & categories"), href="/manage",
                     className="home-action-btn view"),
            dcc.Link(t("Backup & restore"), href="/backup", className="home-action-btn view"),

            html.Hr(style={"border": "none", "borderTop": "1px solid var(--border)",
                           "margin": "16px 0 10px"}),
            html.Button(t("Remove transactions"), id="set-remove-btn", n_clicks=0,
                        style={**theme.BUTTON_STYLE, "background": theme.EXPENSE_COLOR,
                               "color": "#fff", "width": "100%"}),
            dcc.ConfirmDialog(
                id="set-remove-confirm",
                message=t("⚠ Danger Zone\n\nThe next screen lets you permanently "
                          "delete transactions within a date range you choose. "
                          "Deletions are backed up first, but cannot be undone from "
                          "that page.\n\nOpen the Remove Transactions tool?")),
            dcc.Location(id="set-remove-nav", refresh="callback-nav"),
        ],
        style=theme.CARD_STYLE,
    )

    return html.Div(
        [
            page_header("Settings", "Edit your app configuration."),
            # Leave-page guard: change summary + a mirror sink (see settings_guard.js).
            dcc.Store(id="settings-guard"),
            dcc.Store(id="settings-guard-sink"),
            html.Div(
                [
                    html.Div([general_card, ef_card, tax_card],
                             style={"flex": "1", "minWidth": 0}),
                    html.Div([tools_card, privacy_card, language_card],
                             style={"flex": "1", "minWidth": 0}),
                ],
                className="mt-split",
                style={"display": "flex", "alignItems": "flex-start", "gap": "20px"},
            ),
            save_row,   # very bottom of the page, spanning both columns
            _tax_pick_modal(),
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
    State("set-tax-inc-store", "data"),
    State("set-tax-paid-store", "data"),
    State("set-lang-disable", "value"),
    State("set-lang-second", "value"),
    prevent_initial_call=True,
)
def _save(n, app_name, currency, monthly, months, accounts, privacy_auto,
          privacy_seconds, tax_inc, tax_paid, lang_disable, lang_second):
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
            "tax": {
                "income_selections": list(dict.fromkeys(
                    c for c in (tax_inc or []) if c and str(c).strip())),
                "paid_selections": list(dict.fromkeys(
                    s for s in (tax_paid or []) if s and str(s).strip())),
            },
            "language": {
                "toggle_disabled": bool(lang_disable),
                "second_language": (lang_second or "th"),
            },
        })
        refresh_config()
        return t("Saved."), ok
    except Exception as exc:  # surface any write/validation error to the user
        return t("Could not save: {err}").format(err=exc), err


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


# ── Tax pickers: shared pop-up + addable lists ───────────────────────────────

@callback(
    Output("set-tax-pick-modal", "style"),
    Output("set-tax-pick-target", "data"),
    Output("set-tax-pick-pane", "data", allow_duplicate=True),
    Input("set-tax-inc-add", "n_clicks"),
    Input("set-tax-paid-add", "n_clicks"),
    Input("set-tax-pick-close", "n_clicks"),
    prevent_initial_call=True,
)
def _open_close_tax_pick(_inc, _paid, _close):
    trig = ctx.triggered_id
    if trig == "set-tax-inc-add":
        return {"display": "flex"}, "income", {"level": "top"}
    if trig == "set-tax-paid-add":
        return {"display": "flex"}, "paid", {"level": "top"}
    return {"display": "none"}, no_update, {"level": "top"}


@callback(
    Output("set-tax-pick-body", "children"),
    Output("set-tax-pick-title", "children"),
    Input("set-tax-pick-target", "data"),
    Input("set-tax-pick-pane", "data"),
)
def _render_tax_pick(target, pane):
    kind = "expense" if target == "paid" else "income"
    return _pick_tiles(kind, pane), _pick_title(target, pane)


@callback(
    Output("set-tax-inc-store", "data"),
    Output("set-tax-paid-store", "data"),
    Output("set-tax-pick-modal", "style", allow_duplicate=True),
    Output("set-tax-pick-pane", "data"),
    Input({"role": "tax-pick-cat", "name": ALL}, "n_clicks"),    # drill into category
    Input({"role": "tax-pick-whole", "name": ALL}, "n_clicks"),  # whole category
    Input({"role": "tax-pick-sub", "name": ALL}, "n_clicks"),    # subcategory
    Input({"role": "tax-pick-back", "name": ALL}, "n_clicks"),   # back
    State("set-tax-pick-target", "data"),
    State("set-tax-pick-pane", "data"),
    State("set-tax-inc-store", "data"),
    State("set-tax-paid-store", "data"),
    prevent_initial_call=True,
)
def _tax_pick_click(_cats, _wholes, _subs, _back, target, pane, inc, paid):
    # Pattern inputs also fire when tiles re-render — ignore those.
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    trig = ctx.triggered_id or {}
    role, name = trig.get("role"), trig.get("name")
    if role == "tax-pick-back":
        return no_update, no_update, no_update, {"level": "top"}
    if role == "tax-pick-cat":                        # drill into the category
        return no_update, no_update, no_update, {"level": "sub", "category": name}
    # Append a selection (whole category, or "Category / Subcategory") to the store
    # for the active target, then close.
    if role == "tax-pick-whole":
        sel = str(name)
    else:                                             # tax-pick-sub
        cat = (pane or {}).get("category", "")
        sel = f"{cat} / {name}"
    store = list((paid if target == "paid" else inc) or [])
    if sel and sel not in store:
        store.append(sel)
    if target == "paid":
        return no_update, store, {"display": "none"}, {"level": "top"}
    return store, no_update, {"display": "none"}, {"level": "top"}


@callback(
    Output("set-tax-inc-rows", "children"),
    Input("set-tax-inc-store", "data"),
)
def _render_tax_inc_rows(items):
    if not items:
        return html.Div(t("All income (default)"),
                        style={"color": theme.INK, "marginTop": "6px"})
    return _selected_rows(items, "tax-inc-remove", label_fn=_selection_label)


@callback(
    Output("set-tax-paid-rows", "children"),
    Input("set-tax-paid-store", "data"),
)
def _render_tax_paid_rows(items):
    if not items:
        return html.Div(t("None selected — defaults to “Tax”."),
                        style={"color": theme.INK, "marginTop": "6px"})
    return _selected_rows(items, "tax-paid-remove", label_fn=_selection_label)


@callback(
    Output("set-tax-inc-store", "data", allow_duplicate=True),
    Input({"type": "tax-inc-remove", "index": ALL}, "n_clicks"),
    State("set-tax-inc-store", "data"),
    prevent_initial_call=True,
)
def _remove_tax_inc(_clicks, items):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    idx = (ctx.triggered_id or {}).get("index")
    items = list(items or [])
    if isinstance(idx, int) and 0 <= idx < len(items):
        items.pop(idx)
    return items


@callback(
    Output("set-tax-paid-store", "data", allow_duplicate=True),
    Input({"type": "tax-paid-remove", "index": ALL}, "n_clicks"),
    State("set-tax-paid-store", "data"),
    prevent_initial_call=True,
)
def _remove_tax_paid(_clicks, items):
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    idx = (ctx.triggered_id or {}).get("index")
    items = list(items or [])
    if isinstance(idx, int) and 0 <= idx < len(items):
        items.pop(idx)
    return items


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


# Live preview: reflect the "disable language toggling" tick box on the header pill
# immediately (its data-locked drives the toggle's behaviour). Persisting still
# needs Save; navigating/reloading re-reads the saved config.
clientside_callback(
    """
    function (value) {
        var btn = document.getElementById("lang-toggle");
        if (btn) { btn.setAttribute("data-locked", (value && value.length) ? "1" : "0"); }
        return window.dash_clientside.no_update;
    }
    """,
    Output("lang-disable-sink", "data"),
    Input("set-lang-disable", "value"),
)


@callback(
    Output("settings-guard", "data"),
    Input("set-app-name", "value"),
    Input("set-currency", "value"),
    Input("set-ef-monthly", "value"),
    Input("set-ef-months", "value"),
    Input({"type": "set-ef-acct", "index": ALL}, "value"),
    Input("set-privacy-auto", "value"),
    Input("set-privacy-seconds", "value"),
    Input("set-tax-inc-store", "data"),
    Input("set-tax-paid-store", "data"),
    Input("set-lang-disable", "value"),
    Input("set-lang-second", "value"),
    Input("set-msg", "children"),   # recompute after a Save (config just changed)
)
def _compute_guard(app_name, currency, monthly, months, accounts, privacy_auto,
                   privacy_seconds, tax_inc, tax_paid, lang_disable, lang_second,
                   _saved):
    """Diff the live form against saved config → change lines for the leave guard."""
    general = get_config().get("settings", {}).get("general", {})
    ef, pc, tc, lc = (emergency_fund_config(), privacy_config(),
                      tax_config(), language_config())
    saved = {
        "app_name": general.get("app_name", "Money Tracker"),
        "base_currency": general.get("base_currency", "THB"),
        "monthly": float(ef["monthly_required"]),
        "months": int(ef["target_months"]),
        "accounts": ef["savings_accounts"],
        "privacy_auto": bool(pc["auto_enabled"]),
        "privacy_seconds": int(pc["idle_seconds"]),
        "income_sels": list(tc["income_selections"]),
        "paid_sels": list(tc["paid_selections"]),
        "lang_disabled": bool(lc["toggle_disabled"]),
        "lang_second": lc["second_language"],
    }
    # Normalise the live inputs exactly as _save persists them, so a round-tripped
    # value never reads as a spurious change.
    cur_accounts = list(dict.fromkeys(
        a.strip() for a in (accounts or []) if a and a.strip())) or ["Savings"]
    current = {
        "app_name": (app_name or "Money Tracker").strip(),
        "base_currency": (currency or "THB").strip(),
        "monthly": float(monthly or 0),
        "months": int(months or 1),
        "accounts": cur_accounts,
        "privacy_auto": bool(privacy_auto),
        "privacy_seconds": max(1, int(privacy_seconds or 10)),
        # Normalise like tax_config() reads back: income empty ⇒ [] (all income);
        # tax-payment empty ⇒ the resolved "Tax" default, so a round-trip never reads
        # as dirty.
        "income_sels": list(dict.fromkeys(
            c for c in (tax_inc or []) if c and str(c).strip())),
        "paid_sels": (list(dict.fromkeys(
            s for s in (tax_paid or []) if s and str(s).strip()))
            or [_resolve_paid_sub("Tax")]),
        "lang_disabled": bool(lang_disable),
        "lang_second": (lang_second or "th"),
    }
    return {
        "lines": _settings_changes(saved, current),
        "intro": t("You have unsaved changes:"),
        "outro": t("Leave without saving?"),
    }


# Mirror the change summary to the browser for the leave-page guard (settings_guard.js).
clientside_callback(
    """
    function (g) {
        var lines = (g && g.lines) || [];
        window.__settingsChanges = lines;
        window.__settingsDirty = lines.length > 0;
        window.__settingsGuardIntro = (g && g.intro) || "";
        window.__settingsGuardOutro = (g && g.outro) || "";
        return "";
    }
    """,
    Output("settings-guard-sink", "data"),
    Input("settings-guard", "data"),
)
