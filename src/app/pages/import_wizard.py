"""Import wizard — bring transactions in from another app or a bank export.

Flow: upload a .csv/.xlsx → a preset or saved profile is auto-detected (or
columns are guessed) → adjust the column mapping → preview with validation
(bad rows, unknown accounts with create-or-map choices, duplicate flags) →
import with an automatic backup and one-click undo. Mappings can be saved as
reusable profiles (config/import_profiles/).

All parsing logic lives in src/io/importer.py; this page only wires it to UI.
"""

import base64

import dash
import pandas as pd
from dash import (ALL, dcc, html, callback, ctx, Input, Output, State,
                  no_update)
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card, money_span
from src.app.data import get_df, refresh, account_names
from src.analytics.accounts import add_account
from src.analytics.transaction_categories import (load_categories,
                                                  add_category,
                                                  add_subcategory)
from src.io import importer, store

dash.register_page(__name__, path="/import", name="Import Data")

_GUESS = "__guess__"
_CREATE = "__create__"
_MUTED = {"color": theme.MUTED, "fontSize": "13px"}
_SECTION_TITLE = {"fontSize": "16px", "fontWeight": "600", "margin": "0 0 8px"}


def layout(**_):
    return html.Div(
        [
            page_header("Import Data",
                        "Bring transactions in from another app or a bank export."),
            dcc.Store(id="imp-file-store"),
            dcc.Store(id="imp-backup-store"),

            # ── step 1: upload ───────────────────────────────────────────
            card([
                html.Div("1 · Choose a file", style=_SECTION_TITLE),
                dcc.Upload(
                    id="imp-upload",
                    children=html.Div(["Drag & drop or ",
                                       html.A("select a .csv / .xlsx file")]),
                    style={"border": f"1px dashed {theme.MUTED}",
                           "borderRadius": "8px", "padding": "28px",
                           "textAlign": "center", "cursor": "pointer"},
                    multiple=False,
                ),
                html.Div(id="imp-file-info", style={"marginTop": "10px",
                                                    **_MUTED}),
            ], style={"marginBottom": "16px"}),

            # ── step 2: mapping ──────────────────────────────────────────
            html.Div(
                card([
                    html.Div("2 · Map columns", style=_SECTION_TITLE),
                    html.Div([
                        html.Span("Source preset: ", style=_MUTED),
                        dcc.Dropdown(id="imp-profile", clearable=False,
                                     style={"width": "280px",
                                            "display": "inline-block",
                                            "verticalAlign": "middle"}),
                    ], style={"marginBottom": "12px"}),
                    html.Div(
                        [html.Div(
                            [html.Label(f, style=_MUTED),
                             dcc.Dropdown(id={"role": "imp-map", "field": f},
                                          placeholder="—", clearable=True)],
                            style={"width": "190px"})
                         for f in importer.TARGET_FIELDS],
                        style={"display": "flex", "flexWrap": "wrap",
                               "gap": "10px"},
                    ),
                    dcc.Checklist(
                        id="imp-options",
                        options=[
                            {"label": " Day-first dates (31/12/2026)",
                             "value": "dayfirst"},
                            {"label": " European decimals (1.234,56)",
                             "value": "decimal_comma"},
                        ],
                        value=[], style={"marginTop": "10px", **_MUTED},
                    ),
                    html.Div([
                        html.Button("Preview import", id="imp-preview-btn",
                                    n_clicks=0, style=theme.BUTTON_STYLE),
                        dcc.Input(id="imp-save-name", type="text",
                                  placeholder="Profile name…", debounce=True,
                                  style={"marginLeft": "24px"}),
                        html.Button("Save as profile", id="imp-save-btn",
                                    n_clicks=0, style=theme.BUTTON_STYLE),
                        html.Span(id="imp-save-msg", style={"marginLeft": "8px",
                                                            **_MUTED}),
                    ], style={"marginTop": "14px", "display": "flex",
                              "alignItems": "center", "gap": "8px"}),
                ], style={"marginBottom": "16px"}),
                id="imp-mapping-section", style={"display": "none"},
            ),

            # ── step 3: review + import ──────────────────────────────────
            html.Div(id="imp-review"),
            html.Div([
                html.Button("Import", id="imp-import-btn", n_clicks=0,
                            disabled=True, style=theme.BUTTON_STYLE),
                html.Button("Undo last import", id="imp-undo-btn", n_clicks=0,
                            style={**theme.BUTTON_STYLE, "display": "none"}),
                dcc.Link("Go to Transactions", href="/transactions",
                         style={"color": theme.ACCENT, "marginLeft": "12px"}),
            ], style={"display": "flex", "alignItems": "center", "gap": "8px",
                      "margin": "16px 0"}),
            html.Div(id="imp-result"),
        ],
        style=theme.PAGE_STYLE,
    )


