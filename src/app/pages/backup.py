"""Backup & Restore — one-click full backup, restore from file, and a
browser for the automatic per-write ledger backups.

The heavy lifting lives in src/io/backup.py (zip create/inspect/staged
restore) and src/io/store.py (ledger-file restore).
"""

import base64
from pathlib import Path

import dash
from dash import ALL, dcc, html, callback, ctx, Input, Output, State, no_update
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card
from src.app.i18n import make_t
from src.app.data import get_config, refresh
from src.io import backup, store

t = make_t("backup")

dash.register_page(__name__, path="/backup", name="Backup & Restore")

_MUTED = {"color": theme.MUTED, "fontSize": "13px"}
_SECTION_TITLE = {"fontSize": "16px", "fontWeight": "600", "margin": "0 0 8px"}
_OK = {"color": theme.ACCENT}
_ERR = {"color": theme.EXPENSE_COLOR}


def _fmt_size(n: int) -> str:
    return f"{n / 1024:,.0f} KB" if n < 1024 ** 2 else f"{n / 1024 ** 2:,.1f} MB"


def _auto_backup_table():
    items = backup.list_auto_backups()
    if not items:
        return html.Div(t("No automatic backups yet — they appear after your "
                          "first change to the ledger."), style=_MUTED)
    header = html.Tr([html.Th(t(h) if h else "", style={"textAlign": "left",
                                        "padding": "2px 14px 6px 0"})
                      for h in ("When", "What", "File", "Size", "")])
    body = []
    for it in items:
        action = (html.Button(t("Restore…"),
                              id={"role": "bak-ledger", "file": it["name"]},
                              n_clicks=0, style=theme.BUTTON_STYLE)
                  if it["restorable"] else "")
        body.append(html.Tr([
            html.Td(it["mtime"].strftime("%Y-%m-%d %H:%M"),
                    style={"paddingRight": "14px", "whiteSpace": "nowrap"}),
            html.Td(t(it["kind"]), style={"paddingRight": "14px"}),
            html.Td(html.Code(it["name"]), style={"paddingRight": "14px"}),
            html.Td(_fmt_size(it["size"]), style={"paddingRight": "14px"}),
            html.Td(action),
        ]))
    return html.Table([html.Thead(header), html.Tbody(body)],
                      style={"fontSize": "13px", "width": "100%"})


def layout(**_):
    return html.Div(
        [
            page_header("Backup & Restore",
                        "Everything personal in one file: your ledger and all settings."),
            dcc.Store(id="bak-pending-ledger"),

            card([
                html.Div(t("Download a full backup"), style=_SECTION_TITLE),
                html.P(["One zip of ", html.Code("config/"), " (settings, accounts, "
                        "categories, goals, budget, paper-trading accounts, import "
                        "profiles) and ", html.Code("data/raw/"), " (the transaction "
                        "ledger). Market caches are left out — they rebuild "
                        "themselves."], style=_MUTED),
                html.Button(t("⬇ Download backup"), id="bak-download-btn", n_clicks=0,
                            style=theme.BUTTON_STYLE),
                dcc.Download(id="bak-download"),
            ], style={"marginBottom": "16px"}),

            card([
                html.Div(t("Restore from a backup file"), style=_SECTION_TITLE),
                dcc.Upload(
                    id="bak-upload",
                    children=html.Div([t("Drag & drop or "),
                                       html.A(t("select a backup .zip"))]),
                    style={"border": f"1px dashed {theme.MUTED}",
                           "borderRadius": "8px", "padding": "22px",
                           "textAlign": "center", "cursor": "pointer"},
                    multiple=False,
                ),
                html.Div(id="bak-upload-summary", style={"marginTop": "10px"}),
                html.Button(t("Restore this backup"), id="bak-restore-btn",
                            n_clicks=0,
                            style={**theme.BUTTON_STYLE, "display": "none"}),
                html.Div(id="bak-restore-result", style={"marginTop": "10px"}),
            ], style={"marginBottom": "16px"}),

            card([
                html.Div(t("Automatic backups"), style=_SECTION_TITLE),
                html.P(t("The app snapshots the ledger before every change (20 "
                         "kept) and the whole state before every restore. Restoring "
                         "a ledger snapshot only replaces transactions — settings "
                         "stay as they are."), style=_MUTED),
                html.Div(_auto_backup_table(), id="bak-table"),
                html.Div([
                    html.Span(id="bak-confirm-label",
                              style={"marginRight": "8px", **_MUTED}),
                    html.Button(t("Confirm restore"), id="bak-ledger-confirm",
                                n_clicks=0, style=theme.BUTTON_STYLE),
                    html.Button(t("Cancel"), id="bak-ledger-cancel", n_clicks=0,
                                style=theme.BUTTON_STYLE),
                ], id="bak-confirm-bar",
                    style={"display": "none"}),
                html.Div(id="bak-ledger-result", style={"marginTop": "10px"}),
            ]),
        ],
        style=theme.PAGE_STYLE,
    )


