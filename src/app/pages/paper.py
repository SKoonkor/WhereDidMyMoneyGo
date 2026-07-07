"""Paper Trading — a live virtual-money trading simulator.

Trade stocks, ETFs, crypto and single-leg options at near-real-time quotes with
a fake account (default $100,000). Supports market / limit / stop / trailing-stop
orders, short selling and a benchmark against the S&P 500. Shares the Investment
Simulator's two-card layout. State persists to config/paper_trading.json.
"""

from dash import (dcc, html, callback, clientside_callback, Input, Output, State,
                  ctx, no_update, ALL, register_page)
from dash.exceptions import PreventUpdate
import pandas as pd

from src.app import theme
from src.app.components import page_header, card
from src.app.figures.paper import build_equity_figure
from src.app.figures.investment import (build_price_figure, build_sector_figure,
                                        cubehelix_colors)
# Shared multiples row-spec + hover texts (module outside pages/ — importing a
# page module here would double-register its route and break Dash).
from src.app.metrics import METRICS as _INV_METRICS, METRIC_TIPS as _INV_TIPS
from src.io import quotes as Q
from src.io import stocks as S
from src.analytics import paper as P

register_page(__name__, path="/paper/trade",
              name="Paper Trading (Live Market Data) — Trade")

_HIDDEN = {"display": "none"}
_FLEX = {"display": "flex", "gap": "8px", "alignItems": "center", "flexWrap": "wrap"}
# Non-interactive charts: no modebar, no wheel-zoom, no double-click reset. Hover
# (spike + crosshair + legend) still works. Panning/zooming is killed per-figure via
# _lock_static (fixedrange + dragmode False). ``responsive`` kept for the maximize view.
_GRAPH_CONFIG = {"displayModeBar": False, "scrollZoom": False, "doubleClick": False,
                 "responsive": True}


def _lock_static(fig):
    """Disable Plotly zoom/pan/drag on a paper figure while keeping hover."""
    fig.update_layout(dragmode=False)
    fig.update_xaxes(fixedrange=True)
    fig.update_yaxes(fixedrange=True)   # y2 is already fixedrange
    return fig
# Chart ranges: 1D/5D are intraday (1-minute / 15-minute bars via Q.intraday,
# ~15-min delayed); the rest come from the daily disk cache.
_RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "ALL"]
_NO_CANDLE = {"5Y", "ALL"}   # candles too dense to be useful over long spans
_INTRADAY = {"1D": ("1d", "1m"), "5D": ("5d", "15m")}
_RANGE_DAYS = {"1M": 31, "6M": 183, "1Y": 366, "5Y": 1827}


def _money(v: float) -> str:
    return f"{v:,.2f}"


def _pl_class(v: float) -> str:
    return "amt-income" if v > 0 else "amt-expense" if v < 0 else ""


# ── Render helpers ────────────────────────────────────────────────────────────

def _status_text(state: dict) -> list:
    s = P.summary(state, state["active"])
    return [
        html.Span(f"Equity ${_money(s['value'])}", style={"fontWeight": 700}),
        html.Span(f"  ·  Today ", style={"color": theme.MUTED}),
        html.Span(f"{s['day_d']:+,.2f} ({s['day_p']:+.2f}%)",
                  className=_pl_class(s["day_d"])),
        html.Span(f"  ·  Total ", style={"color": theme.MUTED}),
        html.Span(f"{s['total_d']:+,.2f} ({s['total_p']:+.2f}%)",
                  className=_pl_class(s["total_d"])),
    ]


# Hover definitions for the portfolio stats rows (rendered via the shared
# `.invest-tip[data-tip]` CSS, same mechanism as the Investing Simulator).
_TIPS = {
    "Equity": "Total account value: cash + market value of all positions "
              "(short positions count negative).",
    "Buying power": "Free cash available for new buys or as collateral for shorts.",
    "Today $": "Change since yesterday's close, summed over stock/crypto positions "
               "(options excluded).",
    "Today %": "Today's $ change as a percent of yesterday's equity.",
    "Total $": "Profit/loss vs the net capital you put in (deposits − withdrawals). "
               "Moving cash in or out never counts as gain or loss.",
    "Total %": "Total $ P/L as a percent of your net contributed capital.",
    "Realized P/L": "Profit/loss locked in by trades you have already closed.",
    "Unrealized P/L": "Paper profit/loss still open in your current positions — "
                      "changes with the market until you close them.",
}


def _tip_th(label) -> html.Th:
    tip = _TIPS.get(label)
    if not tip:
        return html.Th(label)
    return html.Th(label, className="invest-tip", **{"data-tip": tip})


def _stats_table(state: dict) -> html.Table:
    pfs = state["portfolios"]
    sums = [P.summary(state, i) for i in range(len(pfs))]
    head = html.Tr([html.Th("")] + [html.Th(pf["name"]) for pf in pfs])
    compare = len(pfs) >= 2

    def row(label, key, fmt):
        vals = [s[key] for s in sums]
        best = max(vals) if compare else None
        cells = [_tip_th(label)]
        for v in vals:
            is_best = compare and abs(v - best) < 1e-9
            cells.append(html.Td(fmt(v), className="invest-best" if is_best else ""))
        return html.Tr(cells)

    body = [
        row("Equity", "value", lambda v: _money(v)),
        row("Buying power", "cash", lambda v: _money(v)),
        row("Today $", "day_d", lambda v: f"{v:+,.2f}"),
        row("Today %", "day_p", lambda v: f"{v:+.2f}%"),
        row("Total $", "total_d", lambda v: f"{v:+,.2f}"),
        row("Total %", "total_p", lambda v: f"{v:+.2f}%"),
        row("Realized P/L", "realized", lambda v: f"{v:+,.2f}"),
        row("Unrealized P/L", "unrealized", lambda v: f"{v:+,.2f}"),
    ]
    return html.Table([html.Thead(head), html.Tbody(body)], className="invest-table")


# Distinct colors per sector for the Positions bars/legend (Yahoo's 11 GICS sectors
# plus the non-equity buckets). Financial Services = red, ETF = yellow per request.
SECTOR_COLORS = {
    "Technology": "#3498db", "Financial Services": "#e74c3c", "Healthcare": "#2ecc71",
    "Consumer Cyclical": "#9b59b6", "Consumer Defensive": "#16a085",
    "Communication Services": "#e67e22", "Industrials": "#607d8b", "Energy": "#d35400",
    "Utilities": "#00bcd4", "Real Estate": "#8e44ad", "Basic Materials": "#a1673f",
    "ETF": "#f1c40f", "Index": "#fdcb6e", "Crypto": "#e84393", "Fund": "#b2bec3",
    "Unknown": "#95a5a6",
}


def _sector_color(sector) -> str:
    return SECTOR_COLORS.get(sector or "Unknown", "#95a5a6")


