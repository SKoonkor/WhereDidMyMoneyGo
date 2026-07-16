"""Import wizard — bring transactions in from another app or a bank export.

Flow: upload a .csv/.xlsx → a preset or saved profile is auto-detected (or
columns are guessed) → adjust the column mapping → preview with validation
(bad rows, unknown accounts with create-or-map choices, duplicate flags) →
import with an automatic backup and one-click undo. Mappings can be saved as
reusable profiles (config/import_profiles/).

All parsing logic lives in src/io/importer.py; this page only wires it to UI.
"""

import base64
from datetime import datetime

import dash
import pandas as pd
from dash import (ALL, dcc, html, callback, ctx, Input, Output, State,
                  no_update)
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card, money_span
from src.app.i18n import make_t
from src.app.data import get_df, refresh, account_names
from src.analytics.accounts import add_account
from src.analytics.transaction_categories import (load_categories,
                                                  add_category,
                                                  add_subcategory)
from src.io import importer, store

t = make_t("import")

dash.register_page(__name__, path="/import", name="Import Data")

_GUESS = "__guess__"
_CREATE = "__create__"
_MUTED = {"color": theme.MUTED, "fontSize": "13px"}
_SECTION_TITLE = {"fontSize": "16px", "fontWeight": "600", "margin": "0 0 8px"}
_HIDDEN = {"display": "none"}

def _date_format_options():
    return [
        {"label": t("Auto-detect"), "value": "auto"},
        {"label": "DD/MM/YYYY " + t("(day first)"), "value": "dmy"},
        {"label": "MM/DD/YYYY " + t("(month first)"), "value": "mdy"},
        {"label": "YYYY/MM/DD " + t("(year first)"), "value": "ymd"},
        {"label": "YYYY/DD/MM", "value": "ydm"},
    ]


def _decimal_format_options():
    return [
        {"label": "1,234.56  " + t("(dot decimal)"), "value": "dot"},
        {"label": "1.234,56  " + t("(comma decimal)"), "value": "comma"},
    ]


def _profile_formats(profile: dict) -> tuple[str, str]:
    """Resolve a profile's date_order / decimal, honouring legacy option keys."""
    opts = profile.get("options", {})
    date_order = opts.get("date_order") or ("dmy" if opts.get("dayfirst") else "auto")
    decimal = opts.get("decimal") or ("comma" if opts.get("decimal_comma") else "dot")
    return date_order, decimal


def _last_import_hint():
    """Muted line describing the most recent import (for the replace toggle)."""
    m = importer.load_last_import()
    if not m:
        return t("No previous import on record yet.")
    return t("Last import: {filename} · {count} row(s) — ticking the box below "
             "will remove these before importing.").format(
        filename=m.get('filename', '—'), count=m.get('count', 0))


