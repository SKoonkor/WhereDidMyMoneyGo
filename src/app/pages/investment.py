"""Investment Simulator — a turn-based stock trading study game.

Each portfolio starts at $10,000; the user steps through a chosen historical date
range one trading day at a time, buying/selling shares, and compares portfolios
against the S&P 500. Game state persists to config/investment_game.json.
"""

from __future__ import annotations

from datetime import date, timedelta

import dash
import pandas as pd
from dash import dcc, html, callback, Input, Output, State, ctx, no_update, ALL
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card
from src.app.figures.investment import (build_investment_figure, build_stock_figure,
                                         build_sector_figure, cubehelix_colors)
from src.analytics import investment as G

dash.register_page(__name__, path="/invest",
                   name="Investing Simulator (Historical Data)", order=8)

_HIDDEN = {"display": "none"}
_GRAPH_CONFIG = {"scrollZoom": True, "displaylogo": False,
                 "modeBarButtonsToRemove": ["select2d", "lasso2d"]}


def _money(v: float) -> str:
    return f"{v:,.2f}"


def _pl_class(v: float) -> str:
    return "amt-income" if v > 0 else "amt-expense" if v < 0 else ""


# ── Render helpers ────────────────────────────────────────────────────────────

def _status_text(game: dict) -> str:
    n = len(game["trading_days"])
    i = game["current_index"]
    d = G.current_date(game).strftime("%d %b %Y")
    tail = " · CLOSED" if G.is_over(game) else ""
    return f"Day {i + 1} / {n} — {d}{tail}"


def _active_options(game: dict) -> list:
    return [{"label": f"  {pf['name']}", "value": i}
            for i, pf in enumerate(game["portfolios"])]


def _holdings_table(game: dict) -> html.Div:
    h = G.holdings_rows(game, game["active"])
    header = html.Tr([html.Th("Ticker"), html.Th("Shares"), html.Th("Price"),
                      html.Th("Value")])
    rows = [html.Tr([html.Td(r["ticker"]), html.Td(f"{r['qty']:,.4f}"),
                     html.Td(_money(r["price"])), html.Td(_money(r["value"]))])
            for r in h["rows"]]
    if not rows:
        rows = [html.Tr(html.Td("No holdings yet.", colSpan=4,
                                style={"color": theme.MUTED}))]
    foot = html.Tr([html.Td("Cash", colSpan=3),
                    html.Td(_money(h["cash"]))], className="invest-foot")
    total = html.Tr([html.Td("Total value", colSpan=3),
                     html.Td(_money(h["total"]))], className="invest-foot total")
    return html.Table([html.Thead(header), html.Tbody(rows + [foot, total])],
                      className="invest-table")


def _stats_table(game: dict) -> html.Table:
    pfs = game["portfolios"]
    sums = [G.summary(game, pf) for pf in pfs]
    head = html.Tr([html.Th("")] + [html.Th(pf["name"]) for pf in pfs])
    compare = len(pfs) >= 2  # only flag a "winner" when there's something to compare

    def row(label, key, fmt):
        vals = [s[key] for s in sums]
        best = max(vals) if compare else None
        cells = [html.Th(label)]
        for v in vals:
            is_best = compare and abs(v - best) < 1e-9
            cells.append(html.Td(fmt(v),
                                 className="invest-best" if is_best else ""))
        return html.Tr(cells)

    body = [
        row("Value", "value", lambda v: _money(v)),
        row("Today $", "today_d", lambda v: f"{v:+,.2f}"),
        row("Today %", "today_p", lambda v: f"{v:+.2f}%"),
        row("Total $", "total_d", lambda v: f"{v:+,.2f}"),
        row("Total %", "total_p", lambda v: f"{v:+.2f}%"),
        row("(G−L)/(G+L)", "pf_metric", lambda v: f"{v:+.3f}"),
    ]
    return html.Table([html.Thead(head), html.Tbody(body)], className="invest-table")


# Shared metric formatters/spec (also used by the Paper Trading page).
from src.app.metrics import (METRICS as _METRICS, METRIC_TIPS,  # noqa: E402
                             pe as _pe, mpct as _mpct, mnum as _mnum)