def _holdings_table(state: dict, selected: str | None = None,
                    sort_mode: str = "amount") -> html.Div:
    """Positions table. ``sort_mode="amount"`` → flat, value-descending, with a
    sector color legend below; ``"sector"`` → grouped by sector (groups and rows
    both value-descending) with a small sector header per group. Every holding row
    carries a colored left bar keyed to its sector."""
    rows_data = P.positions_rows(state, state["active"])   # already value-desc

    def _pos_tr(r) -> html.Tr:
        short = " (short)" if r["qty"] < 0 else ""
        bar = html.Span(className="pos-bar",
                        style={"background": _sector_color(r.get("sector"))})
        cells = [
            html.Td([bar, r["label"], html.Span(short, style={"color": theme.MUTED})],
                    className="invest-tip", **{"data-tip": P.company_name(r["symbol"])}),
            html.Td(f"{r['qty']:,.4f}".rstrip("0").rstrip(".")),
            html.Td(_money(r["avg_cost"])),
            html.Td(_money(r["price"])),
            html.Td(_money(r["value"])),
            html.Td(f"{r['unreal']:+,.2f}", className=_pl_class(r["unreal"])),
        ]
        # Stock/crypto rows are clickable (select → detail chart); options stay plain.
        if r["kind"] != "option":
            return html.Tr(
                cells, id={"type": "paper-pos-row", "ticker": r["symbol"]}, n_clicks=0,
                className="invest-price-row" + (" selected" if r["symbol"] == selected
                                                else ""))
        return html.Tr(cells)

    body, legend = [], None
    if not rows_data:
        body = [html.Tr(html.Td("No open positions.", colSpan=6,
                                style={"color": theme.MUTED}))]
    elif sort_mode == "sector":
        groups: dict[str, list] = {}
        for r in rows_data:
            groups.setdefault(r.get("sector") or "Unknown", []).append(r)
        for sec in sorted(groups, key=lambda s: -sum(abs(x["value"]) for x in groups[s])):
            body.append(html.Tr(html.Td(sec, colSpan=6),
                                 className="invest-sector-head"))
            body.extend(_pos_tr(r) for r in groups[sec])   # value-desc preserved
    else:                                                  # by amount + color legend
        body = [_pos_tr(r) for r in rows_data]
        totals: dict[str, float] = {}
        for r in rows_data:
            sec = r.get("sector") or "Unknown"
            totals[sec] = totals.get(sec, 0.0) + abs(r["value"])
        legend = html.Div(
            [html.Span([html.Span(className="pos-legend-dot",
                                  style={"background": _sector_color(s)}), s])
             for s in sorted(totals, key=lambda s: -totals[s])],
            className="pos-legend")

    pf = state["portfolios"][state["active"]]
    foot = html.Tr([html.Td("Cash", colSpan=4),
                    html.Td(_money(pf["cash"]), colSpan=2)], className="invest-foot")
    total = html.Tr([html.Td("Equity", colSpan=4),
                     html.Td(_money(P.equity(pf)), colSpan=2)],
                    className="invest-foot total")
    table = html.Table([html.Thead(header_row()), html.Tbody(body + [foot, total])],
                       className="invest-table")
    return html.Div([table, legend]) if legend is not None else html.Div(table)


def header_row() -> html.Tr:
    return html.Tr([html.Th(l) for l in
                    ("Position", "Qty", "Avg", "Price", "Value", "P/L")])


def _orders_table(state: dict) -> html.Div | None:
    pf = state["portfolios"][state["active"]]
    orders = P.open_orders(pf)
    if not orders:
        return html.Div("No pending orders.", style={"color": theme.MUTED,
                                                      "fontSize": "13px"})
    header = html.Tr([html.Th(l) for l in ("Order", "Type", "Trigger", "")])
    rows = []
    for o in orders:
        meta = {k: o[k] for k in
                ("kind", "symbol", "underlying", "expiry", "right", "strike")
                if k in o}
        label = P.instrument_label(meta)
        trig = (f"@ {o['limit']:g}" if o["otype"] == "limit" else
                f"@ {o['stop']:g}" if o["otype"] == "stop" else
                f"{o['trail']:g}%" if o["otype"] == "trailing" else "—")
        rows.append(html.Tr([
            html.Td(f"{o['side']} {o['qty']:g} {label}"),
            html.Td(o["otype"]),
            html.Td(trig),
            html.Td(html.Button("✕", id={"type": "paper-cancel", "oid": o["id"]},
                                n_clicks=0, className="paper-cancel-btn",
                                title="Cancel order")),
        ]))
    return html.Table([html.Thead(header), html.Tbody(rows)], className="invest-table")


def _watch_table(state: dict, selected: str | None,
                 sel_sector: str | None = None) -> html.Div | None:
    """Watchlist grouped by sector (Investing Simulator style): clickable sector
    headers, clickable stock rows, and a per-row ✕ that removes the symbol from
    the watchlist only (holdings untouched)."""
    rows_data = P.watch_rows(state)
    if not rows_data:
        return html.Div("Add tickers to watch live quotes.",
                        style={"color": theme.MUTED, "fontSize": "13px"})
    header = html.Tr([html.Th(l) for l in ("Ticker", "Last", "Chg", "Chg %", "")])
    rows = []
    current_sector = None
    for r in rows_data:
        if r["sector"] != current_sector:        # sector group header
            current_sector = r["sector"]
            if current_sector == "Unknown":
                rows.append(html.Tr(html.Td(current_sector, colSpan=5),
                                    className="invest-sector-head"))
            else:
                hcls = "invest-sector-head invest-sector-click" + (
                    " selected" if current_sector == sel_sector else "")
                rows.append(html.Tr(
                    html.Td(current_sector, colSpan=5),
                    id={"type": "paper-sector-head", "sector": current_sector},
                    n_clicks=0, className=hcls))
        cls = "invest-price-row" + (" selected" if r["ticker"] == selected else "")
        rows.append(html.Tr([
            html.Td(r["ticker"], className="invest-tip",
                    **{"data-tip": r.get("name") or r["ticker"]}),
            html.Td(_money(r["last"])),
            html.Td(f"{r['change']:+,.2f}", className=_pl_class(r["change"])),
            html.Td(f"{r['change_pct']:+.2f}%", className=_pl_class(r["change"])),
            html.Td(html.Button("✕", id={"type": "paper-unwatch",
                                         "ticker": r["ticker"]}, n_clicks=0,
                                className="paper-cancel-btn",
                                title="Remove from watchlist (holdings unaffected)")),
        ], id={"type": "paper-watch-row", "ticker": r["ticker"]}, n_clicks=0,
            className=cls))
    return html.Table([html.Thead(header), html.Tbody(rows)], className="invest-table")


def _fmt_metric(fmt, m):
    try:
        return fmt(m)
    except (TypeError, KeyError):
        return "–"


def _metric_th(label) -> html.Th:
    tip = _INV_TIPS.get(label)
    if not tip:
        return html.Th(label)
    return html.Th(label, className="invest-tip", **{"data-tip": tip})


def _stock_metrics_table(ticker: str, price: float) -> html.Table:
    """Multiples for one watchlist symbol (same rows as the Investing Simulator)."""
    m = P.watch_metrics(ticker, price)
    body = [html.Tr([_metric_th(label), html.Td(_fmt_metric(fmt, m))])
            for label, key, fmt in _INV_METRICS]
    return html.Table(html.Tbody(body), className="invest-table")


def _sector_metrics_table(tickers: list, colors: list, marks: dict) -> html.Table:
    """Side-by-side multiples for a sector's watchlist members, columns colored to
    match their comparison-chart lines."""
    mets = {t: P.watch_metrics(t, marks.get(t)) for t in tickers}
    col = {t: colors[i % len(colors)] for i, t in enumerate(tickers)}
    header = html.Tr([html.Th("")] + [
        html.Th(t, className="invest-tip", style={"color": col[t]},
                **{"data-tip": P.company_name(t)}) for t in tickers])
    rows = [html.Tr([_metric_th(label)]
                    + [html.Td(_fmt_metric(fmt, mets[t]), style={"color": col[t]})
                       for t in tickers])
            for label, key, fmt in _INV_METRICS]
    return html.Table([html.Thead(header), html.Tbody(rows)], className="invest-table")