def layout(**_):
    return html.Div(
        [
            page_header("Import Data",
                        "Bring transactions in from another app or a bank export.",
                        back=("Settings", "/settings")),
            dcc.Store(id="imp-file-store"),
            dcc.Store(id="imp-backup-store"),

            # ── step 1: upload ───────────────────────────────────────────
            card([
                html.Div(t("1 · Choose a file"), style=_SECTION_TITLE),
                dcc.Upload(
                    id="imp-upload",
                    children=html.Div([t("Drag & drop or "),
                                       html.A(t("select a .csv / .xlsx file"))]),
                    style={"border": f"1px dashed {theme.MUTED}",
                           "borderRadius": "8px", "padding": "28px",
                           "textAlign": "center", "cursor": "pointer"},
                    multiple=False,
                ),
                html.Div(id="imp-file-info", style={"marginTop": "10px",
                                                    **_MUTED}),
                html.Div(id="imp-head-preview", style={"marginTop": "10px"}),
            ], style={"marginBottom": "16px"}),

            # ── step 2: mapping ──────────────────────────────────────────
            html.Div(
                card([
                    html.Div(t("2 · Map columns"), style=_SECTION_TITLE),
                    html.Div([
                        html.Span(t("Source preset: "), style=_MUTED),
                        dcc.Dropdown(id="imp-profile", clearable=False,
                                     style={"width": "280px",
                                            "display": "inline-block",
                                            "verticalAlign": "middle"}),
                    ], style={"marginBottom": "12px"}),
                    html.Div(
                        [html.Div(
                            [html.Label(t(f), style=_MUTED),
                             dcc.Dropdown(id={"role": "imp-map", "field": f},
                                          placeholder="—", clearable=True)],
                            style={"width": "190px"})
                         for f in importer.TARGET_FIELDS],
                        style={"display": "flex", "flexWrap": "wrap",
                               "gap": "10px"},
                    ),
                    html.Hr(style={"border": "none",
                                   "borderTop": "1px solid var(--border)",
                                   "margin": "16px 0"}),
                    # Parsing hints for the Date and Amount columns, laid out like
                    # the column-mapping items above.
                    html.Div(
                        [
                            html.Div(
                                [html.Label(t("Date format"), style=_MUTED),
                                 dcc.Dropdown(id="imp-date-format", clearable=False,
                                              options=_date_format_options(),
                                              value="auto")],
                                style={"width": "240px"}),
                            html.Div(
                                [html.Label(t("Decimal format"), style=_MUTED),
                                 dcc.Dropdown(id="imp-decimal-format", clearable=False,
                                              options=_decimal_format_options(),
                                              value="dot")],
                                style={"width": "240px"}),
                        ],
                        style={"display": "flex", "flexWrap": "wrap", "gap": "10px"},
                    ),
                    html.Div([
                        html.Button(t("Preview import"), id="imp-preview-btn",
                                    n_clicks=0, style=theme.BUTTON_STYLE),
                    ], style={"marginTop": "14px"}),
                ], style={"marginBottom": "16px"}),
                id="imp-mapping-section", style={"display": "none"},
            ),

            # ── step 3: review + import ──────────────────────────────────
            html.Div(id="imp-review"),
            html.Div(_last_import_hint(), id="imp-last-info",
                     style={**_MUTED, "marginTop": "12px"}),
            dcc.Checklist(
                id="imp-replace",
                options=[{"label": t(" Replace previous import (remove the last "
                                     "imported file's transactions first)"),
                          "value": "on"}],
                value=[], style={"margin": "6px 0", **_MUTED},
            ),
            html.Div([
                html.Button(t("Import"), id="imp-import-btn", n_clicks=0,
                            disabled=True, style=theme.BUTTON_STYLE),
                html.Button(t("Undo last import"), id="imp-undo-btn", n_clicks=0,
                            style={**theme.BUTTON_STYLE, "display": "none"}),
                dcc.Link(t("Go to Transactions"), href="/transactions",
                         style={"color": theme.ACCENT, "marginLeft": "12px"}),
            ], style={"display": "flex", "alignItems": "center", "gap": "8px",
                      "margin": "16px 0"}),
            dcc.ConfirmDialog(id="imp-confirm"),
            html.Div(id="imp-result"),

            # ── save the current mapping as a reusable profile ────────────
            # Enabled only after a successful import (see _import_or_undo).
            html.Div(
                [
                    html.Button(t("Save as profile"), id="imp-save-btn", n_clicks=0,
                                disabled=True, style=theme.BUTTON_STYLE),
                    html.Span(id="imp-save-msg",
                              style={"marginLeft": "10px", **_MUTED}),
                ],
                style={"margin": "28px 0 8px"},
            ),
            html.Div(  # name-input modal (revealed by the button above)
                html.Div(
                    [
                        html.Div(
                            [html.H3(t("Save as profile"),
                                     style={"flex": "1", "marginTop": 0}),
                             html.Button("✕", id="imp-save-cancel", n_clicks=0,
                                         className="theme-toggle")],
                            style={"display": "flex", "alignItems": "center",
                                   "gap": "10px"},
                        ),
                        html.Div(t("Name this column mapping so you can reuse it on "
                                   "a future import."),
                                 style={**_MUTED, "margin": "4px 0 10px"}),
                        dcc.Input(id="imp-save-name", type="text",
                                  placeholder=t("Profile name…"),
                                  style={**theme.INPUT_STYLE, "marginBottom": 0}),
                        html.Div(id="imp-save-modal-msg",
                                 style={"color": theme.EXPENSE_COLOR,
                                        "fontSize": "13px", "marginTop": "6px",
                                        "minHeight": "16px"}),
                        html.Div(
                            [html.Button(t("Save"), id="imp-save-modal-save",
                                         n_clicks=0, style=theme.BUTTON_STYLE)],
                            style={"display": "flex", "justifyContent": "flex-end",
                                   "marginTop": "14px"},
                        ),
                    ],
                    className="modal-card",
                ),
                id="imp-save-modal", className="modal-overlay", style=_HIDDEN,
            ),
            dcc.ConfirmDialog(id="imp-save-confirm"),
        ],
        style=theme.PAGE_STYLE,
    )