# Hover descriptions: list-header tips + the shared metric-label tips.
_TIPS = {
    "Ticker": "Stock ticker symbol",
    "Price": "Closing price on the current game day",
    "Day %": "Change vs the previous trading day",
    "T P/E": "Trailing P/E — price ÷ trailing 12-month EPS (last 4 quarters)",
    "P/E": "Current P/E — price ÷ latest annual (fiscal-year) EPS",
    "F P/E": "Forward P/E — price ÷ (latest quarterly EPS × 4), annualized",
    **METRIC_TIPS,
}


def _th(label):
    """A header/label cell carrying its hover description when one exists."""
    tip = _TIPS.get(label)
    if not tip:
        return html.Th(label)
    return html.Th(label, className="invest-tip", **{"data-tip": tip})


def _prices_table(game: dict, selected: str | None = None,
                  sel_sector: str | None = None) -> html.Table | None:
    rows_data = G.ticker_prices(game)
    if not rows_data:
        return None
    header = html.Tr([_th(l) for l in ("Ticker", "Price", "Day %",
                                       "T P/E", "P/E", "F P/E")])
    rows = []
    current_sector = None
    for r in rows_data:
        if r["sector"] != current_sector:  # sector group header (clickable, ≠ Unknown)
            current_sector = r["sector"]
            if current_sector == "Unknown":
                rows.append(html.Tr(html.Td(current_sector, colSpan=6),
                                    className="invest-sector-head"))
            else:
                hcls = "invest-sector-head invest-sector-click" + (
                    " selected" if current_sector == sel_sector else "")
                rows.append(html.Tr(
                    html.Td(current_sector, colSpan=6),
                    id={"type": "invest-sector-head", "sector": current_sector},
                    n_clicks=0, className=hcls))
        cls = "invest-price-row" + (" selected" if r["ticker"] == selected else "")
        rows.append(html.Tr(
            [html.Td(r["ticker"], className="invest-tip",
                     **{"data-tip": r.get("name") or r["ticker"]}),
             html.Td(_money(r["price"])),
             html.Td(f"{r['change']:+.2f}%", className=_pl_class(r["change"])),
             html.Td(_pe(r["trailing_pe"])), html.Td(_pe(r["current_pe"])),
             html.Td(_pe(r["forward_pe"]))],
            id={"type": "invest-price-row", "ticker": r["ticker"]},
            n_clicks=0, className=cls,
        ))
    return html.Table([html.Thead(header), html.Tbody(rows)], className="invest-table")


# (_METRICS / formatters imported above from src.app.metrics.)
_METRIC_LABEL = {key: label for label, key, _ in _METRICS}


def _metric_label_th(label, key, sel_metric):
    """Clickable indicator label — selects the metric to overlay on the chart."""
    tip = _TIPS.get(label)
    cls = "invest-metric invest-tip" + (" selected" if key == sel_metric else "")
    kw = {"data-tip": tip} if tip else {}
    return html.Th(label, id={"type": "invest-metric", "metric": key},
                   n_clicks=0, className=cls, **kw)


def _stock_metrics_table(game: dict, ticker: str, sel_metric=None) -> html.Table:
    m = G.stock_metrics(game, ticker)
    body = [html.Tr([_metric_label_th(label, key, sel_metric), html.Td(fmt(m))])
            for label, key, fmt in _METRICS]
    return html.Table(html.Tbody(body), className="invest-table")


def _sector_metrics_table(game: dict, tickers: list, colors: list,
                          sel_metric=None) -> html.Table:
    mets = {t: G.stock_metrics(game, t) for t in tickers}
    col = {t: colors[i % len(colors)] for i, t in enumerate(tickers)}
    # Columns = stocks (colored to match their chart line); rows = indicators.
    header = html.Tr([html.Th("")] + [
        html.Th(t, className="invest-tip", style={"color": col[t]},
                **{"data-tip": G.company_name(t)}) for t in tickers])
    rows = [html.Tr([_metric_label_th(label, key, sel_metric)]
                    + [html.Td(fmt(mets[t]), style={"color": col[t]}) for t in tickers])
            for label, key, fmt in _METRICS]
    return html.Table([html.Thead(header), html.Tbody(rows)], className="invest-table")


# ── Layout ────────────────────────────────────────────────────────────────────