def _trades_table(state: dict, limit: int | None = 10) -> html.Div:
    rows_data = P.trade_history(state, state["active"], limit=limit)
    if not rows_data:
        return html.Div("No transactions yet.",
                        style={"color": theme.MUTED, "fontSize": "13px"})
    header = html.Tr([html.Th(l) for l in ("When", "Action", "Qty", "Price", "Value")])
    rows = []
    for r in rows_data:
        when = (r["t"] or "")[5:16].replace("T", " ")   # MM-DD HH:MM
        side = r["side"].capitalize()
        qty = f"{r['qty']:g}" if r["qty"] is not None else "—"
        price = _money(r["price"]) if r["price"] is not None else "—"
        rows.append(html.Tr([
            html.Td(when, style={"color": theme.MUTED, "whiteSpace": "nowrap"}),
            html.Td([side, html.Span(f" {r['label']}", style={"color": theme.MUTED})]),
            html.Td(qty), html.Td(price), html.Td(_money(r["value"])),
        ]))
    return html.Div(
        html.Table([html.Thead(header), html.Tbody(rows)], className="invest-table"),
        className="paper-trades-wrap",
    )


def _chain_table(underlying: str, expiry: str, right: str,
                 sel_strike) -> html.Div:
    if not (underlying and expiry):
        return html.Div("Load an option chain to pick a contract.",
                        style={"color": theme.MUTED})
    try:
        chain = Q.option_chain(underlying, expiry)
    except S.StockError as exc:
        return html.Div(str(exc), style={"color": theme.EXPENSE_COLOR})
    side = chain["calls"] if right == "call" else chain["puts"]
    header = html.Tr([html.Th(l) for l in
                      ("Strike", "Bid", "Ask", "Last", "IV", "Vol", "OI")])
    rows = []
    for r in side:
        def f(v, pct=False):
            if v is None:
                return "–"
            return f"{v*100:.1f}%" if pct else f"{v:,.2f}"
        itm = " paper-itm" if r["itm"] else ""
        sel = " selected" if (sel_strike is not None
                              and abs(r["strike"] - float(sel_strike)) < 1e-6) else ""
        rows.append(html.Tr([
            html.Td(f"{r['strike']:g}"),
            html.Td(f(r["bid"])), html.Td(f(r["ask"])), html.Td(f(r["last"])),
            html.Td(f(r["iv"], pct=True)),
            html.Td(f"{int(r['volume'])}" if r["volume"] else "–"),
            html.Td(f"{int(r['oi'])}" if r["oi"] else "–"),
        ], id={"type": "paper-strike", "strike": r["strike"]}, n_clicks=0,
            className="invest-price-row" + itm + sel))
    return html.Table([html.Thead(header), html.Tbody(rows)],
                      className="invest-table paper-chain")


def _history(symbol: str, rng: str) -> pd.Series:
    if rng in _INTRADAY:                          # 1D/5D → intraday bars
        period, interval = _INTRADAY[rng]
        return Q.intraday(symbol, period, interval)
    end = pd.Timestamp.today().normalize()
    if rng == "YTD":
        start = pd.Timestamp(year=end.year, month=1, day=1)
    elif rng == "ALL":                            # from the ticker's inception
        start = pd.Timestamp("1970-01-01")
    else:
        start = end - pd.Timedelta(days=_RANGE_DAYS.get(rng, 366))
    try:
        return S.fetch_close(symbol, start, end)
    except S.StockError:
        return pd.Series(dtype=float)


def _history_ohlcv(symbol: str, rng: str) -> "pd.DataFrame":
    """OHLCV bars for the individual stock price+volume chart (same ranges as
    ``_history``)."""
    if rng in _INTRADAY:
        period, interval = _INTRADAY[rng]
        return Q.ohlcv(symbol, period=period, interval=interval)
    end = pd.Timestamp.today().normalize()
    if rng == "YTD":
        return Q.ohlcv(symbol, start=pd.Timestamp(year=end.year, month=1, day=1),
                       end=end, interval="1d")
    if rng == "ALL":
        return Q.ohlcv(symbol, period="max", interval="1d")
    start = end - pd.Timedelta(days=_RANGE_DAYS.get(rng, 366))
    return Q.ohlcv(symbol, start=start, end=end, interval="1d")


def _bold(text):
    return html.Span(text, style={"fontWeight": 700})


def _confirm_body(pend: dict) -> html.Div:
    """Human-readable summary of the pending transaction for the confirm popup."""
    kind = pend["kind"]
    if kind == "cash":
        verb = "Deposit" if pend["op"] == "deposit" else "Withdraw"
        prep = "into" if pend["op"] == "deposit" else "from"
        return html.Div([html.Span(f"{verb} "), _bold(f"${pend['amount']:,.2f}"),
                         html.Span(f" {prep} {pend['pf_name']}.")])
    # trade
    action = "Sell / Short" if pend.get("is_short") else pend["action"].capitalize()
    mult = pend["mult"]
    price, est, ap = pend["price"], pend["est"], ("~" if pend["approx"] else "")
    unit = "contract" if pend["is_option"] else "share"
    head = html.Div([html.Span(f"{action} "),
                     _bold(f"{pend['qty']:g} {pend['label']}"),
                     html.Span(f"  (×{mult} per contract)" if mult != 1 else "")])
    lines = [head]
    # Company name under the qty/ticker line, in the same muted style as "per share".
    name = P.company_name(pend.get("symbol", ""))
    if name and name != pend["label"]:
        lines.append(html.Div(name, style={"color": theme.MUTED, "fontSize": "13px"}))
    if pend["otype"] == "market":
        lines.append(html.Div(
            f"@ {ap}${price:,.2f} per {unit}" if price else "at the current price",
            style={"color": theme.MUTED, "fontSize": "13px"}))
        amt_label = "Estimated cost" if pend["action"] == "buy" else "Estimated proceeds"
        if est is not None:
            lines.append(html.Div([html.Span(f"{amt_label}: "),
                                   _bold(f"{ap}${est:,.2f}")]))
    else:
        trig = (f"limit ${price:,.2f}" if pend["otype"] == "limit"
                else f"stop ${price:,.2f}" if pend["otype"] == "stop"
                else "trailing stop")
        lines.append(html.Div(f"{pend['otype'].capitalize()} order — {trig}",
                              style={"color": theme.MUTED, "fontSize": "13px"}))
        if est is not None:
            lines.append(html.Div([html.Span("Est. amount when filled: "),
                                   _bold(f"${est:,.2f}")]))
    return html.Div(lines)


def _help_entry(name: str, definition: str, example: str) -> html.Div:
    """One order-type block in the help modal: name, definition, example scenario."""
    return html.Div(
        [
            html.Div(name, style={"fontWeight": 700, "marginBottom": "2px"}),
            html.Div(definition, style={"fontSize": "13px"}),
            html.Div(["Example: ", html.Em(example)],
                     style={"fontSize": "12.5px", "color": theme.MUTED,
                            "marginTop": "2px"}),
        ],
        style={"margin": "10px 0"},
    )


# ── Layout ────────────────────────────────────────────────────────────────────

def _labelled(label, comp):
    return html.Div([html.Span(label, style={"color": theme.MUTED,
                                             "fontSize": "13px",
                                             "marginRight": "6px"}), comp])