# ── helpers ──────────────────────────────────────────────────────────────────

def _decode(contents: str) -> bytes:
    return base64.b64decode(contents.split(",", 1)[1])


def _profile_options():
    opts = [{"label": t("Auto-detect / manual"), "value": _GUESS}]
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


def _build_profile(mapping_states, date_order, decimal) -> dict:
    columns = {s["id"]["field"]: s.get("value") for s in mapping_states}
    return {"name": "", "columns": columns,
            "options": {"date_order": date_order or "auto",
                        "decimal": decimal or "dot"}}


def _parse_upload(file_data, mapping_states, date_order, decimal, ledger=None) -> dict:
    raw = importer.read_table(file_data["filename"],
                              _decode(file_data["contents"]))
    profile = _build_profile(mapping_states, date_order, decimal)
    result = importer.parse_rows(raw, profile)
    importer.mark_duplicates(result["rows"],
                             get_df() if ledger is None else ledger)
    return result


def _dedupe_ledger(replace_val):
    """Ledger to dedupe against. When 'Replace previous import' is on, exclude
    the last import's rows so the new file isn't flagged against a batch we're
    about to delete. Returns (ledger_frame, manifest, replace_on)."""
    manifest = importer.load_last_import()
    replace_on = "on" in (replace_val or [])
    ledger = get_df()
    if replace_on and manifest and manifest.get("row_ids"):
        ledger = ledger[~ledger["Id"].isin(manifest["row_ids"])]
    return ledger, manifest, replace_on


def _known_categories() -> set[str]:
    cats = load_categories()
    return set(cats.get("income", {})) | set(cats.get("expense", {}))


_HEAD_ROWS = 5