# ── helpers ──────────────────────────────────────────────────────────────────

def _decode(contents: str) -> bytes:
    return base64.b64decode(contents.split(",", 1)[1])


def _profile_options():
    opts = [{"label": "Auto-detect / manual", "value": _GUESS}]
    opts += [{"label": p["name"], "value": p["name"]} for p in importer.PRESETS]
    opts += [{"label": f"★ {p['name']}", "value": p["name"]}
             for p in importer.load_profiles()]
    return opts


def _resolve_profile(name: str, headers: list[str]) -> dict:
    if name and name != _GUESS:
        for p in importer.PRESETS:
            if p["name"] == name:
                return {k: p[k] for k in ("name", "columns", "options")}
        for p in importer.load_profiles():
            if p["name"] == name:
                return p
    return importer.guess_mapping(headers)


def _build_profile(mapping_states, options) -> dict:
    columns = {s["id"]["field"]: s.get("value") for s in mapping_states}
    return {"name": "", "columns": columns,
            "options": {"dayfirst": "dayfirst" in (options or []),
                        "decimal_comma": "decimal_comma" in (options or [])}}


def _parse_upload(file_data, mapping_states, options) -> dict:
    raw = importer.read_table(file_data["filename"],
                              _decode(file_data["contents"]))
    profile = _build_profile(mapping_states, options)
    result = importer.parse_rows(raw, profile)
    importer.mark_duplicates(result["rows"], get_df())
    return result


def _known_categories() -> set[str]:
    cats = load_categories()
    return set(cats.get("income", {})) | set(cats.get("expense", {}))


# ── callbacks ────────────────────────────────────────────────────────────────

@callback(
    Output("imp-file-store", "data"),
    Output("imp-file-info", "children"),
    Output("imp-mapping-section", "style"),
    Output("imp-profile", "options"),
    Output("imp-profile", "value"),
    Input("imp-upload", "contents"),
    State("imp-upload", "filename"),
    prevent_initial_call=True,
)
def _on_upload(contents, filename):
    if not contents:
        raise PreventUpdate
    try:
        raw = importer.read_table(filename, _decode(contents))
    except Exception as e:  # unreadable file — tell the user, keep going
        return (no_update, f"Could not read {filename}: {e}",
                {"display": "none"}, no_update, no_update)
    headers = [str(c) for c in raw.columns]
    preset = importer.detect_preset(headers)
    info = (f"{filename} — {len(raw)} rows, {len(headers)} columns. "
            + (f"Detected: {preset['name']}." if preset
               else "No known layout detected — check the mapping below."))
    return ({"filename": filename, "contents": contents, "headers": headers},
            info, {"display": "block"}, _profile_options(),
            preset["name"] if preset else _GUESS)


@callback(
    Output({"role": "imp-map", "field": ALL}, "options"),
    Output({"role": "imp-map", "field": ALL}, "value"),
    Output("imp-options", "value"),
    Input("imp-file-store", "data"),
    Input("imp-profile", "value"),
    prevent_initial_call=True,
)
def _apply_profile(file_data, profile_name):
    if not file_data:
        raise PreventUpdate
    headers = file_data["headers"]
    profile = _resolve_profile(profile_name, headers)
    options = [{"label": h, "value": h} for h in headers]
    n = len(ctx.outputs_list[0])
    fields = [o["id"]["field"] for o in ctx.outputs_list[0]]
    values = [profile["columns"].get(f) for f in fields]
    # drop mapped columns that don't exist in this file
    values = [v if v in headers else None for v in values]
    opts = profile.get("options", {})
    checked = [k for k in ("dayfirst", "decimal_comma") if opts.get(k)]
    return [options] * n, values, checked