def layout(**_):
    # The account is chosen on the /paper picker; with none selected, go back there.
    state = P.load_state()
    if not state:
        return html.Div(dcc.Location(id="paper-redirect", href="/paper", refresh=True))
    return html.Div(
        [
            page_header(["Paper Trading ",
                         html.Span("(Live Market Data)", className="title-sub"),
                         f" — {state['name']}"],
                        "Live virtual trading — real (15-min delayed) quotes, "
                        "market/limit/stop orders, short selling and options.",
                        back=("Accounts", "/paper")),
            dcc.Store(id="paper-refresh", data=0),
            dcc.Store(id="paper-selected"),      # watchlist symbol for the detail chart
            dcc.Store(id="paper-selected-sector"),  # sector comparison selection
            dcc.Store(id="paper-opt-underlying"),
            dcc.Store(id="paper-opt-strike"),
            dcc.Store(id="paper-pending-txn"),   # transaction awaiting confirmation
            dcc.Store(id="paper-pending-delete"),  # watchlist/portfolio delete awaiting confirm
            dcc.Interval(id="paper-tick", interval=15000, n_intervals=0),
            # Play controls (status + market clock).
            html.Div(
                [
                    html.Span(id="paper-status"),
                    html.Span("● LIVE", id="paper-live-badge", className="paper-live"),
                    html.Span(id="paper-clock", className="paper-clock"),
                    dcc.Interval(id="paper-clock-tick", interval=1000, n_intervals=0),
                ],
                id="paper-play-row", className="invest-controls", style=_HIDDEN,
            ),
            html.Div(
                [
                    # ── Left card: manage + order ticket ─────────────────────
                    card(
                        [
                            html.H3("Manage", style={"marginTop": 0}),
                            dcc.RadioItems(id="paper-active", options=[], value=0,
                                           inline=True,
                                           labelStyle={"marginRight": "14px",
                                                       "cursor": "pointer"}),
                            html.Div(
                                [
                                    html.Button("+ Portfolio", id="paper-add-pf",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                    dcc.Input(id="paper-rename", type="text",
                                              placeholder="Rename active…",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "flex": "1",
                                                     "minWidth": "100px"}),
                                    html.Button("Rename", id="paper-rename-btn",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                    html.Button("Delete", id="paper-delete-pf-btn",
                                                n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.EXPENSE_COLOR,
                                                       "borderColor": theme.EXPENSE_COLOR}),
                                ],
                                style={**_FLEX, "marginTop": "8px"},
                            ),
                            html.Hr(),
                            html.H4("Capital", style={"margin": "0 0 8px"}),
                            html.Div(
                                [
                                    dcc.Input(id="paper-cash-amt", type="number", min=0,
                                              step="any", placeholder="$ amount",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "width": "110px"}),
                                    html.Button("Deposit", id="paper-deposit-btn",
                                                n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.INCOME_COLOR,
                                                       "borderColor": theme.INCOME_COLOR}),
                                    html.Button("Withdraw", id="paper-withdraw-btn",
                                                n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.EXPENSE_COLOR,
                                                       "borderColor": theme.EXPENSE_COLOR}),
                                ],
                                style={**_FLEX, "marginTop": "8px"},
                            ),
                            html.Hr(),
                            html.H4("Order ticket", style={"margin": "0 0 8px"}),
                            dcc.RadioItems(
                                id="paper-asset",
                                options=[{"label": "  Stock/ETF", "value": "stock"},
                                         {"label": "  Crypto", "value": "crypto"},
                                         {"label": "  Option", "value": "option"}],
                                value="stock", inline=True,
                                inputStyle={"marginRight": "4px"},
                                labelStyle={"marginRight": "12px", "cursor": "pointer"},
                            ),
                            html.Div(
                                [
                                    dcc.Input(id="paper-symbol", type="text",
                                              placeholder="Symbol (e.g. AAPL, BTC-USD)",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "flex": "1",
                                                     "minWidth": "150px"}),
                                    html.Button("Load chain", id="paper-load-chain",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                ],
                                style={**_FLEX, "marginTop": "8px"},
                            ),
                            # Option-only controls.
                            html.Div(
                                [
                                    _labelled("Expiry", dcc.Dropdown(
                                        id="paper-expiry", options=[],
                                        style={"minWidth": "150px"})),
                                    dcc.RadioItems(
                                        id="paper-right",
                                        options=[{"label": "  Call", "value": "call"},
                                                 {"label": "  Put", "value": "put"}],
                                        value="call", inline=True,
                                        inputStyle={"marginRight": "4px"},
                                        labelStyle={"marginRight": "10px",
                                                    "cursor": "pointer"}),
                                    html.Span(id="paper-contract-label",
                                              style={"fontSize": "13px",
                                                     "color": theme.ACCENT}),
                                ],
                                id="paper-option-row",
                                style={**_FLEX, "marginTop": "8px", "display": "none"},
                            ),
                            html.Div(
                                [
                                    dcc.RadioItems(
                                        id="paper-otype",
                                        options=[{"label": "  Market", "value": "market"},
                                                 {"label": "  Limit", "value": "limit"},
                                                 {"label": "  Stop", "value": "stop"},
                                                 {"label": "  Trailing", "value": "trailing"}],
                                        value="market", inline=True,
                                        inputStyle={"marginRight": "4px"},
                                        labelStyle={"marginRight": "12px",
                                                    "cursor": "pointer"}),
                                    html.Button("?", id="paper-otype-help", n_clicks=0,
                                                className="paper-help-btn",
                                                title="What do these order types mean?"),
                                ],
                                style={"marginTop": "10px", "display": "flex",
                                       "alignItems": "center", "gap": "6px",
                                       "flexWrap": "wrap"},
                            ),
                            html.Div(
                                [
                                    dcc.Input(id="paper-limit", type="number",
                                              placeholder="Limit $", min=0, step="any",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "width": "110px",
                                                     "display": "none"}),
                                    dcc.Input(id="paper-stop", type="number",
                                              placeholder="Stop $", min=0, step="any",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "width": "110px",
                                                     "display": "none"}),
                                    dcc.Input(id="paper-trail", type="number",
                                              placeholder="Trail %", min=0, step="any",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "width": "110px",
                                                     "display": "none"}),
                                ],
                                style={**_FLEX, "marginTop": "8px"},
                            ),
                            dcc.RadioItems(
                                id="paper-mode",
                                options=[{"label": "  Shares/Contracts", "value": "shares"},
                                         {"label": "  $ amount", "value": "dollars"}],
                                value="shares", inline=True,
                                inputStyle={"marginRight": "4px"},
                                labelStyle={"marginRight": "12px", "cursor": "pointer"},
                                style={"marginTop": "10px"},
                            ),
                            html.Div(
                                [
                                    dcc.Input(id="paper-qty", type="number", min=0,
                                              step="any", placeholder="Qty / $",
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "width": "100px"}),
                                    html.Button("Buy", id="paper-buy", n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.INCOME_COLOR,
                                                       "borderColor": theme.INCOME_COLOR}),
                                    html.Button("Sell / Short", id="paper-sell",
                                                n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.EXPENSE_COLOR,
                                                       "borderColor": theme.EXPENSE_COLOR}),
                                    html.Button("+ Watch", id="paper-add-watch",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                ],
                                style={**_FLEX, "marginTop": "10px"},
                            ),
                            html.Div(id="paper-msg",
                                     style={"fontSize": "13px", "marginTop": "8px",
                                            "minHeight": "18px"}),
                            html.Hr(),
                            html.H4("Pending orders", style={"margin": "0 0 8px"}),
                            html.Div(id="paper-orders"),
                            html.Hr(),
                            html.H4("Watchlist", style={"margin": "0 0 8px"}),
                            html.Div(id="paper-watch"),
                            html.Hr(),
                            html.Div(
                                [
                                    html.H4("Trade history", style={"margin": 0}),
                                    html.Button("View all", id="paper-history-open",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                ],
                                style={"display": "flex",
                                       "justifyContent": "space-between",
                                       "alignItems": "center",
                                       "marginBottom": "8px"},
                            ),
                            html.Div(id="paper-trades"),
                        ],
                        style={"flex": "0 0 420px"},
                    ),
                    # ── Right column: Positions box, then equity/detail box ──
                    html.Div(
                        [
                            # Box A — Positions (moved out of the left card).
                            card(
                                [
                                    html.Div(
                                        [
                                            html.H4("Positions", style={"margin": 0}),
                                            dcc.RadioItems(
                                                id="paper-pos-sort",
                                                options=[{"label": "Amount",
                                                          "value": "amount"},
                                                         {"label": "Sector",
                                                          "value": "sector"}],
                                                value="amount", inline=True,
                                                className="invest-range",
                                                inputStyle={"display": "none"},
                                                labelStyle={"cursor": "pointer"}),
                                        ],
                                        style={"display": "flex",
                                               "justifyContent": "space-between",
                                               "alignItems": "center",
                                               "marginBottom": "8px"},
                                    ),
                                    html.Div(id="paper-holdings"),
                                ],
                            ),
                            # Box B — equity chart + stats + chain + stock detail.
                            card(
                                [
                                    dcc.Graph(id="paper-graph",
                                              style={"height": "420px"},
                                              config=_GRAPH_CONFIG),
                                    html.Div(id="paper-stats",
                                             style={"marginTop": "12px"}),
                                    html.Div(
                                        [
                                            html.H4("Option chain",
                                                    style={"margin": "0 0 8px"}),
                                            html.Div(id="paper-chain"),
                                        ],
                                        id="paper-chain-wrap",
                                        style={"marginTop": "20px", "display": "none"},
                                    ),
                                    html.Div(
                                        [
                                            html.Div(
                                                [
                                                    dcc.RadioItems(
                                                        id="paper-range",
                                                        options=[{"label": r,
                                                                  "value": r}
                                                                 for r in _RANGES],
                                                        value="1D", inline=True,
                                                        className="invest-range",
                                                        inputStyle={"display": "none"},
                                                        labelStyle={"cursor": "pointer"}),
                                                    # Right group: chart-type box +
                                                    # fullscreen button (outside box).
                                                    html.Div(
                                                        [
                                                            html.Div(
                                                                dcc.RadioItems(
                                                                    id="paper-chart-type",
                                                                    options=[
                                                                        {"label": "Line",
                                                                         "value": "line"},
                                                                        {"label": "Candle",
                                                                         "value": "candle"}],
                                                                    value="candle",
                                                                    inline=True,
                                                                    className="invest-range",
                                                                    inputStyle={"display": "none"},
                                                                    labelStyle={"cursor": "pointer"}),
                                                                id="paper-charttype-wrap",
                                                                className="chart-type-box"),
                                                            html.Button(
                                                                "⛶", id="paper-fs-enter",
                                                                className="paper-fs-btn invest-tip",
                                                                **{"data-tip": "Full Screen"}),
                                                            html.Button(
                                                                "✕", id="paper-fs-exit",
                                                                className="paper-fs-btn paper-fs-exit invest-tip",
                                                                **{"data-tip": "Exit Full Screen"}),
                                                        ],
                                                        style={"display": "flex",
                                                               "alignItems": "center",
                                                               "gap": "8px"},
                                                    ),
                                                ],
                                                style={"display": "flex",
                                                       "justifyContent": "space-between",
                                                       "alignItems": "center",
                                                       "flexWrap": "wrap", "gap": "8px"},
                                            ),
                                            dcc.Graph(id="paper-stock-graph",
                                                      style={"height": "340px"},
                                                      config=_GRAPH_CONFIG),
                                            dcc.Store(id="paper-fs-dummy"),
                                            html.Div(id="paper-stock-metrics",
                                                     style={"marginTop": "10px"}),
                                        ],
                                        id="paper-stock-wrap",
                                        style={"marginTop": "20px", "display": "none"},
                                    ),
                                ],
                            ),
                        ],
                        style={"flex": "1", "marginLeft": "20px", "display": "flex",
                               "flexDirection": "column", "gap": "20px"},
                    ),
                ],
                id="paper-main", className="invest-main", style=_HIDDEN,
            ),
            # Transaction confirmation modal (guardrail before any money moves).
            html.Div(
                html.Div(
                    [
                        html.H3("Confirm transaction"),
                        html.Div(id="paper-confirm-body",
                                 style={"margin": "8px 0 4px", "lineHeight": "1.7"}),
                        html.Div(
                            [
                                html.Button("Confirm", id="paper-confirm-yes",
                                            n_clicks=0, style=theme.BUTTON_STYLE),
                                html.Button("Cancel", id="paper-confirm-no",
                                            n_clicks=0, style=theme.PERIOD_BUTTON_STYLE),
                            ],
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card",
                ),
                id="paper-confirm-modal", className="modal-overlay", style=_HIDDEN,
            ),
            # Delete confirmation modal (watchlist symbol or whole portfolio).
            html.Div(
                html.Div(
                    [
                        html.H3("Confirm delete"),
                        html.Div(id="paper-delete-body",
                                 style={"margin": "8px 0 4px", "lineHeight": "1.7"}),
                        html.Div(
                            [
                                html.Button("Delete", id="paper-delete-yes",
                                            n_clicks=0,
                                            style={**theme.BUTTON_STYLE,
                                                   "background": theme.EXPENSE_COLOR,
                                                   "borderColor": theme.EXPENSE_COLOR}),
                                html.Button("Cancel", id="paper-delete-no",
                                            n_clicks=0, style=theme.PERIOD_BUTTON_STYLE),
                            ],
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card",
                ),
                id="paper-delete-modal", className="modal-overlay", style=_HIDDEN,
            ),
            # Order-type help modal (educational — definitions + example scenarios).
            html.Div(
                html.Div(
                    [
                        html.H3("Order types explained"),
                        _help_entry(
                            "Market",
                            "Executes immediately at the current market price.",
                            "“Buy 5 AAPL at market” fills right away at ≈ the live "
                            "price. Use it when getting in/out now matters more than "
                            "the exact price."),
                        _help_entry(
                            "Limit",
                            "Executes only at your price or better; waits otherwise.",
                            "AAPL trades at $300. A buy-limit at $290 fills only if "
                            "the price drops to $290 or less (buying a dip). A "
                            "sell-limit at $320 fills only at $320 or more (taking "
                            "profit at your target)."),
                        _help_entry(
                            "Stop",
                            "Dormant until the price crosses your trigger, then "
                            "executes at market.",
                            "You bought AAPL at $300. A sell-stop at $280 (a "
                            "“stop-loss”) sells automatically if it falls to $280, "
                            "capping your loss. A buy-stop at $315 buys only if the "
                            "price breaks out upward through $315."),
                        _help_entry(
                            "Trailing",
                            "A stop that follows the price by a set percent and only "
                            "ratchets in your favour.",
                            "You bought at $300 with a 10% sell-trailing stop. The "
                            "price runs to $350, so the stop rides up to $315 "
                            "(350 − 10%). If the price then falls 10% from its peak, "
                            "you sell — profit locked in, upside left open."),
                        html.P("Note: pending orders here are checked against "
                               "~15-min-delayed quotes on each refresh tick, so fills "
                               "can lag the exact trigger moment.",
                               style={"color": theme.MUTED, "fontSize": "12px",
                                      "marginTop": "10px"}),
                        html.Div(
                            html.Button("Close", id="paper-help-close", n_clicks=0,
                                        style=theme.BUTTON_STYLE),
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card",
                ),
                id="paper-help-modal", className="modal-overlay", style=_HIDDEN,
            ),
            # Full trade-history modal (scrollable; filled on open).
            html.Div(
                html.Div(
                    [
                        html.H3("Trade history — all transactions"),
                        html.Div(id="paper-history-full",
                                 className="paper-history-scroll"),
                        html.Div(
                            html.Button("Hide trade history",
                                        id="paper-history-close", n_clicks=0,
                                        style=theme.BUTTON_STYLE),
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card paper-history-card",
                ),
                id="paper-history-modal", className="modal-overlay", style=_HIDDEN,
            ),
        ],
        style=theme.PAGE_STYLE,
    )


# ── Mutation callbacks ────────────────────────────────────────────────────────

# Step 1 of every money-moving action: build a preview and OPEN the confirm modal.
# Nothing is executed here. (A $0 new-portfolio is pure setup, so it skips the popup.)
@callback(
    Output("paper-confirm-modal", "style"),
    Output("paper-confirm-body", "children"),
    Output("paper-pending-txn", "data"),
    Output("paper-msg", "children", allow_duplicate=True),
    Output("paper-refresh", "data", allow_duplicate=True),
    Input("paper-buy", "n_clicks"),
    Input("paper-sell", "n_clicks"),
    Input("paper-deposit-btn", "n_clicks"),
    Input("paper-withdraw-btn", "n_clicks"),
    Input("paper-add-pf", "n_clicks"),
    State("paper-asset", "value"),
    State("paper-symbol", "value"),
    State("paper-expiry", "value"),
    State("paper-right", "value"),
    State("paper-opt-strike", "data"),
    State("paper-otype", "value"),
    State("paper-mode", "value"),
    State("paper-qty", "value"),
    State("paper-limit", "value"),
    State("paper-stop", "value"),
    State("paper-trail", "value"),
    State("paper-cash-amt", "value"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _preview(_b, _s, _d, _w, _pf, asset, symbol, expiry, right, strike, otype, mode,
             qty, limit, stop, trail, cash_amt, refresh):
    state = P.load_state()
    if not state:
        raise PreventUpdate
    trig = ctx.triggered_id
    try:
        if trig == "paper-add-pf":               # new portfolios open empty ($0)
            P.add_portfolio(state, 0)
            return _HIDDEN, no_update, None, "", (refresh or 0) + 1
        elif trig in ("paper-deposit-btn", "paper-withdraw-btn"):
            op = "deposit" if trig == "paper-deposit-btn" else "withdraw"
            pend = P.preview_cash(state, op, cash_amt)
        else:                                    # buy / sell
            side = "buy" if trig == "paper-buy" else "sell"
            spec = {"kind": asset, "side": side, "otype": otype, "mode": mode,
                    "qty": qty, "limit": limit, "stop": stop, "trail": trail}
            if asset == "option":
                spec.update({"underlying": symbol, "expiry": expiry, "right": right,
                             "strike": strike})
            else:
                spec["symbol"] = symbol
            pend = P.preview_order(state, spec)
    except P.TradeError as exc:
        return _HIDDEN, no_update, None, str(exc), no_update
    return {"display": "flex"}, _confirm_body(pend), pend, "", no_update


# Step 2: execute (Confirm) or discard (Cancel) the pending transaction.
@callback(
    Output("paper-confirm-modal", "style", allow_duplicate=True),
    Output("paper-refresh", "data", allow_duplicate=True),
    Output("paper-msg", "children", allow_duplicate=True),
    Output("paper-pending-txn", "data", allow_duplicate=True),
    Output("paper-qty", "value"),
    Output("paper-cash-amt", "value"),
    Input("paper-confirm-yes", "n_clicks"),
    Input("paper-confirm-no", "n_clicks"),
    State("paper-pending-txn", "data"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _confirm(_yes, _no, pend, refresh):
    if ctx.triggered_id == "paper-confirm-no" or not pend:
        return _HIDDEN, no_update, no_update, None, no_update, no_update
    state = P.load_state()
    if not state:
        raise PreventUpdate
    try:
        if pend["kind"] == "cash":
            fn = P.deposit if pend["op"] == "deposit" else P.withdraw
            fn(state, state["active"], pend["amount"])
            verb = "Deposited" if pend["op"] == "deposit" else "Withdrew"
            msg = f"{verb} {pend['amount']:,.2f}"
        else:                                    # trade
            msg = P.place_order(state, pend["spec"])
    except P.TradeError as exc:
        return _HIDDEN, no_update, str(exc), None, no_update, no_update
    return _HIDDEN, (refresh or 0) + 1, msg, None, None, None


@callback(
    Output("paper-refresh", "data", allow_duplicate=True),
    Output("paper-msg", "children", allow_duplicate=True),
    Output("paper-rename", "value"),
    Input("paper-rename-btn", "n_clicks"),
    State("paper-rename", "value"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _rename(_n, name, refresh):
    state = P.load_state()
    if not state:
        raise PreventUpdate
    try:
        P.rename_portfolio(state, state["active"], name)
    except P.TradeError as exc:
        return no_update, str(exc), no_update
    return (refresh or 0) + 1, "", ""


@callback(
    Output("paper-refresh", "data", allow_duplicate=True),
    Input("paper-active", "value"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _set_active(idx, refresh):
    state = P.load_state()
    if not state or idx is None or idx == state.get("active"):
        raise PreventUpdate
    P.set_active(state, int(idx))
    return (refresh or 0) + 1


@callback(
    Output("paper-refresh", "data", allow_duplicate=True),
    Output("paper-msg", "children", allow_duplicate=True),
    Input("paper-add-watch", "n_clicks"),
    State("paper-symbol", "value"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _add_watch(_n, symbol, refresh):
    state = P.load_state()
    if not state:
        raise PreventUpdate
    try:
        P.add_watch(state, symbol)
    except P.TradeError as exc:
        return no_update, str(exc)
    return (refresh or 0) + 1, ""


@callback(
    Output("paper-refresh", "data", allow_duplicate=True),
    Input({"type": "paper-cancel", "oid": ALL}, "n_clicks"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _cancel(clicks, refresh):
    if not any(clicks or []):
        raise PreventUpdate
    state = P.load_state()
    if not state:
        raise PreventUpdate
    P.cancel_order(state, ctx.triggered_id["oid"])
    return (refresh or 0) + 1


# ── Selection / option-chain callbacks ────────────────────────────────────────

@callback(
    Output("paper-selected", "data"),
    Output("paper-selected-sector", "data", allow_duplicate=True),
    Output("paper-delete-modal", "style", allow_duplicate=True),
    Output("paper-delete-body", "children", allow_duplicate=True),
    Output("paper-pending-delete", "data", allow_duplicate=True),
    Output("paper-symbol", "value"),
    Input({"type": "paper-watch-row", "ticker": ALL}, "n_clicks"),
    Input({"type": "paper-unwatch", "ticker": ALL}, "n_clicks"),
    Input({"type": "paper-pos-row", "ticker": ALL}, "n_clicks"),
    State("paper-selected", "data"),
    State("paper-asset", "value"),
    prevent_initial_call=True,
)
def _watch_click(row_clicks, unwatch_clicks, pos_clicks, current, asset):
    """Row click (watchlist or a held position) selects a stock; the watchlist ✕ asks
    to remove it. A ✕ click bubbles into the row's n_clicks too, so both patterns
    arrive in one request — the unwatch action takes priority and opens the popup.
    Selecting a stock also fills the order-ticket Symbol so Buy/Sell targets it — unless
    the user is mid-way through an Option order (loaded a chain for another ticker)."""
    if not any(row_clicks or []) and not any(unwatch_clicks or []) \
            and not any(pos_clicks or []):
        raise PreventUpdate
    import json as _json
    unwatch = next((_json.loads(t["prop_id"].rsplit(".", 1)[0])["ticker"]
                    for t in ctx.triggered
                    if '"paper-unwatch"' in t["prop_id"] and t["value"]), None)
    if unwatch:                                  # open delete confirmation
        pend = {"kind": "watch", "ticker": unwatch, "was_selected": current == unwatch}
        body = html.Div([html.Span("Remove "), _bold(unwatch),
                         html.Span(" from your watchlist? Your holdings are not "
                                   "affected.")])
        return no_update, no_update, {"display": "flex"}, body, pend, no_update
    tk = ctx.triggered_id["ticker"]
    # Toggle stock selection; a stock selection clears any sector comparison. On a fresh
    # selection (not a deselect) also target it in the order ticket, unless an Option
    # order is being built for a different underlying.
    sym = tk if (tk != current and asset != "option") else no_update
    return (None if tk == current else tk), None, no_update, no_update, no_update, sym


@callback(
    Output("paper-delete-modal", "style", allow_duplicate=True),
    Output("paper-delete-body", "children", allow_duplicate=True),
    Output("paper-pending-delete", "data", allow_duplicate=True),
    Output("paper-msg", "children", allow_duplicate=True),
    Input("paper-delete-pf-btn", "n_clicks"),
    prevent_initial_call=True,
)
def _delete_pf_prompt(_n):
    """Ask to delete the active portfolio (guarded: never the last one)."""
    state = P.load_state()
    if not state:
        raise PreventUpdate
    if len(state["portfolios"]) <= 1:
        return no_update, no_update, no_update, "Can't delete the only portfolio."
    pf = state["portfolios"][state["active"]]
    pend = {"kind": "portfolio", "idx": state["active"], "name": pf["name"]}
    body = html.Div([html.Span("Delete portfolio "), _bold(pf["name"]),
                     html.Span(" and all its holdings & history? "),
                     html.Span("This cannot be undone.",
                               style={"color": theme.EXPENSE_COLOR})])
    return {"display": "flex"}, body, pend, ""


@callback(
    Output("paper-delete-modal", "style", allow_duplicate=True),
    Output("paper-refresh", "data", allow_duplicate=True),
    Output("paper-msg", "children", allow_duplicate=True),
    Output("paper-pending-delete", "data", allow_duplicate=True),
    Output("paper-selected", "data", allow_duplicate=True),
    Input("paper-delete-yes", "n_clicks"),
    Input("paper-delete-no", "n_clicks"),
    State("paper-pending-delete", "data"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _delete_confirm(_yes, _no, pend, refresh):
    if ctx.triggered_id == "paper-delete-no" or not pend:
        return _HIDDEN, no_update, no_update, None, no_update
    state = P.load_state()
    if not state:
        raise PreventUpdate
    try:
        if pend["kind"] == "watch":
            P.remove_watch(state, pend["ticker"])
            msg = f"Removed {pend['ticker']} from watchlist"
            sel = None if pend.get("was_selected") else no_update
        else:                                    # portfolio
            P.delete_portfolio(state, pend["idx"])
            msg = f"Deleted portfolio {pend['name']}"
            sel = no_update
    except P.TradeError as exc:
        return _HIDDEN, no_update, str(exc), None, no_update
    return _HIDDEN, (refresh or 0) + 1, msg, None, sel


@callback(
    Output("paper-selected-sector", "data"),
    Output("paper-selected", "data", allow_duplicate=True),
    Input({"type": "paper-sector-head", "sector": ALL}, "n_clicks"),
    State("paper-selected-sector", "data"),
    prevent_initial_call=True,
)
def _select_sector(clicks, current):
    if not any(clicks or []):
        raise PreventUpdate
    sec = ctx.triggered_id["sector"]
    return (None if sec == current else sec), None  # toggle sector, clear stock


@callback(
    Output("paper-history-modal", "style"),
    Output("paper-history-full", "children"),
    Input("paper-history-open", "n_clicks"),
    Input("paper-history-close", "n_clicks"),
    prevent_initial_call=True,
)
def _history_toggle(_open, _close):
    if ctx.triggered_id == "paper-history-close":
        return _HIDDEN, no_update
    state = P.load_state()
    if not state:
        raise PreventUpdate
    return {"display": "flex"}, _trades_table(state, limit=None)


@callback(
    Output("paper-opt-underlying", "data"),
    Output("paper-expiry", "options"),
    Output("paper-expiry", "value"),
    Output("paper-msg", "children", allow_duplicate=True),
    Input("paper-load-chain", "n_clicks"),
    State("paper-symbol", "value"),
    prevent_initial_call=True,
)
def _load_chain(_n, symbol):
    symbol = (symbol or "").strip().upper()
    if not symbol:
        return no_update, no_update, no_update, "Enter an underlying symbol first."
    exps = Q.option_expirations(symbol)
    if not exps:
        return no_update, [], None, f"No listed options for {symbol}."
    opts = [{"label": e, "value": e} for e in exps]
    return symbol, opts, exps[0], ""


@callback(
    Output("paper-opt-strike", "data"),
    Input({"type": "paper-strike", "strike": ALL}, "n_clicks"),
    State("paper-opt-strike", "data"),
    prevent_initial_call=True,
)
def _select_strike(clicks, current):
    if not any(clicks or []):
        raise PreventUpdate
    strike = ctx.triggered_id["strike"]
    return None if current == strike else strike


# Toggle option-only row + which conditional price input shows.
@callback(
    Output("paper-option-row", "style"),
    Output("paper-limit", "style"),
    Output("paper-stop", "style"),
    Output("paper-trail", "style"),
    Input("paper-asset", "value"),
    Input("paper-otype", "value"),
)
def _toggle_inputs(asset, otype):
    def price(width, show):
        return {**theme.INPUT_STYLE, "marginBottom": 0, "width": width,
                "display": "block" if show else "none"}
    opt_row = {**_FLEX, "marginTop": "8px",
               "display": "flex" if asset == "option" else "none"}
    return (opt_row, price("110px", otype == "limit"),
            price("110px", otype == "stop"), price("110px", otype == "trailing"))


# ── Market clock (client-side, ticks every second; no server load) ────────────
# Shows NYSE wall-clock time in US Eastern and the current session. Holidays are a
# static list — refresh once a year.
clientside_callback(
    """
    function (n) {
        var now = new Date();
        var et = new Date(now.toLocaleString('en-US', {timeZone: 'America/New_York'}));
        var pad = function (x) { return (x < 10 ? '0' : '') + x; };
        var t = pad(et.getHours()) + ':' + pad(et.getMinutes()) + ':' + pad(et.getSeconds());
        var key = et.getFullYear() + '-' + (et.getMonth() + 1) + '-' + et.getDate();
        var HOL = {'2026-1-1':1,'2026-1-19':1,'2026-2-16':1,'2026-4-3':1,
                   '2026-5-25':1,'2026-6-19':1,'2026-7-3':1,'2026-9-7':1,
                   '2026-11-26':1,'2026-12-25':1};
        var dow = et.getDay(), mins = et.getHours() * 60 + et.getMinutes(), s;
        if (dow === 0 || dow === 6 || HOL[key]) { s = 'Closed'; }
        else if (mins >= 570 && mins < 960) { s = 'Open'; }        // 9:30–16:00
        else if (mins >= 240 && mins < 570) { s = 'Pre-market'; }  // 4:00–9:30
        else if (mins >= 960 && mins < 1200) { s = 'After-hours'; }// 16:00–20:00
        else { s = 'Closed'; }
        return '🕒 NYSE ' + t + ' ET · ' + s;
    }
    """,
    Output("paper-clock", "children"),
    Input("paper-clock-tick", "n_intervals"),
)


# ── Maximize toggle for the stock chart (in-app overlay, keeps all controls) ───
clientside_callback(
    """
    function (nEnter, nExit) {
        var w = document.getElementById('paper-stock-wrap');
        if (w) {
            w.classList.toggle('maximized');
            // Nudge Plotly to refit once the box has resized.
            setTimeout(function () {
                window.dispatchEvent(new Event('resize'));
            }, 120);
        }
        return window.dash_clientside.no_update;
    }
    """,
    Output("paper-fs-dummy", "data"),
    Input("paper-fs-enter", "n_clicks"),
    Input("paper-fs-exit", "n_clicks"),
    prevent_initial_call=True,
)


# ── Order-type help modal toggle ──────────────────────────────────────────────

@callback(
    Output("paper-help-modal", "style"),
    Input("paper-otype-help", "n_clicks"),
    Input("paper-help-close", "n_clicks"),
    prevent_initial_call=True,
)
def _help_toggle(_open, _close):
    return {"display": "flex"} if ctx.triggered_id == "paper-otype-help" else _HIDDEN


# ── Live tick: process pending orders + snapshot equity, then re-render ────────

@callback(
    Output("paper-refresh", "data", allow_duplicate=True),
    Input("paper-tick", "n_intervals"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _tick(_n, refresh):
    state = P.load_state()
    if not state:
        raise PreventUpdate
    P.refresh(state)
    return (refresh or 0) + 1


# ── Master render ─────────────────────────────────────────────────────────────

@callback(
    Output("paper-play-row", "style"),
    Output("paper-main", "style"),
    Output("paper-status", "children"),
    Output("paper-active", "options"),
    Output("paper-active", "value"),
    Output("paper-holdings", "children"),
    Output("paper-orders", "children"),
    Output("paper-watch", "children"),
    Output("paper-stats", "children"),
    Output("paper-graph", "figure"),
    Output("paper-chain-wrap", "style"),
    Output("paper-chain", "children"),
    Output("paper-contract-label", "children"),
    Output("paper-stock-wrap", "style"),
    Output("paper-stock-graph", "figure"),
    Output("paper-stock-metrics", "children"),
    Output("paper-trades", "children"),
    Output("paper-graph", "style"),
    Output("paper-stats", "style"),
    Output("paper-charttype-wrap", "style"),
    Output("paper-chart-type", "options"),
    Input("paper-refresh", "data"),
    Input("paper-selected", "data"),
    Input("paper-selected-sector", "data"),
    Input("paper-asset", "value"),
    Input("paper-opt-underlying", "data"),
    Input("paper-expiry", "value"),
    Input("paper-right", "value"),
    Input("paper-opt-strike", "data"),
    Input("paper-range", "value"),
    Input("theme-store", "data"),
    Input("paper-pos-sort", "value"),
    Input("paper-chart-type", "value"),
)
def _render(_refresh, selected, sel_sector, asset, opt_under, expiry, right, strike,
            rng, theme_value, pos_sort, chart_type):
    state = P.load_state()
    if not state:                                # account was deleted mid-session
        raise PreventUpdate
    dark = theme.is_dark(theme_value)

    main_style = {"display": "flex", "alignItems": "flex-start", "marginTop": "16px"}
    series = {pf["name"]: P.equity_series(pf) for pf in state["portfolios"]}
    # Faint dotted principal (net capital put in) per portfolio, colour-matched to
    # its equity line; the benchmark anchors to the active portfolio's basis inside
    # spx_benchmark (0 for an unfunded account, so it's simply omitted).
    principal = {pf["name"]: P.principal_series(pf) for pf in state["portfolios"]}
    fig = build_equity_figure(series, P.spx_benchmark(state), principal, dark)
    active_opts = [{"label": f"  {pf['name']}", "value": i}
                   for i, pf in enumerate(state["portfolios"])]

    # Option chain panel (only in Option mode).
    if asset == "option" and opt_under and expiry:
        chain_wrap = {"marginTop": "20px", "display": "block"}
        chain = _chain_table(opt_under, expiry, right, strike)
        price = Q.option_price(opt_under, expiry, right, strike) if strike else None
        label = (f"Contract: {opt_under} {expiry} "
                 f"{'C' if right == 'call' else 'P'}{float(strike):g}"
                 + (f" @ ${price:,.2f}" if price else "")) if strike else ""
    else:
        chain_wrap, chain, label = _HIDDEN, None, ""

    # Detail panel: sector comparison, single stock, or hidden.
    rng = rng or "1Y"
    marks = {sym: c.get("mark") for sym, c in state.get("quote_cache", {}).items()}
    sec_tks = P.sector_watch_tickers(state, sel_sector) if sel_sector else []
    shown = {"marginTop": "20px", "display": "block"}
    if sel_sector and sel_sector != "Unknown" and sec_tks:  # sector comparison
        colors = cubehelix_colors(len(sec_tks), dark)
        sdict = {t: _history(t, rng) for t in sec_tks}
        stock_wrap = shown
        stock_fig = build_sector_figure(sel_sector, sdict, dark, colors=colors,
                                        gapless_intraday=(rng == "5D"))
        metrics = _sector_metrics_table(sec_tks, colors, marks)
    elif selected:                                # single stock (price + volume)
        df = _history_ohlcv(selected, rng)
        stock_wrap = shown
        # Candle only for ≤1Y; long ranges fall back to a line (chip disabled below).
        eff = "candle" if (chart_type == "candle" and rng not in _NO_CANDLE) else "line"
        # 1D: pin the x-axis to the regular US session (9:30–16:00 ET) so it spans
        # open→close even before the day is over. Detect a regular session by the first
        # 1-minute bar being 09:30 (crypto / 24h instruments start elsewhere → skip).
        xrange = yrange = None
        if rng == "1D" and len(df):
            first = df.index[0]
            if first.hour == 9 and first.minute == 30:
                day = first.normalize()
                xrange = [day + pd.Timedelta(hours=9, minutes=30),
                          day + pd.Timedelta(hours=16)]
                # Early session (< 2h in): a few minutes of data give a tiny, jumpy
                # y-range. Base it on the previous trading day's High/Low instead,
                # expanding only if today's price moves outside that band.
                if df.index[-1] - first < pd.Timedelta(hours=2):
                    daily = Q.ohlcv(selected, period="5d", interval="1d")
                    prev = daily[daily.index.normalize() < day] if len(daily) else daily
                    if len(prev):
                        lo = min(float(prev["Low"].iloc[-1]), float(df["Low"].min()))
                        hi = max(float(prev["High"].iloc[-1]), float(df["High"].max()))
                        pad = (hi - lo) * 0.04 or 1.0
                        yrange = [lo - pad, hi + pad]
        stock_fig = build_price_figure(selected, df, eff, dark,
                                       gapless_intraday=(rng == "5D"),
                                       intraday=(rng in _INTRADAY),
                                       xrange=xrange, yrange=yrange)
        close = df["Close"] if len(df) else pd.Series(dtype=float)
        price = marks.get(selected) or (float(close.iloc[-1]) if len(close) else None)
        metrics = _stock_metrics_table(selected, price) if price else None
    else:
        stock_wrap = _HIDDEN
        stock_fig = build_equity_figure({}, None, {}, dark)
        metrics = None

    # Stock/sector detail replaces the account view: hide the equity chart + stats
    # while a symbol is selected; restore them (default view) otherwise.
    show_detail = stock_wrap.get("display") == "block"
    graph_style = _HIDDEN if show_detail else {"height": "420px"}
    stats_style = _HIDDEN if show_detail else {"marginTop": "12px"}
    # Line/Candle toggle only for a single stock (not the sector comparison).
    charttype_style = ({"display": "inline-flex"} if (selected and not sel_sector)
                       else _HIDDEN)
    _lock_static(fig)          # paper-graph (equity)
    _lock_static(stock_fig)    # paper-stock-graph (sector / single stock)
    chart_type_options = [
        {"label": "Line", "value": "line"},
        {"label": "Candle", "value": "candle", "disabled": rng in _NO_CANDLE},
    ]

    return (
        {"display": "flex"}, main_style,
        _status_text(state), active_opts, state["active"],
        _holdings_table(state, selected, pos_sort or "amount"), _orders_table(state),
        _watch_table(state, selected, sel_sector),
        _stats_table(state), fig, chain_wrap, chain, label, stock_wrap, stock_fig,
        metrics, _trades_table(state), graph_style, stats_style, charttype_style,
        chart_type_options,
    )


@callback(
    Output("paper-chart-type", "value"),
    Input("paper-range", "value"),
    State("paper-chart-type", "value"),
    prevent_initial_call=True,
)
def _force_line_long_range(rng, current):
    """Drop back to Line when switching to a range where Candle is unavailable, so the
    chip highlight matches the rendered line."""
    if rng in _NO_CANDLE and current == "candle":
        return "line"
    raise PreventUpdate