def _head_cell(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    s = str(v)
    return s[:60] + "…" if len(s) > 60 else s


def _head_preview(raw: pd.DataFrame):
    """Read-only peek at the uploaded file — header + first rows, verbatim —
    so the user can judge the column mapping against real values."""
    head = raw.head(_HEAD_ROWS)
    cell_style = {"textAlign": "left", "padding": "2px 12px 2px 0",
                  "whiteSpace": "nowrap"}
    table = html.Table(
        [html.Thead(html.Tr([
            html.Th(str(c), style={**cell_style,
                                   "borderBottom": "1px solid var(--border)"})
            for c in raw.columns]))] +
        [html.Tbody([html.Tr([html.Td(_head_cell(v), style=cell_style)
                              for v in row])
                     for row in head.itertuples(index=False, name=None)])],
        style={"fontSize": "13px"})
    return html.Div([
        html.Div(t("File contents (first {n} rows, read-only):").format(
                     n=_HEAD_ROWS), style=_MUTED),
        html.Div(table, style={"overflowX": "auto", "marginTop": "6px"}),
    ])


# ── callbacks ────────────────────────────────────────────────────────────────

@callback(
    Output("imp-file-store", "data"),
    Output("imp-file-info", "children"),
    Output("imp-head-preview", "children"),
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
        return (no_update, t("Could not read {filename}: {err}").format(
                    filename=filename, err=e),
                None, {"display": "none"}, no_update, no_update)
    headers = [str(c) for c in raw.columns]
    preset = importer.detect_preset(headers)
    info = (t("{filename} — {rows} rows, {cols} columns. ").format(
                filename=filename, rows=len(raw), cols=len(headers))
            + (t("Detected: {name}.").format(name=preset['name']) if preset
               else t("No known layout detected — check the mapping below.")))
    return ({"filename": filename, "contents": contents, "headers": headers},
            info, _head_preview(raw), {"display": "block"}, _profile_options(),
            preset["name"] if preset else _GUESS)


@callback(
    Output({"role": "imp-map", "field": ALL}, "options"),
    Output({"role": "imp-map", "field": ALL}, "value"),
    Output("imp-date-format", "value"),
    Output("imp-decimal-format", "value"),
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
    date_order, decimal = _profile_formats(profile)
    return [options] * n, values, date_order, decimal


@callback(
    Output("imp-review", "children"),
    Output("imp-import-btn", "disabled"),
    Input("imp-preview-btn", "n_clicks"),
    State("imp-file-store", "data"),
    State({"role": "imp-map", "field": ALL}, "value"),
    State("imp-date-format", "value"),
    State("imp-decimal-format", "value"),
    State("imp-replace", "value"),
    prevent_initial_call=True,
)
def _preview(n_clicks, file_data, _mapping_values, date_order, decimal, replace_val):
    if not n_clicks or not file_data:
        raise PreventUpdate
    mapping_states = ctx.states_list[1]
    ledger, _manifest, _replace_on = _dedupe_ledger(replace_val)
    try:
        result = _parse_upload(file_data, mapping_states, date_order, decimal, ledger)
    except ValueError as e:
        return card([html.Div(str(e), style={"color": theme.EXPENSE_COLOR})]), True

    rows = result["rows"]
    unknown = importer.unknown_names(rows, account_names(), _known_categories())
    exact = sum(1 for r in rows if r["_dup"] == "exact")
    suspects = [r for r in rows if r["_dup"] == "suspect"]
    importable = len(rows) - exact

    children = [html.Div(t("3 · Review"), style=_SECTION_TITLE)]

    summary = [html.Li(
        t("{importable} transaction(s) ready to import "
          "({parsed} parsed, {exact} already imported — skipped").format(
              importable=importable, parsed=len(rows), exact=exact)
        + (t(", {n} possible duplicate(s) — see below").format(n=len(suspects))
           if suspects else "") + ")")]
    for reason, cnt in result["issues"].items():
        summary.append(html.Li(t("{n} row(s) skipped: {reason}").format(
                                   n=cnt, reason=reason),
                               style={"color": theme.EXPENSE_COLOR}))
    if unknown["categories"]:
        summary.append(html.Li(
            t("New categories will be created: ")
            + ", ".join(unknown["categories"][:12])
            + ("…" if len(unknown["categories"]) > 12 else "")))
    children.append(html.Ul(summary, style={"margin": "0 0 12px 18px"}))

    if unknown["accounts"]:
        children.append(html.Div(t("Unknown accounts — create them or map to an "
                                   "existing account:"), style=_MUTED))
        children.append(html.Div(
            [html.Div(
                [html.Label(name, style={"fontWeight": "600"}),
                 dcc.Dropdown(
                     id={"role": "imp-acct-map", "name": name},
                     options=([{"label": t("➕ Create “{name}”").format(name=name),
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
            t("{n} possible duplicate(s) — same day, amount, account, and type "
              "as an existing entry. Tick any you still want to import:").format(
                  n=len(suspects)), style=_MUTED))
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
        [html.Thead(html.Tr([html.Th(t(h), style={"textAlign": "left",
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
        children.append(html.Div(t("… and {n} more.").format(
                                     n=len(rows) - len(sample)), style=_MUTED))

    return card(children), importable == 0


@callback(
    Output("imp-confirm", "message"),
    Output("imp-confirm", "displayed"),
    Input("imp-import-btn", "n_clicks"),
    State("imp-file-store", "data"),
    State({"role": "imp-map", "field": ALL}, "value"),
    State("imp-date-format", "value"),
    State("imp-decimal-format", "value"),
    State("imp-suspects", "value"),
    State("imp-replace", "value"),
    prevent_initial_call=True,
)
def _confirm_import(n_clicks, file_data, _mapping_values, date_order, decimal,
                    suspect_sel, replace_val):
    """Guardrail: clicking Import opens a summary dialog; the actual write only
    happens if the user confirms (see _import_or_undo)."""
    if not n_clicks or not file_data:
        raise PreventUpdate
    mapping_states = ctx.states_list[1]
    ledger, manifest, replace_on = _dedupe_ledger(replace_val)
    try:
        result = _parse_upload(file_data, mapping_states, date_order, decimal, ledger)
    except ValueError as e:
        return t("Cannot import: {err}").format(err=e), True
    keep = set(suspect_sel or [])
    accepted = [r for r in result["rows"]
                if r["_dup"] != "exact"
                and (r["_dup"] != "suspect" or r["_source_row"] in keep)]
    n = len(accepted)
    skipped = len(result["rows"]) - n
    fname = file_data.get("filename", "the file")
    del_n = manifest.get("count", 0) if (replace_on and manifest) else 0

    lines = []
    if del_n:
        lines.append(t("⚠ REPLACE MODE: {n} transaction(s) from the previous "
                       "import (\"{filename}\") will be DELETED first.").format(
                           n=del_n, filename=manifest.get('filename', '?')))
    lines.append(t("{n} transaction(s) will be imported from \"{filename}\".").format(
        n=n, filename=fname))
    if skipped:
        lines.append(t("{n} row(s) will be skipped (duplicates / unticked).").format(
            n=skipped))
    lines.append("")
    lines.append(t("A backup is saved before any change. Continue?"))
    return "\n".join(lines), True


@callback(
    Output("imp-result", "children"),
    Output("imp-backup-store", "data"),
    Output("imp-undo-btn", "style"),
    Output("imp-import-btn", "disabled", allow_duplicate=True),
    Output("imp-last-info", "children"),
    Output("imp-save-btn", "disabled", allow_duplicate=True),
    Input("imp-confirm", "submit_n_clicks"),
    Input("imp-undo-btn", "n_clicks"),
    State("imp-file-store", "data"),
    State({"role": "imp-map", "field": ALL}, "value"),
    State("imp-date-format", "value"),
    State("imp-decimal-format", "value"),
    State({"role": "imp-acct-map", "name": ALL}, "value"),
    State("imp-suspects", "value"),
    State("imp-backup-store", "data"),
    State("imp-replace", "value"),
    prevent_initial_call=True,
)
def _import_or_undo(_submit, _undo, file_data, _mapping_values, date_order, decimal,
                    _acct_values, suspect_sel, backup_path, replace_val):
    hidden = {**theme.BUTTON_STYLE, "display": "none"}
    shown = theme.BUTTON_STYLE

    if ctx.triggered_id == "imp-undo-btn":
        if not ctx.triggered[0]["value"] or not backup_path:
            raise PreventUpdate
        store.restore_backup(backup_path)
        importer.clear_last_import()  # restored ledger predates this import
        refresh()
        # Undo reverts the import, so re-lock "Save as profile".
        return (html.Div(t("Import undone — the ledger was restored."),
                         style={"color": theme.ACCENT}),
                None, hidden, False, _last_import_hint(), True)

    if not ctx.triggered[0]["value"] or not file_data:
        raise PreventUpdate

    mapping_states = ctx.states_list[1]
    ledger, manifest, replace_on = _dedupe_ledger(replace_val)
    result = _parse_upload(file_data, mapping_states, date_order, decimal, ledger)
    keep_suspects = set(suspect_sel or [])
    accepted = [r for r in result["rows"]
                if r["_dup"] != "exact"
                and (r["_dup"] != "suspect" or r["_source_row"] in keep_suspects)]
    if not accepted:
        return (html.Div(t("Nothing to import."), style=_MUTED),
                no_update, no_update, True, no_update, no_update)

    # account choices: create new ones, or rename onto existing accounts
    account_map = {}
    for s in ctx.states_list[4]:
        name, choice = s["id"]["name"], s.get("value") or _CREATE
        if choice == _CREATE:
            add_account(name)
        else:
            account_map[name] = choice

    replace_ids = (manifest["row_ids"]
                   if replace_on and manifest and manifest.get("row_ids")
                   else None)
    # Archive the raw uploaded file next to the ledger backups before touching
    # anything, so the source of every import is retained.
    archived = importer.archive_upload(file_data["filename"],
                                       _decode(file_data["contents"]))
    n, backup, new_ids = importer.commit_rows(accepted, account_map, replace_ids)

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

    # Record this import as the new "last import" batch.
    importer.save_last_import({
        "imported_at": datetime.now().isoformat(timespec="seconds"),
        "filename": file_data["filename"],
        "archived_file": str(archived),
        "row_ids": new_ids,
        "count": n,
    })
    refresh()
    skipped = len(result["rows"]) - len(accepted)
    replaced_txt = (t(" Previous import ({n} row(s)) removed.").format(
                        n=manifest['count']) if replace_ids else "")
    return (html.Div([
                html.Div(t("Imported {n} transaction(s)").format(n=n)
                         + (t(" — {n} duplicate(s) skipped.").format(n=skipped)
                            if skipped else ".") + replaced_txt,
                         style={"color": theme.ACCENT}),
                html.Div(t("A backup was taken first (Undo restores the pre-import "
                           "ledger); the uploaded file was archived under "
                           "data/backups/."), style=_MUTED),
            ]),
            str(backup) if backup else None,
            shown if backup else hidden,
            True,
            _last_import_hint(),
            False)  # a successful import unlocks "Save as profile"


# ── save the current mapping as a reusable profile ───────────────────────────

@callback(
    Output("imp-save-modal", "style"),
    Output("imp-save-name", "value"),
    Output("imp-save-modal-msg", "children"),
    Input("imp-save-btn", "n_clicks"),
    prevent_initial_call=True,
)
def _open_save_modal(n):
    if not n:
        raise PreventUpdate
    return {}, "", ""   # {} lets the .modal-overlay CSS (display:flex) show it


@callback(
    Output("imp-save-modal", "style", allow_duplicate=True),
    Input("imp-save-cancel", "n_clicks"),
    prevent_initial_call=True,
)
def _close_save_modal(n):
    if not n:
        raise PreventUpdate
    return _HIDDEN


@callback(
    Output("imp-save-confirm", "message"),
    Output("imp-save-confirm", "displayed"),
    Output("imp-save-modal-msg", "children", allow_duplicate=True),
    Input("imp-save-modal-save", "n_clicks"),
    State("imp-save-name", "value"),
    prevent_initial_call=True,
)
def _confirm_save(n, name):
    # Naming then Save raises a final "are you sure" before writing to disk.
    if not n:
        raise PreventUpdate
    if not (name or "").strip():
        return "", False, t("Give the profile a name first.")
    return t('Save this column mapping as profile "{name}"?').format(
        name=name.strip()), True, ""


@callback(
    Output("imp-save-modal", "style", allow_duplicate=True),
    Output("imp-save-msg", "children"),
    Output("imp-profile", "options", allow_duplicate=True),
    Input("imp-save-confirm", "submit_n_clicks"),
    State("imp-save-name", "value"),
    State({"role": "imp-map", "field": ALL}, "value"),
    State("imp-date-format", "value"),
    State("imp-decimal-format", "value"),
    prevent_initial_call=True,
)
def _write_profile(submit_n, name, _mapping_values, date_order, decimal):
    if not submit_n or not (name or "").strip():
        raise PreventUpdate
    mapping_states = ctx.states_list[1]
    profile = _build_profile(mapping_states, date_order, decimal)
    profile["name"] = name.strip()
    path = importer.save_profile(profile)
    return (_HIDDEN,
            t('Saved profile "{name}" → {file}').format(
                name=name.strip(), file=path.name),
            _profile_options())