@callback(
    Output("imp-review", "children"),
    Output("imp-import-btn", "disabled"),
    Input("imp-preview-btn", "n_clicks"),
    State("imp-file-store", "data"),
    State({"role": "imp-map", "field": ALL}, "value"),
    State("imp-options", "value"),
    prevent_initial_call=True,
)
def _preview(n_clicks, file_data, _mapping_values, options):
    if not n_clicks or not file_data:
        raise PreventUpdate
    mapping_states = ctx.states_list[1]
    try:
        result = _parse_upload(file_data, mapping_states, options)
    except ValueError as e:
        return card([html.Div(str(e), style={"color": theme.EXPENSE_COLOR})]), True

    rows = result["rows"]
    unknown = importer.unknown_names(rows, account_names(), _known_categories())
    exact = sum(1 for r in rows if r["_dup"] == "exact")
    suspects = [r for r in rows if r["_dup"] == "suspect"]
    importable = len(rows) - exact

    children = [html.Div("3 · Review", style=_SECTION_TITLE)]

    summary = [html.Li(
        f"{importable} transaction(s) ready to import "
        f"({len(rows)} parsed, {exact} already imported — skipped"
        + (f", {len(suspects)} possible duplicate(s) — see below" if suspects
           else "") + ")")]
    for reason, cnt in result["issues"].items():
        summary.append(html.Li(f"{cnt} row(s) skipped: {reason}",
                               style={"color": theme.EXPENSE_COLOR}))
    if unknown["categories"]:
        summary.append(html.Li(
            "New categories will be created: "
            + ", ".join(unknown["categories"][:12])
            + ("…" if len(unknown["categories"]) > 12 else "")))
    children.append(html.Ul(summary, style={"margin": "0 0 12px 18px"}))

    if unknown["accounts"]:
        children.append(html.Div("Unknown accounts — create them or map to an "
                                 "existing account:", style=_MUTED))
        children.append(html.Div(
            [html.Div(
                [html.Label(name, style={"fontWeight": "600"}),
                 dcc.Dropdown(
                     id={"role": "imp-acct-map", "name": name},
                     options=([{"label": f"➕ Create “{name}”",
                                "value": _CREATE}]
                              + [{"label": f"→ {a}", "value": a}
                                 for a in account_names()]),
                     value=_CREATE, clearable=False)],
                style={"width": "230px"})
             for name in unknown["accounts"]],
            style={"display": "flex", "flexWrap": "wrap", "gap": "10px",
                   "margin": "8px 0 12px"}))

    if suspects:
        children.append(html.Div(
            f"{len(suspects)} possible duplicate(s) — same day, amount, "
            "account, and type as an existing entry. Tick any you still want "
            "to import:", style=_MUTED))
        children.append(dcc.Checklist(
            id="imp-suspects",
            options=[{
                "label": f"  {r['period']:%Y-%m-%d} · {r['txn_type']} · "
                         f"{r['amount']:,.2f} · {r['account']}"
                         + (f" · {r['note']}" if r['note'] else ""),
                "value": r["_source_row"],
            } for r in suspects[:200]],
            value=[], style={"margin": "8px 0 12px"},
        ))
    else:
        # keep the id present so the import callback's State always resolves
        children.append(dcc.Checklist(id="imp-suspects", options=[], value=[],
                                      style={"display": "none"}))

    head = ["Date", "Type", "Amount", "Account", "Category", "Note"]
    sample = rows[:8]
    children.append(html.Table(
        [html.Thead(html.Tr([html.Th(h, style={"textAlign": "left",
                                               "padding": "2px 12px 2px 0"})
                             for h in head]))] +
        [html.Tbody([html.Tr([
            html.Td(f"{r['period']:%Y-%m-%d}", style={"paddingRight": "12px"}),
            html.Td(r["txn_type"], style={"paddingRight": "12px"}),
            html.Td(money_span(f"{r['amount']:,.2f}"),
                    style={"paddingRight": "12px"}),
            html.Td(r["account"], style={"paddingRight": "12px"}),
            html.Td(r["category"], style={"paddingRight": "12px"}),
            html.Td(r["note"]),
        ]) for r in sample])],
        style={"fontSize": "13px", "marginBottom": "8px"}))
    if len(rows) > len(sample):
        children.append(html.Div(f"… and {len(rows) - len(sample)} more.",
                                 style=_MUTED))

    return card(children), importable == 0