# ── download ─────────────────────────────────────────────────────────────────

@callback(
    Output("bak-download", "data"),
    Input("bak-download-btn", "n_clicks"),
    prevent_initial_call=True,
)
def _download(n_clicks):
    if not n_clicks:
        raise PreventUpdate
    content, filename = backup.create_backup_bytes()
    return dcc.send_bytes(content, filename)


# ── restore from uploaded zip ────────────────────────────────────────────────

@callback(
    Output("bak-upload-summary", "children"),
    Output("bak-restore-btn", "style"),
    Input("bak-upload", "contents"),
    State("bak-upload", "filename"),
    prevent_initial_call=True,
)
def _on_upload(contents, filename):
    if not contents:
        raise PreventUpdate
    info = backup.inspect_backup(base64.b64decode(contents.split(",", 1)[1]))
    if not info["ok"]:
        return html.Div(f"{filename}: {info['error']}", style=_ERR), \
            {**theme.BUTTON_STYLE, "display": "none"}
    created = (info["manifest"] or {}).get("created", t("unknown date"))
    parts = [t("{filename} — valid backup ({n} files, created {created}).").format(
        filename=filename, n=info['files'], created=created)]
    parts.append(t("Contains: {items}.").format(items=" + ".join(filter(None, [
        t("the ledger") if info["has_ledger"] else None,
        t("settings/config") if info["has_config"] else None]))))
    parts.append(t("Restoring REPLACES your current data — a snapshot of the "
                   "current state is saved to data/backups/ first."))
    return html.Div([html.Div(p, style=_MUTED if i else None)
                     for i, p in enumerate(parts)]), theme.BUTTON_STYLE


@callback(
    Output("bak-restore-result", "children"),
    Output("bak-restore-btn", "style", allow_duplicate=True),
    Output("bak-table", "children", allow_duplicate=True),
    Input("bak-restore-btn", "n_clicks"),
    State("bak-upload", "contents"),
    prevent_initial_call=True,
)
def _restore_zip(n_clicks, contents):
    if not n_clicks or not contents:
        raise PreventUpdate
    try:
        result = backup.restore_backup_zip(
            base64.b64decode(contents.split(",", 1)[1]))
    except Exception as e:
        return html.Div(t("Restore failed — nothing was changed: {err}").format(err=e),
                        style=_ERR), no_update, no_update
    get_config.cache_clear()
    refresh()
    return (html.Div([
                html.Div(t("Restored {items} ({n} files).").format(
                    items=', '.join(result['restored']), n=result['files']), style=_OK),
                html.Div(t("Pre-restore snapshot: {name}. If settings "
                           "changed, restart the app to apply them everywhere.").format(
                    name=Path(result['snapshot']).name),
                         style=_MUTED),
            ]),
            {**theme.BUTTON_STYLE, "display": "none"},
            _auto_backup_table())


# ── ledger-snapshot restore (two-step confirm) ──────────────────────────────

@callback(
    Output("bak-confirm-bar", "style"),
    Output("bak-confirm-label", "children"),
    Output("bak-pending-ledger", "data"),
    Input({"role": "bak-ledger", "file": ALL}, "n_clicks"),
    Input("bak-ledger-cancel", "n_clicks"),
    prevent_initial_call=True,
)
def _pick_ledger(_clicks, _cancel):
    if ctx.triggered_id == "bak-ledger-cancel" or not ctx.triggered[0]["value"]:
        return {"display": "none"}, "", None
    name = ctx.triggered_id["file"]
    return ({"display": "flex", "alignItems": "center", "gap": "8px",
             "marginTop": "10px"},
            t("Replace the current ledger with {name}?").format(name=name), name)


@callback(
    Output("bak-ledger-result", "children"),
    Output("bak-confirm-bar", "style", allow_duplicate=True),
    Output("bak-table", "children", allow_duplicate=True),
    Input("bak-ledger-confirm", "n_clicks"),
    State("bak-pending-ledger", "data"),
    prevent_initial_call=True,
)
def _restore_ledger(n_clicks, name):
    if not n_clicks or not name or "/" in name or name.startswith("."):
        raise PreventUpdate
    cfg = get_config().get("settings", {}).get("general", {})
    path = Path(cfg.get("data_dir", "data")) / "backups" / name
    try:
        store.restore_backup(path)
    except Exception as e:
        return html.Div(t("Restore failed: {err}").format(err=e), style=_ERR), \
            {"display": "none"}, no_update
    refresh()
    return (html.Div(t("Ledger restored from {name}. (The previous state was "
                       "backed up first.)").format(name=name), style=_OK),
            {"display": "none"}, _auto_backup_table())