def layout(**_):
    today = date.today()
    return html.Div(
        [
            page_header(["Investing Simulator ",
                         html.Span("(Historical Data)", className="title-sub")],
                        "Trade real historical prices day by day. Each portfolio "
                        "starts at $10,000 — compare your strategies against the "
                        "S&P 500."),
            dcc.Store(id="invest-refresh", data=0),
            dcc.Store(id="invest-selected-stock"),
            dcc.Store(id="invest-selected-sector"),
            dcc.Store(id="invest-selected-metric"),
            # Setup row (shown when no game is in progress).
            html.Div(
                [
                    html.Span("Period:", style={"color": theme.MUTED}),
                    dcc.DatePickerRange(
                        id="invest-dates",
                        start_date=(today - timedelta(days=365)),
                        end_date=today,
                        max_date_allowed=today,
                        display_format="DD/MM/YYYY",
                    ),
                    html.Button("Start game", id="invest-start", n_clicks=0,
                                style=theme.BUTTON_STYLE),
                ],
                id="invest-setup-row", className="invest-controls",
            ),
            # Play row (shown during a game).
            html.Div(
                [
                    html.Span(id="invest-status", style={"fontWeight": 600}),
                    html.Button("Next ›", id="invest-next", n_clicks=0,
                                style=theme.BUTTON_STYLE),
                    html.Button("Restart", id="invest-restart", n_clicks=0,
                                style={**theme.PERIOD_BUTTON_STYLE,
                                       "color": theme.EXPENSE_COLOR,
                                       "borderColor": theme.EXPENSE_COLOR}),
                ],
                id="invest-play-row", className="invest-controls", style=_HIDDEN,
            ),
            html.Div(
                [
                    card(
                        [
                            html.H3("Manage", style={"marginTop": 0}),
                            dcc.RadioItems(id="invest-active", options=[], value=0,
                                           inline=True,
                                           labelStyle={"marginRight": "14px",
                                                       "cursor": "pointer"}),
                            html.Div(
                                [
                                    html.Button("+ Portfolio", id="invest-add-pf",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                    dcc.Input(id="invest-rename", type="text",
                                              placeholder="Rename active…",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "flex": "1",
                                                     "minWidth": "120px"}),
                                    html.Button("Rename", id="invest-rename-btn",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                ],
                                style={"display": "flex", "gap": "8px",
                                       "alignItems": "center", "marginTop": "8px",
                                       "flexWrap": "wrap"},
                            ),
                            html.Hr(),
                            html.Div(
                                [
                                    dcc.Input(id="invest-ticker-add", type="text",
                                              placeholder="Ticker (e.g. AAPL)",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "flex": "1"}),
                                    html.Button("Add", id="invest-add-ticker",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                ],
                                style={"display": "flex", "gap": "8px",
                                       "alignItems": "center"},
                            ),
                            html.Hr(),
                            dcc.RadioItems(
                                id="invest-trade-mode",
                                options=[{"label": "  Shares", "value": "shares"},
                                         {"label": "  $ amount", "value": "dollars"}],
                                value="shares", inline=True,
                                inputStyle={"marginRight": "4px"},
                                labelStyle={"marginRight": "16px", "cursor": "pointer"},
                            ),
                            html.Div(
                                [
                                    dcc.Dropdown(id="invest-trade-ticker", options=[],
                                                 placeholder="Ticker…",
                                                 style={"flex": "1",
                                                        "minWidth": "110px"}),
                                    dcc.Input(id="invest-trade-qty", type="number",
                                              min=0, step="any", placeholder="Qty / $",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0,
                                                     "width": "90px"}),
                                    html.Button("Buy", id="invest-buy", n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.INCOME_COLOR,
                                                       "borderColor": theme.INCOME_COLOR}),
                                    html.Button("Sell", id="invest-sell", n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.EXPENSE_COLOR,
                                                       "borderColor": theme.EXPENSE_COLOR}),
                                ],
                                style={"display": "flex", "gap": "8px",
                                       "alignItems": "center", "marginTop": "10px",
                                       "flexWrap": "wrap"},
                            ),
                            html.Div(id="invest-msg",
                                     style={"fontSize": "13px", "marginTop": "8px",
                                            "minHeight": "18px"}),
                            html.Div(id="invest-holdings",
                                     style={"marginTop": "12px"}),
                            html.Hr(),
                            html.H4("Stocks", style={"margin": "0 0 8px"}),
                            html.Div(id="invest-prices"),
                        ],
                        style={"flex": "0 0 400px"},
                    ),
                    card(
                        [
                            dcc.Graph(id="invest-graph", style={"height": "420px"},
                                      config=_GRAPH_CONFIG),
                            html.Div(id="invest-stats", style={"marginTop": "12px"}),
                            html.Div(
                                [
                                    html.Div(
                                        [
                                            dcc.RadioItems(
                                                id="invest-stock-range",
                                                options=[{"label": r, "value": r}
                                                         for r in G.STOCK_RANGES],
                                                value="1Y", inline=True,
                                                className="invest-range",
                                                inputStyle={"display": "none"},
                                                labelStyle={"cursor": "pointer"},
                                            ),
                                            dcc.Checklist(
                                                id="invest-normalize",
                                                options=[{"label": " Normalize (% vs start)",
                                                          "value": "norm"}],
                                                value=[], inline=True,
                                                labelStyle={"cursor": "pointer"},
                                            ),
                                        ],
                                        style={"display": "flex",
                                               "justifyContent": "space-between",
                                               "alignItems": "center",
                                               "width": "100%", "gap": "16px",
                                               "flexWrap": "wrap"},
                                    ),
                                    dcc.Graph(id="invest-stock-graph",
                                              style={"height": "300px"},
                                              config=_GRAPH_CONFIG),
                                    html.Div(id="invest-stock-metrics",
                                             style={"marginTop": "10px"}),
                                    html.Div(
                                        html.Button("Delete stock",
                                                    id="invest-delete-stock", n_clicks=0,
                                                    style={**theme.PERIOD_BUTTON_STYLE,
                                                           "color": theme.EXPENSE_COLOR,
                                                           "borderColor": theme.EXPENSE_COLOR}),
                                        id="invest-delete-wrap",
                                        style={"marginTop": "12px"}),
                                ],
                                id="invest-stock-wrap", style=_HIDDEN,
                            ),
                        ],
                        style={"flex": "1", "marginLeft": "20px"},
                    ),
                ],
                id="invest-main", className="invest-main", style=_HIDDEN,
            ),
            # Restart confirmation modal (hidden until the Restart button is clicked).
            html.Div(
                html.Div(
                    [
                        html.H3("Restart game"),
                        html.P("Keep your portfolios and tickers and replay from day 1, "
                               "or clear everything and start over?",
                               style={"color": theme.MUTED}),
                        html.Div(
                            [
                                html.Button("Restart (keep portfolios)",
                                            id="invest-restart-keep", n_clicks=0,
                                            style=theme.BUTTON_STYLE),
                                html.Button("Restart — clear all",
                                            id="invest-restart-all", n_clicks=0,
                                            style={**theme.PERIOD_BUTTON_STYLE,
                                                   "color": theme.EXPENSE_COLOR,
                                                   "borderColor": theme.EXPENSE_COLOR}),
                                html.Button("Cancel", id="invest-restart-cancel",
                                            n_clicks=0, style=theme.PERIOD_BUTTON_STYLE),
                            ],
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card",
                ),
                id="invest-restart-modal", className="modal-overlay", style=_HIDDEN,
            ),
            # Delete-stock confirmation modal.
            html.Div(
                html.Div(
                    [
                        html.H3("Delete stock"),
                        html.P(["Remove ", html.Span(id="invest-del-name",
                                                     style={"fontWeight": 600}),
                                " from the list forever, or just for this game?"],
                               style={"color": theme.MUTED}),
                        html.Div(
                            [
                                html.Button("Delete forever", id="invest-del-forever",
                                            n_clicks=0,
                                            style={**theme.PERIOD_BUTTON_STYLE,
                                                   "color": theme.EXPENSE_COLOR,
                                                   "borderColor": theme.EXPENSE_COLOR}),
                                html.Button("Delete this session",
                                            id="invest-del-session", n_clicks=0,
                                            style=theme.BUTTON_STYLE),
                                html.Button("Cancel", id="invest-del-cancel",
                                            n_clicks=0, style=theme.PERIOD_BUTTON_STYLE),
                            ],
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card",
                ),
                id="invest-delete-modal", className="modal-overlay", style=_HIDDEN,
            ),
        ],
        style=theme.PAGE_STYLE,
    )


# ── Mutation callbacks ────────────────────────────────────────────────────────

@callback(
    Output("invest-refresh", "data", allow_duplicate=True),
    Output("invest-msg", "children", allow_duplicate=True),
    Input("invest-start", "n_clicks"),
    State("invest-dates", "start_date"),
    State("invest-dates", "end_date"),
    State("invest-refresh", "data"),
    prevent_initial_call=True,
)
def _start(_n, start, end, refresh):
    if not start or not end:
        return no_update, "Pick a start and close date."
    try:
        G.create_game(start, end)
    except (G.GameError, Exception) as exc:  # network/lookup issues included
        return no_update, f"Could not start: {exc}"
    return (refresh or 0) + 1, ""


@callback(
    Output("invest-refresh", "data", allow_duplicate=True),
    Input("invest-next", "n_clicks"),
    State("invest-refresh", "data"),
    prevent_initial_call=True,
)
def _next(_n, refresh):
    game = G.load_game()
    if not game:
        raise PreventUpdate
    G.advance(game)
    return (refresh or 0) + 1


@callback(
    Output("invest-restart-modal", "style"),
    Output("invest-refresh", "data", allow_duplicate=True),
    Output("invest-msg", "children", allow_duplicate=True),
    Input("invest-restart", "n_clicks"),
    Input("invest-restart-keep", "n_clicks"),
    Input("invest-restart-all", "n_clicks"),
    Input("invest-restart-cancel", "n_clicks"),
    State("invest-refresh", "data"),
    prevent_initial_call=True,
)
def _restart_modal(_open, _keep, _all, _cancel, refresh):
    trig = ctx.triggered_id
    show = {"display": "flex"}
    if trig == "invest-restart":
        return show, no_update, no_update
    if trig == "invest-restart-cancel":
        return _HIDDEN, no_update, no_update
    if trig == "invest-restart-keep":
        game = G.load_game()
        if game:
            G.restart_keep(game)
        return _HIDDEN, (refresh or 0) + 1, ""
    # invest-restart-all: remember the most-bought stocks, then wipe the game.
    game = G.load_game()
    if game:
        G.remember_from_game(game)
    G.restart()
    return _HIDDEN, (refresh or 0) + 1, ""


@callback(
    Output("invest-delete-modal", "style"),
    Output("invest-refresh", "data", allow_duplicate=True),
    Output("invest-msg", "children", allow_duplicate=True),
    Output("invest-del-name", "children"),
    Input("invest-delete-stock", "n_clicks"),
    Input("invest-del-forever", "n_clicks"),
    Input("invest-del-session", "n_clicks"),
    Input("invest-del-cancel", "n_clicks"),
    State("invest-selected-stock", "data"),
    State("invest-refresh", "data"),
    prevent_initial_call=True,
)
def _delete_modal(_open, _forever, _session, _cancel, selected, refresh):
    trig = ctx.triggered_id
    game = G.load_game()
    if trig == "invest-delete-stock":
        if not game or not selected:
            raise PreventUpdate
        if G.is_held(game, selected):
            return _HIDDEN, no_update, f"Sell your shares of {selected} first.", no_update
        return {"display": "flex"}, no_update, "", selected
    if trig == "invest-del-cancel":
        return _HIDDEN, no_update, no_update, no_update
    # Delete (this session or forever).
    if game and selected:
        try:
            G.delete_ticker(game, selected, forever=(trig == "invest-del-forever"))
        except G.GameError as exc:
            return _HIDDEN, no_update, str(exc), no_update
    return _HIDDEN, (refresh or 0) + 1, "", no_update


@callback(
    Output("invest-refresh", "data", allow_duplicate=True),
    Output("invest-msg", "children", allow_duplicate=True),
    Input("invest-add-pf", "n_clicks"),
    State("invest-refresh", "data"),
    prevent_initial_call=True,
)
def _add_pf(_n, refresh):
    game = G.load_game()
    if not game:
        raise PreventUpdate
    try:
        G.add_portfolio(game)
    except G.GameError as exc:
        return no_update, str(exc)
    return (refresh or 0) + 1, ""


@callback(
    Output("invest-refresh", "data", allow_duplicate=True),
    Output("invest-msg", "children", allow_duplicate=True),
    Output("invest-rename", "value"),
    Input("invest-rename-btn", "n_clicks"),
    State("invest-rename", "value"),
    State("invest-refresh", "data"),
    prevent_initial_call=True,
)
def _rename_pf(_n, name, refresh):
    game = G.load_game()
    if not game:
        raise PreventUpdate
    try:
        G.rename_portfolio(game, game["active"], name)
    except G.GameError as exc:
        return no_update, str(exc), no_update
    return (refresh or 0) + 1, "", ""


@callback(
    Output("invest-refresh", "data", allow_duplicate=True),
    Input("invest-active", "value"),
    State("invest-refresh", "data"),
    prevent_initial_call=True,
)
def _set_active(idx, refresh):
    game = G.load_game()
    if not game or idx is None or idx == game.get("active"):
        raise PreventUpdate  # guard the render→value→callback loop
    G.set_active(game, int(idx))
    return (refresh or 0) + 1


@callback(
    Output("invest-refresh", "data", allow_duplicate=True),
    Output("invest-msg", "children", allow_duplicate=True),
    Output("invest-ticker-add", "value"),
    Input("invest-add-ticker", "n_clicks"),
    State("invest-ticker-add", "value"),
    State("invest-refresh", "data"),
    prevent_initial_call=True,
)
def _add_ticker(_n, ticker, refresh):
    game = G.load_game()
    if not game:
        raise PreventUpdate
    try:
        G.add_ticker(game, ticker)
    except G.GameError as exc:
        return no_update, str(exc), no_update
    return (refresh or 0) + 1, "", ""


@callback(
    Output("invest-refresh", "data", allow_duplicate=True),
    Output("invest-msg", "children", allow_duplicate=True),
    Input("invest-buy", "n_clicks"),
    Input("invest-sell", "n_clicks"),
    State("invest-trade-ticker", "value"),
    State("invest-trade-qty", "value"),
    State("invest-trade-mode", "value"),
    State("invest-refresh", "data"),
    prevent_initial_call=True,
)
def _trade(_b, _s, ticker, amount, mode, refresh):
    game = G.load_game()
    if not game:
        raise PreventUpdate
    side = "buy" if ctx.triggered_id == "invest-buy" else "sell"
    if not ticker:
        return no_update, "Choose a ticker to trade."
    try:
        G.record_trade(game, game["active"], ticker, amount, side,
                       mode=mode or "shares")
    except G.GameError as exc:
        return no_update, str(exc)
    return (refresh or 0) + 1, ""


@callback(
    Output("invest-trade-qty", "placeholder"),
    Input("invest-trade-mode", "value"),
)
def _trade_placeholder(mode):
    return "$" if mode == "dollars" else "Qty"


@callback(
    Output("invest-selected-stock", "data"),
    Output("invest-trade-ticker", "value"),
    Output("invest-selected-sector", "data", allow_duplicate=True),
    Input({"type": "invest-price-row", "ticker": ALL}, "n_clicks"),
    State("invest-selected-stock", "data"),
    prevent_initial_call=True,
)
def _select_stock(_clicks, current):
    tk = ctx.triggered_id["ticker"]
    if not any(_clicks or []):  # recreation of rows (all n_clicks 0) — ignore
        raise PreventUpdate
    # Toggle the chart selection, arm the Buy/Sell dropdown, and clear any sector.
    return (None if tk == current else tk), tk, None


@callback(
    Output("invest-selected-sector", "data"),
    Output("invest-selected-stock", "data", allow_duplicate=True),
    Input({"type": "invest-sector-head", "sector": ALL}, "n_clicks"),
    State("invest-selected-sector", "data"),
    prevent_initial_call=True,
)
def _select_sector(_clicks, current):
    sec = ctx.triggered_id["sector"]
    if not any(_clicks or []):  # recreation of headers — ignore
        raise PreventUpdate
    return (None if sec == current else sec), None  # toggle sector, clear stock


@callback(
    Output("invest-selected-metric", "data"),
    Input({"type": "invest-metric", "metric": ALL}, "n_clicks"),
    State("invest-selected-metric", "data"),
    prevent_initial_call=True,
)
def _select_metric(_clicks, current):
    metric = ctx.triggered_id["metric"]
    if not any(_clicks or []):  # recreation of labels — ignore
        raise PreventUpdate
    return None if metric == current else metric  # toggle the overlay


# ── Render callback ───────────────────────────────────────────────────────────

@callback(
    Output("invest-setup-row", "style"),
    Output("invest-play-row", "style"),
    Output("invest-main", "style"),
    Output("invest-status", "children"),
    Output("invest-next", "disabled"),
    Output("invest-active", "options"),
    Output("invest-active", "value"),
    Output("invest-trade-ticker", "options"),
    Output("invest-prices", "children"),
    Output("invest-holdings", "children"),
    Output("invest-stats", "children"),
    Output("invest-graph", "figure"),
    Output("invest-stock-wrap", "style"),
    Output("invest-stock-graph", "figure"),
    Output("invest-stock-metrics", "children"),
    Output("invest-delete-wrap", "style"),
    Input("invest-refresh", "data"),
    Input("invest-selected-stock", "data"),
    Input("invest-selected-sector", "data"),
    Input("invest-selected-metric", "data"),
    Input("invest-stock-range", "value"),
    Input("invest-normalize", "value"),
    Input("theme-store", "data"),
)
def _render(_refresh, selected, sel_sector, sel_metric, stock_range, normalize,
            theme_value):
    game = G.load_game()
    dark = theme.is_dark(theme_value)
    if not game:
        empty = build_investment_figure({}, None, dark)
        return ({}, _HIDDEN, _HIDDEN, "", True, [], 0, [], None, None, None,
                empty, _HIDDEN, empty, None, _HIDDEN)

    main_style = {"display": "flex", "alignItems": "flex-start", "marginTop": "16px"}
    series = {pf["name"]: G.value_series(game, pf) for pf in game["portfolios"]}
    fig = build_investment_figure(series, G.spx_series(game), dark)
    ticker_opts = [{"label": t, "value": t} for t in game["tickers"]]
    rng = stock_range or "1Y"
    norm = "norm" in (normalize or [])
    start = pd.Timestamp(game["start"])

    def _norm(s, base):  # to % of the game-start price
        return s / base * 100 if (norm and base) else s

    # Resolve which detail view to show: sector comparison, single stock, or none.
    sec_tks = G.sector_tickers(game, sel_sector) if sel_sector else []
    stock_sel = selected if selected in game["tickers"] else None
    shown = {"display": "block", "marginTop": "28px"}

    ratio_label = _METRIC_LABEL.get(sel_metric)
    if sel_sector and sel_sector != "Unknown" and sec_tks:  # sector comparison
        sdict = {t: _norm(G.stock_history(game, t, rng), G.game_start_price(game, t))
                 for t in sec_tks}
        colors = cubehelix_colors(len(sec_tks), dark)  # chart + table share these
        ratio_map = ({t: G.ratio_history(game, t, rng, sel_metric) for t in sec_tks}
                     if sel_metric else None)
        stock_wrap, delete_wrap = shown, _HIDDEN
        stock_fig = build_sector_figure(sel_sector, sdict, dark, game_start=start,
                                        normalized=norm, colors=colors,
                                        ratio_map=ratio_map, ratio_label=ratio_label)
        metrics = _sector_metrics_table(game, sec_tks, colors, sel_metric)
    elif stock_sel:  # single stock
        s = _norm(G.stock_history(game, stock_sel, rng),
                  G.game_start_price(game, stock_sel))
        rs = G.ratio_history(game, stock_sel, rng, sel_metric) if sel_metric else None
        stock_wrap, delete_wrap = shown, {"marginTop": "12px"}
        stock_fig = build_stock_figure(stock_sel, s, dark, game_start=start,
                                       normalized=norm, ratio_series=rs,
                                       ratio_label=ratio_label)
        metrics = _stock_metrics_table(game, stock_sel, sel_metric)
    else:
        stock_wrap = delete_wrap = _HIDDEN
        stock_fig = build_investment_figure({}, None, dark)
        metrics = None

    return (
        _HIDDEN, {"display": "flex"}, main_style,
        _status_text(game), G.is_over(game),
        _active_options(game), game["active"],
        ticker_opts, _prices_table(game, stock_sel, sel_sector), _holdings_table(game),
        _stats_table(game), fig, stock_wrap, stock_fig, metrics, delete_wrap,
    )