@callback(
    Output("imp-result", "children"),
    Output("imp-backup-store", "data"),
    Output("imp-undo-btn", "style"),
    Output("imp-import-btn", "disabled", allow_duplicate=True),
    Input("imp-import-btn", "n_clicks"),
    Input("imp-undo-btn", "n_clicks"),
    State("imp-file-store", "data"),
    State({"role": "imp-map", "field": ALL}, "value"),
    State("imp-options", "value"),
    State({"role": "imp-acct-map", "name": ALL}, "value"),
    State("imp-suspects", "value"),
    State("imp-backup-store", "data"),
    prevent_initial_call=True,
)
def _import_or_undo(_imp, _undo, file_data, _mapping_values, options,
                    _acct_values, suspect_sel, backup_path):
    hidden = {**theme.BUTTON_STYLE, "display": "none"}
    shown = theme.BUTTON_STYLE

    if ctx.triggered_id == "imp-undo-btn":
        if not ctx.triggered[0]["value"] or not backup_path:
            raise PreventUpdate
        store.restore_backup(backup_path)
        refresh()
        return (html.Div("Import undone — the ledger was restored.",
                         style={"color": theme.ACCENT}),
                None, hidden, False)

    if not ctx.triggered[0]["value"] or not file_data:
        raise PreventUpdate

    mapping_states = ctx.states_list[1]
    result = _parse_upload(file_data, mapping_states, options)
    keep_suspects = set(suspect_sel or [])
    accepted = [r for r in result["rows"]
                if r["_dup"] != "exact"
                and (r["_dup"] != "suspect" or r["_source_row"] in keep_suspects)]
    if not accepted:
        return (html.Div("Nothing to import.", style=_MUTED),
                no_update, no_update, True)

    # account choices: create new ones, or rename onto existing accounts
    account_map = {}
    for s in ctx.states_list[3]:
        name, choice = s["id"]["name"], s.get("value") or _CREATE
        if choice == _CREATE:
            add_account(name)
        else:
            account_map[name] = choice

    n, backup = importer.commit_rows(accepted, account_map)

    # make sure imported categories exist in the picker tree
    seen = set()
    for r in accepted:
        kind = {"Income": "income", "Expense": "expense"}.get(r["txn_type"])
        cat = r["category"]
        if not kind or not cat or (kind, cat, r["subcategory"]) in seen:
            continue
        seen.add((kind, cat, r["subcategory"]))
        add_category(kind, cat)
        if r["subcategory"]:
            add_subcategory(kind, cat, r["subcategory"])

    refresh()
    skipped = len(result["rows"]) - len(accepted)
    return (html.Div([
                html.Div(f"Imported {n} transaction(s)"
                         + (f" — {skipped} duplicate(s) skipped." if skipped
                            else "."),
                         style={"color": theme.ACCENT}),
                html.Div("A backup was taken first; Undo restores the ledger "
                         "to the moment before this import.", style=_MUTED),
            ]),
            str(backup) if backup else None,
            shown if backup else hidden,
            True)


@callback(
    Output("imp-save-msg", "children"),
    Input("imp-save-btn", "n_clicks"),
    State("imp-save-name", "value"),
    State({"role": "imp-map", "field": ALL}, "value"),
    State("imp-options", "value"),
    prevent_initial_call=True,
)
def _save(n_clicks, name, _mapping_values, options):
    if not n_clicks:
        raise PreventUpdate
    if not (name or "").strip():
        return "Give the profile a name first."
    profile = _build_profile(ctx.states_list[1], options)
    profile["name"] = name.strip()
    path = importer.save_profile(profile)
    return f"Saved → {path.name}"
