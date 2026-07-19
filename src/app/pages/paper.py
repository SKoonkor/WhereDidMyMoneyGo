"""Paper Trading — a live virtual-money trading simulator.

Trade stocks, ETFs, crypto and single-leg options at near-real-time quotes with
a fake account (default $100,000). Supports market / limit / stop / trailing-stop
orders, short selling and a benchmark against the S&P 500. Shares the Investment
Simulator's two-card layout. State persists to config/paper_trading.json.
"""

from __future__ import annotations

import time

from dash import (dcc, html, callback, clientside_callback, Input, Output, State,
                  ctx, no_update, ALL, register_page)
from dash.exceptions import PreventUpdate
import pandas as pd

from src.app import theme
from src.app.components import page_header, card, landscape_chart, LANDSCAPE_JS
from src.app.i18n import make_t
from src.app.figures.paper import build_equity_figure
from src.app.figures.investment import (build_price_figure, build_sector_figure,
                                        cubehelix_colors)
# Shared multiples row-spec + hover texts (module outside pages/ — importing a
# page module here would double-register its route and break Dash).
from src.app.metrics import METRICS as _INV_METRICS, METRIC_TIPS as _INV_TIPS
from src.io import quotes as Q
from src.io import stocks as S
from src.analytics import paper as P

t = make_t("paper")

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
        html.Span(t("Equity ${amount}").format(amount=_money(s['value'])),
                  style={"fontWeight": 700}),
        html.Span(t("  ·  Today "), style={"color": theme.MUTED}),
        html.Span(f"{s['day_d']:+,.2f} ({s['day_p']:+.2f}%)",
                  className=_pl_class(s["day_d"])),
        html.Span(t("  ·  Total "), style={"color": theme.MUTED}),
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
        return html.Th(t(label))
    return html.Th(t(label), className="invest-tip", **{"data-tip": t(tip)})


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
        # Labels stay English here; _tip_th() translates them (and their tips).
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
        short = t(" (short)") if r["qty"] < 0 else ""
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
        body = [html.Tr(html.Td(t("No open positions."), colSpan=6,
                                style={"color": theme.MUTED}))]
    elif sort_mode == "sector":
        groups: dict[str, list] = {}
        for r in rows_data:
            groups.setdefault(r.get("sector") or "Unknown", []).append(r)
        for sec in sorted(groups, key=lambda s: -sum(abs(x["value"]) for x in groups[s])):
            # Indented so the header reads as a group label, not a stock row.
            body.append(html.Tr(html.Td(t(sec), colSpan=6,
                                        style={"paddingLeft": "18px"}),
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
                                  style={"background": _sector_color(s)}), t(s)])
             for s in sorted(totals, key=lambda s: -totals[s])],
            className="pos-legend")

    pf = state["portfolios"][state["active"]]
    foot = html.Tr([html.Td(t("Cash"), colSpan=4),
                    html.Td(_money(pf["cash"]), colSpan=2)], className="invest-foot")
    total = html.Tr([html.Td(t("Equity"), colSpan=4),
                     html.Td(_money(P.equity(pf)), colSpan=2)],
                    className="invest-foot total")
    table = html.Table([html.Thead(header_row()), html.Tbody(body + [foot, total])],
                       className="invest-table")
    return html.Div([table, legend]) if legend is not None else html.Div(table)


def header_row() -> html.Tr:
    return html.Tr([html.Th(t(l)) for l in
                    ("Position", "Qty", "Avg", "Price", "Value", "P/L")])


def _orders_table(state: dict) -> html.Div | None:
    pf = state["portfolios"][state["active"]]
    orders = P.open_orders(pf)
    if not orders:
        return html.Div(t("No pending orders."), style={"color": theme.MUTED,
                                                      "fontSize": "13px"})
    header = html.Tr([html.Th(t(l) if l else "")
                      for l in ("Order", "Type", "Trigger", "")])
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
                                title=t("Cancel order"))),
        ]))
    return html.Table([html.Thead(header), html.Tbody(rows)], className="invest-table")


def _watch_table(state: dict, selected: str | None,
                 sel_sector: str | None = None) -> html.Div | None:
    """Watchlist grouped by sector (Investing Simulator style): clickable sector
    headers, clickable stock rows, and a per-row ✕ that removes the symbol from
    the watchlist only (holdings untouched)."""
    rows_data = P.watch_rows(state)
    if not rows_data:
        return html.Div(t("Add tickers to watch live quotes."),
                        style={"color": theme.MUTED, "fontSize": "13px"})
    header = html.Tr([html.Th(t(l) if l else "")
                      for l in ("Ticker", "Last", "Chg", "Chg %", "")])
    rows = []
    current_sector = None
    for r in rows_data:
        if r["sector"] != current_sector:        # sector group header
            current_sector = r["sector"]
            # Indented so the header reads as a group label, not a ticker row.
            indent = {"paddingLeft": "18px"}
            if current_sector == "Unknown":
                rows.append(html.Tr(html.Td(t(current_sector), colSpan=5,
                                            style=indent),
                                    className="invest-sector-head"))
            else:
                hcls = "invest-sector-head invest-sector-click" + (
                    " selected" if current_sector == sel_sector else "")
                rows.append(html.Tr(
                    html.Td(current_sector, colSpan=5, style=indent),
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
                                title=t("Remove from watchlist (holdings unaffected)"))),
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
        return html.Th(t(label))
    return html.Th(t(label), className="invest-tip", **{"data-tip": t(tip)})


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
        return html.Div(t("No transactions yet."),
                        style={"color": theme.MUTED, "fontSize": "13px"})
    header = html.Tr([html.Th(t(l))
                      for l in ("When", "Action", "Qty", "Price", "Value")])
    rows = []
    for r in rows_data:
        when = (r["t"] or "")[5:16].replace("T", " ")   # MM-DD HH:MM
        side = t(r["side"].capitalize())
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
        return html.Div(t("Load an option chain to pick a contract."),
                        style={"color": theme.MUTED})
    try:
        chain = Q.option_chain(underlying, expiry)
    except S.StockError as exc:
        return html.Div(str(exc), style={"color": theme.EXPENSE_COLOR})
    side = chain["calls"] if right == "call" else chain["puts"]
    header = html.Tr([html.Th(t(l)) for l in
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
    # Scroll lives on the wrapper so the table keeps real table layout and
    # spreads its columns across the full box width. The permanent scroll
    # indicator is our own track+thumb (chain_scrollbar.js) — macOS overlay
    # scrollbars auto-hide and ignore styling, so a native bar can't be
    # trusted to stay visible.
    return html.Div(
        [
            html.Div(html.Table([html.Thead(header), html.Tbody(rows)],
                                className="invest-table paper-chain"),
                     className="paper-chain-scroll"),
            html.Div(html.Div(className="paper-scroll-thumb"),
                     className="paper-scroll-track"),
        ],
        className="paper-chain-outer")


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
        verb = t("Deposit") if pend["op"] == "deposit" else t("Withdraw")
        prep = t("into") if pend["op"] == "deposit" else t("from")
        return html.Div([html.Span(f"{verb} "), _bold(f"${pend['amount']:,.2f}"),
                         html.Span(f" {prep} {pend['pf_name']}.")])
    # trade
    action = t("Sell / Short") if pend.get("is_short") else t(pend["action"].capitalize())
    mult = pend["mult"]
    price, est, ap = pend["price"], pend["est"], ("~" if pend["approx"] else "")
    unit = t("contract") if pend["is_option"] else t("share")
    head = html.Div([html.Span(f"{action} "),
                     _bold(f"{pend['qty']:g} {pend['label']}"),
                     html.Span(t("  (×{mult} per contract)").format(mult=mult)
                               if mult != 1 else "")])
    lines = [head]
    # Company name under the qty/ticker line, in the same muted style as "per share".
    name = P.company_name(pend.get("symbol", ""))
    if name and name != pend["label"]:
        lines.append(html.Div(name, style={"color": theme.MUTED, "fontSize": "13px"}))
    if pend.get("is_short"):
        lines.append(html.Div(
            t("⚠ You hold {held} — this sell exceeds your position and will "
              "OPEN A SHORT of {short} {unit}(s).").format(
                  held=f"{pend.get('held', 0):g}",
                  short=f"{pend.get('short_qty', 0):g}", unit=unit),
            style={"color": theme.EXPENSE_COLOR, "fontWeight": 600,
                   "margin": "6px 0"}))
    if pend.get("queued_open"):
        lines.append(html.Div(
            t("Market is closed — this order will be queued and filled at "
              "the next open."),
            style={"color": theme.MUTED, "fontSize": "13px",
                   "margin": "6px 0"}))
    if pend["otype"] == "market":
        lines.append(html.Div(
            t("@ {ap}${price} per {unit}").format(
                ap=ap, price=f"{price:,.2f}", unit=unit) if price
            else t("at the current price"),
            style={"color": theme.MUTED, "fontSize": "13px"}))
        amt_label = t("Estimated cost") if pend["action"] == "buy" else t("Estimated proceeds")
        if est is not None:
            lines.append(html.Div([html.Span(f"{amt_label}: "),
                                   _bold(f"{ap}${est:,.2f}")]))
    else:
        trig = (t("limit ${price}").format(price=f"{price:,.2f}") if pend["otype"] == "limit"
                else t("stop ${price}").format(price=f"{price:,.2f}") if pend["otype"] == "stop"
                else t("trailing stop"))
        lines.append(html.Div(t("{otype} order — {trig}").format(
                                  otype=t(pend['otype'].capitalize()), trig=trig),
                              style={"color": theme.MUTED, "fontSize": "13px"}))
        if est is not None:
            lines.append(html.Div([html.Span(t("Est. amount when filled: ")),
                                   _bold(f"${est:,.2f}")]))
    return html.Div(lines)


def _ok(text) -> html.Div:
    """Success banner for paper-msg (prominent, green-tinted)."""
    return html.Div([html.Span("✓ "), html.Span(text)], className="paper-msg-ok")


def _err(text) -> html.Div:
    """Error/warning banner for paper-msg (prominent, red-tinted)."""
    return html.Div([html.Span("⚠ "), html.Span(text)], className="paper-msg-err")


def _help_entry(name: str, definition: str, example: str) -> html.Div:
    """One order-type block in the help modal: name, definition, example scenario."""
    return html.Div(
        [
            html.Div(t(name), style={"fontWeight": 700, "marginBottom": "2px"}),
            html.Div(t(definition), style={"fontSize": "13px"}),
            html.Div([t("Example: "), html.Em(t(example))],
                     style={"fontSize": "12.5px", "color": theme.MUTED,
                            "marginTop": "2px"}),
        ],
        style={"margin": "10px 0"},
    )


# ── Layout ────────────────────────────────────────────────────────────────────

# The ticket's number inputs are cleared by re-rendering FRESH instances into
# their holder divs (see _apply_ticket_reset) — never by server-pushing a value,
# which bricks a Dash 4.2 number input's keystroke propagation.

def _qty_input() -> dcc.Input:
    return dcc.Input(id="paper-qty", type="number", min=0, step="any",
                     placeholder=t("Qty / $"),
                     style={**theme.INPUT_STYLE, "marginBottom": 0,
                            "width": "170px"})


def _price_inputs() -> list:
    def price(pid, ph):
        return dcc.Input(id=pid, type="number", placeholder=ph, min=0,
                         step="any",
                         style={**theme.INPUT_STYLE, "marginBottom": 0,
                                "width": "110px", "display": "none"})
    return [price("paper-limit", t("Limit $")),
            price("paper-stop", t("Stop $")),
            price("paper-trail", t("Trail %"))]


def _labelled(label, comp):
    return html.Div([html.Span(t(label), style={"color": theme.MUTED,
                                             "fontSize": "13px",
                                             "marginRight": "6px"}), comp])


def layout(**_):
    # The account is chosen on the /paper picker; with none selected, go back there.
    state = P.load_state()
    if not state:
        return html.Div(dcc.Location(id="paper-redirect", href="/paper", refresh=True))
    return html.Div(
        [
            page_header([t("Paper Trading "),
                         html.Span(t("(Live Market Data)"), className="title-sub"),
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
            dcc.Store(id="paper-loaded"),        # last successfully loaded ticket symbol
            dcc.Store(id="paper-side"),          # buy/sell chosen in the order-entry dropdown
            dcc.Store(id="paper-mode"),          # qty mode; None until explicitly picked
            dcc.Store(id="paper-ticket-reset"),  # bump to reset the order ticket
            dcc.Interval(id="paper-tick", interval=15000, n_intervals=0),
            # Play controls (status + the outlined market-clock box).
            html.Div(
                [
                    html.Span(id="paper-status"),
                    html.Div(
                        [
                            html.Span(id="paper-market-status"),
                            html.Span(id="paper-clock", className="paper-clock"),
                            dcc.Checklist(
                                id="paper-hours",
                                options=[{"label": t(" Orders wait for "
                                                     "market open"),
                                          "value": "on"}],
                                value=(["on"] if state.get("market_hours_only")
                                       else []),
                                inputClassName="sq-tick",
                                style={"fontSize": "13px"},
                            ),
                            html.Button("i", id="paper-hours-help", n_clicks=0,
                                        className="paper-help-btn",
                                        title=t("What does market-hours mode do?")),
                            dcc.Interval(id="paper-clock-tick", interval=1000,
                                         n_intervals=0),
                        ],
                        className="paper-market-box",
                        style={"marginLeft": "auto"},
                    ),
                ],
                id="paper-play-row", className="invest-controls", style=_HIDDEN,
            ),
            html.Div(
                [
                    # ── Left column: Manage box on top, ordering box below ───
                    html.Div(
                        [
                    card(
                        [
                            html.H3(t("Manage"), style={"marginTop": 0}),
                            dcc.RadioItems(id="paper-active", options=[], value=0,
                                           inline=True,
                                           inputClassName="sq-tick",
                                           labelStyle={"marginRight": "14px",
                                                       "cursor": "pointer"}),
                            html.Div(
                                [
                                    html.Button(t("+ Portfolio"), id="paper-add-pf",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                    dcc.Input(id="paper-rename", type="text",
                                              placeholder=t("Rename active…"),
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "flex": "1",
                                                     "minWidth": "100px"}),
                                    html.Button(t("Rename"), id="paper-rename-btn",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                    html.Button(t("Delete"), id="paper-delete-pf-btn",
                                                n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.EXPENSE_COLOR,
                                                       "borderColor": theme.EXPENSE_COLOR}),
                                ],
                                style={**_FLEX, "marginTop": "8px"},
                            ),
                            html.Hr(),
                            html.Div(
                                [
                                    html.H4(t("Capital"), style={"margin": 0}),
                                    html.Span(id="paper-cash-line",
                                              style={"fontWeight": 600}),
                                ],
                                style={"display": "flex",
                                       "justifyContent": "space-between",
                                       "alignItems": "center",
                                       "marginBottom": "8px"},
                            ),
                            html.Div(
                                [
                                    dcc.Input(id="paper-cash-amt", type="number", min=0,
                                              step="any", placeholder=t("$ amount"),
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "width": "110px"}),
                                    html.Button(t("Deposit"), id="paper-deposit-btn",
                                                n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.INCOME_COLOR,
                                                       "borderColor": theme.INCOME_COLOR}),
                                    html.Button(t("Withdraw"), id="paper-withdraw-btn",
                                                n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.EXPENSE_COLOR,
                                                       "borderColor": theme.EXPENSE_COLOR}),
                                ],
                                style={**_FLEX, "marginTop": "8px"},
                            ),
                            # Feedback for Manage-box actions (portfolio ops,
                            # deposit/withdraw) — kept out of the Order ticket.
                            html.Div(id="paper-manage-msg",
                                     style={"marginTop": "8px"}),
                        ],
                        style={"marginBottom": "16px"},
                    ),
                    card(
                        [
                            html.H3(t("Order ticket"), style={"marginTop": 0}),
                            html.Div(
                                [
                                    dcc.RadioItems(
                                        id="paper-asset",
                                        # Crypto shares every code path with stocks
                                        # (same Yahoo quote API), so it's one box.
                                        options=[{"label": t("  Stock/ETF/Crypto"),
                                                  "value": "stock"},
                                                 {"label": t("  Option"), "value": "option"}],
                                        value="stock", inline=True,
                                        inputClassName="sq-tick",
                                        inputStyle={"marginRight": "4px"},
                                        labelStyle={"marginRight": "12px",
                                                    "cursor": "pointer"}),
                                    html.Button("?", id="paper-asset-help", n_clicks=0,
                                                className="paper-help-btn",
                                                title=t("What do these asset types mean?")),
                                ],
                                style={"display": "flex", "alignItems": "center",
                                       "gap": "6px", "flexWrap": "wrap"},
                            ),
                            html.Div(
                                [
                                    dcc.Input(id="paper-symbol", type="text",
                                              placeholder=t("Symbol (e.g. AAPL, BTC-USD)"),
                                              style={**theme.INPUT_STYLE,
                                                     "marginBottom": 0, "flex": "1",
                                                     "minWidth": "150px"}),
                                    html.Button(t("Load stock"), id="paper-load-chain",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                    html.Button(t("+ Watch"), id="paper-add-watch",
                                                n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "display": "none"}),
                                ],
                                style={**_FLEX, "marginTop": "8px"},
                            ),
                            html.Div(id="paper-msg", style={"marginTop": "8px"}),
                            # Option-only controls.
                            html.Div(
                                [
                                    _labelled("Expiry", dcc.Dropdown(
                                        id="paper-expiry", options=[],
                                        style={"minWidth": "150px"})),
                                    dcc.RadioItems(
                                        id="paper-right",
                                        options=[{"label": t("  Call"), "value": "call"},
                                                 {"label": t("  Put"), "value": "put"}],
                                        value="call", inline=True,
                                        inputClassName="sq-tick",
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
                            # Order controls stay hidden until a symbol is loaded
                            # (Load stock / Load chain, or a row click) — see
                            # _ticket_visibility.
                            html.Div(
                                [
                            # Loading above, order entry below.
                            html.Hr(),
                            html.H4(t("Order entry"), style={"margin": "0 0 2px"}),
                            html.Div(t("Buy or sell the loaded symbol, or close "
                                       "your whole position."),
                                     style={"color": theme.MUTED,
                                            "fontSize": "12.5px"}),
                            # Stage 1: held qty on its own full-width line, the
                            # Buy/Sell dropdown + Close underneath.
                            html.Div(id="paper-held-label",
                                     style={"fontSize": "17px", "fontWeight": 600,
                                            "whiteSpace": "nowrap", "width": "100%",
                                            "textAlign": "center",
                                            "margin": "10px 0 0"}),
                            html.Div(id="paper-held-value",
                                     style={"fontSize": "12.5px",
                                            "color": theme.MUTED,
                                            "textAlign": "center",
                                            "margin": "2px 0 0"}),
                            html.Div(
                                [
                                    html.Div(
                                        [
                                            html.Button(t("Buy / Sell") + " ▾",
                                                        id="paper-side-toggle",
                                                        n_clicks=0,
                                                        className="menu-btn"),
                                            html.Div(
                                                [
                                                    html.Button(t("Buy"),
                                                                id="paper-side-buy",
                                                                n_clicks=0,
                                                                className="dd-item"),
                                                    html.Button(t("Sell / Short"),
                                                                id="paper-side-sell",
                                                                n_clicks=0,
                                                                className="dd-item"),
                                                ],
                                                id="paper-side-dd",
                                                className="menu-dropdown",
                                                style={"display": "none"},
                                            ),
                                        ],
                                        style={"position": "relative"},
                                    ),
                                    html.Button(t("Close position"),
                                                id="paper-close-pos", n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "color": theme.EXPENSE_COLOR,
                                                       "borderColor": theme.EXPENSE_COLOR}),
                                ],
                                style={**_FLEX, "marginTop": "10px",
                                       "justifyContent": "center"},
                            ),
                            # Stage 2: revealed once Buy or Sell/Short is chosen.
                            html.Div(
                                [
                            html.Div(
                                [
                                    dcc.RadioItems(
                                        id="paper-otype",
                                        options=[{"label": t("  Market"), "value": "market"},
                                                 {"label": t("  Limit"), "value": "limit"},
                                                 {"label": t("  Stop"), "value": "stop"},
                                                 {"label": t("  Trailing"), "value": "trailing"}],
                                        value="market", inline=True,
                                        inputClassName="sq-tick",
                                        inputStyle={"marginRight": "4px"},
                                        labelStyle={"marginRight": "12px",
                                                    "cursor": "pointer"}),
                                    html.Button("?", id="paper-otype-help", n_clicks=0,
                                                className="paper-help-btn",
                                                title=t("What do these order types mean?")),
                                ],
                                style={"marginTop": "10px", "display": "flex",
                                       "alignItems": "center", "gap": "6px",
                                       "flexWrap": "wrap"},
                            ),
                            html.Div(
                                _price_inputs(),
                                id="paper-price-holder",
                                style={**_FLEX, "marginTop": "8px",
                                       "justifyContent": "center"},
                            ),
                            html.H4(t("Place order amount"),
                                    style={"margin": "12px 0 2px"}),
                            html.Div(
                                [
                                    html.Div(_qty_input(), id="paper-qty-holder"),
                                    html.Div(
                                        [
                                            html.Button(t("Select amount type") + " ▾",
                                                        id="paper-mode-toggle",
                                                        n_clicks=0,
                                                        className="menu-btn"),
                                            html.Div(
                                                [
                                                    html.Button(t("Shares/Contracts"),
                                                                id="paper-mode-shares",
                                                                n_clicks=0,
                                                                className="dd-item"),
                                                    html.Button(t("$ amount"),
                                                                id="paper-mode-dollars",
                                                                n_clicks=0,
                                                                className="dd-item"),
                                                ],
                                                id="paper-mode-dd",
                                                className="menu-dropdown",
                                                style={"display": "none"},
                                            ),
                                        ],
                                        style={"position": "relative"},
                                    ),
                                ],
                                style={**_FLEX, "marginTop": "6px"},
                            ),
                            html.Div(
                                [
                                    html.Button(t("Place order"), id="paper-place",
                                                n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                    html.Button(t("Cancel order"),
                                                id="paper-cancel-order", n_clicks=0,
                                                style=theme.PERIOD_BUTTON_STYLE),
                                ],
                                style={"display": "flex",
                                       "justifyContent": "center", "gap": "8px",
                                       "marginTop": "14px"},
                            ),
                            # Input errors from Place order land right here.
                            html.Div(id="paper-order-msg",
                                     style={"marginTop": "8px"}),
                                ],
                                id="paper-order-detail", style=_HIDDEN,
                            ),
                                ],
                                id="paper-ticket-controls", style=_HIDDEN,
                            ),
                        ],
                        style={"marginBottom": "16px"},
                        className="paper-ticket-card",
                    ),
                    card(
                        [
                            html.H3(t("Pending orders"), style={"marginTop": 0}),
                            html.Div(id="paper-orders"),
                        ],
                        style={"marginBottom": "16px"},
                    ),
                    card(
                        [
                            html.H3(t("Watchlist"), style={"marginTop": 0}),
                            html.Div(id="paper-watch"),
                        ],
                        style={"marginBottom": "16px"},
                    ),
                    card(
                        [
                            html.Div(
                                [
                                    html.H3(t("Trade history"),
                                            style={"margin": 0}),
                                    html.Button(t("View all"), id="paper-history-open",
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
                    ),
                        ],
                        style={"flex": "0 0 420px"},
                    ),
                    # ── Right column: Positions box, then equity/detail box ──
                    html.Div(
                        [
                            # Box A — Positions, or the option chain in its place.
                            card(
                                [
                                    html.Div(
                                        [
                                    html.Div(
                                        [
                                            html.H4(t("Positions"), style={"margin": 0}),
                                            dcc.RadioItems(
                                                id="paper-pos-sort",
                                                options=[{"label": t("Amount"),
                                                          "value": "amount"},
                                                         {"label": t("Sector"),
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
                                        id="paper-positions-wrap",
                                    ),
                                    # Loaded option chain replaces Positions.
                                    html.Div(
                                        [
                                            html.Div(
                                                [
                                                    html.H4(t("Option chain"),
                                                            style={"margin": 0}),
                                                    html.Button(
                                                        t("Close table"),
                                                        id="paper-chain-close",
                                                        n_clicks=0,
                                                        style=theme.PERIOD_BUTTON_STYLE),
                                                ],
                                                style={"display": "flex",
                                                       "justifyContent": "space-between",
                                                       "alignItems": "center",
                                                       "marginBottom": "8px"},
                                            ),
                                            html.Div(id="paper-chain"),
                                        ],
                                        id="paper-chain-wrap",
                                        style=_HIDDEN,
                                    ),
                                ],
                            ),
                            # Box B — equity chart + stats + stock detail.
                            card(
                                [
                                    landscape_chart(
                                        dcc.Graph(id="paper-graph",
                                                  className="ls-graph",
                                                  style={"height": "420px"},
                                                  config=_GRAPH_CONFIG),
                                        prefix="paper-eq"),
                                    html.Div(id="paper-stats",
                                             style={"marginTop": "12px"}),
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
                                                                        {"label": t("Line"),
                                                                         "value": "line"},
                                                                        {"label": t("Candle"),
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
                                                                **{"data-tip": t("Full Screen")}),
                                                            html.Button(
                                                                "✕", id="paper-fs-exit",
                                                                className="paper-fs-btn paper-fs-exit invest-tip",
                                                                **{"data-tip": t("Exit Full Screen")}),
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
                                            # Landscape box (narrow-screen path of the
                                            # ⛶ button); wide screens use .maximized on
                                            # #paper-stock-wrap instead (see fs callback).
                                            html.Div(
                                                html.Div(
                                                    [
                                                        html.Button(
                                                            "✕ " + t("Close landscape"),
                                                            id="paper-stock-ls-exit",
                                                            n_clicks=0,
                                                            className="ls-exit"),
                                                        dcc.Graph(
                                                            id="paper-stock-graph",
                                                            className="ls-graph",
                                                            style={"height": "340px"},
                                                            config=_GRAPH_CONFIG),
                                                    ],
                                                    className="ls-inner",
                                                ),
                                                id="paper-stock-ls-box",
                                                className="ls-box",
                                            ),
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
                id="paper-main", className="invest-main mt-split", style=_HIDDEN,
            ),
            dcc.Store(id="paper-eq-ls-dummy"),
            # Transaction confirmation modal (guardrail before any money moves).
            html.Div(
                html.Div(
                    [
                        html.H3(t("Confirm transaction")),
                        html.Div(id="paper-confirm-body",
                                 style={"margin": "8px 0 4px", "lineHeight": "1.7"}),
                        html.Div(
                            [
                                html.Button(t("Confirm"), id="paper-confirm-yes",
                                            n_clicks=0, style=theme.BUTTON_STYLE),
                                html.Button(t("Cancel"), id="paper-confirm-no",
                                            n_clicks=0, style=theme.PERIOD_BUTTON_STYLE),
                            ],
                            className="invest-modal-actions",
                            style={"justifyContent": "center"},
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
                        html.H3(t("Confirm delete")),
                        html.Div(id="paper-delete-body",
                                 style={"margin": "8px 0 4px", "lineHeight": "1.7"}),
                        html.Div(
                            [
                                html.Button(t("Delete"), id="paper-delete-yes",
                                            n_clicks=0,
                                            style={**theme.BUTTON_STYLE,
                                                   "background": theme.EXPENSE_COLOR,
                                                   "borderColor": theme.EXPENSE_COLOR}),
                                html.Button(t("Cancel"), id="paper-delete-no",
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
                        html.H3(t("Order types explained")),
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
                        html.P(t("Note: pending orders here are checked against "
                                 "~15-min-delayed quotes on each refresh tick, so "
                                 "fills can lag the exact trigger moment."),
                               style={"color": theme.MUTED, "fontSize": "12px",
                                      "marginTop": "10px"}),
                        html.Div(
                            html.Button(t("Close"), id="paper-help-close", n_clicks=0,
                                        style=theme.BUTTON_STYLE),
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card",
                ),
                id="paper-help-modal", className="modal-overlay", style=_HIDDEN,
            ),
            # Market-hours mode: (i) explainer modal.
            html.Div(
                html.Div(
                    [
                        html.H3(t("Market-hours fills")),
                        html.Div(t("When ON, orders only fill while the NYSE "
                                   "is open (9:30–16:00 ET, Mon–Fri, minus "
                                   "holidays). A market order placed off-hours "
                                   "is queued and fills at the first quote "
                                   "after the next open — like a real broker. "
                                   "Pending limit/stop/trailing orders also "
                                   "pause while the market is closed."),
                                 style={"lineHeight": "1.7"}),
                        html.Div(t("Crypto (-USD pairs) trades around the "
                                   "clock and is never queued. When OFF, all "
                                   "orders fill instantly at the latest "
                                   "(~15-min delayed) quote."),
                                 style={"lineHeight": "1.7",
                                        "marginTop": "8px"}),
                        html.Div(
                            html.Button(t("Close"), id="paper-hours-info-close",
                                        n_clicks=0, style=theme.BUTTON_STYLE),
                            className="invest-modal-actions",
                            style={"justifyContent": "center"},
                        ),
                    ],
                    className="modal-card",
                ),
                id="paper-hours-info-modal", className="modal-overlay",
                style=_HIDDEN,
            ),
            # Market-hours mode: confirm before turning OFF with pending orders.
            html.Div(
                html.Div(
                    [
                        html.H3(t("Turn off market-hours fills?")),
                        html.Div(t("Turning this off will place your queued "
                                   "orders straight away at the current "
                                   "quote. Continue?"),
                                 style={"lineHeight": "1.7"}),
                        html.Div(
                            [
                                html.Button(t("Confirm"), id="paper-hours-yes",
                                            n_clicks=0,
                                            style=theme.BUTTON_STYLE),
                                html.Button(t("Cancel"), id="paper-hours-no",
                                            n_clicks=0,
                                            style=theme.PERIOD_BUTTON_STYLE),
                            ],
                            className="invest-modal-actions",
                            style={"justifyContent": "center"},
                        ),
                    ],
                    className="modal-card",
                ),
                id="paper-hours-confirm-modal", className="modal-overlay",
                style=_HIDDEN,
            ),
            # Asset-type help modal (mirrors the order-type one).
            html.Div(
                html.Div(
                    [
                        html.H3(t("Asset types explained")),
                        _help_entry(
                            "Stock/ETF",
                            "A share of a single company (stock), or a fund that "
                            "holds a whole basket of assets under one ticker "
                            "(ETF). Trades during US market hours.",
                            "AAPL is Apple stock; SPY is an ETF that holds all "
                            "S&P 500 companies at once."),
                        _help_entry(
                            "Crypto",
                            "A digital currency, quoted as a -USD pair. Trades "
                            "around the clock (24/7) and is typically far more "
                            "volatile than stocks.",
                            "BTC-USD is Bitcoin priced in dollars; ETH-USD is "
                            "Ethereum."),
                        _help_entry(
                            "Option",
                            "A contract giving the right — not the obligation — "
                            "to buy (call) or sell (put) 100 shares of the "
                            "underlying at a set strike price until expiry. Load "
                            "the chain, then pick expiry, call/put and strike.",
                            "An AAPL call with strike $300 expiring in December "
                            "profits if Apple rises well above $300 before then; "
                            "it can also expire worthless."),
                        html.Div(
                            html.Button(t("Close"), id="paper-asset-help-close",
                                        n_clicks=0, style=theme.BUTTON_STYLE),
                            className="invest-modal-actions",
                        ),
                    ],
                    className="modal-card",
                ),
                id="paper-asset-help-modal", className="modal-overlay", style=_HIDDEN,
            ),
            # Full trade-history modal (scrollable; filled on open).
            html.Div(
                html.Div(
                    [
                        html.H3(t("Trade history — all transactions")),
                        html.Div(id="paper-history-full",
                                 className="paper-history-scroll"),
                        html.Div(
                            html.Button(t("Hide trade history"),
                                        id="paper-history-close", n_clicks=0,
                                        style=theme.BUTTON_STYLE),
                            className="invest-modal-actions",
                            style={"justifyContent": "center"},
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
    Output("paper-manage-msg", "children", allow_duplicate=True),
    Output("paper-order-msg", "children", allow_duplicate=True),
    Output("paper-refresh", "data", allow_duplicate=True),
    Input("paper-place", "n_clicks"),
    Input("paper-close-pos", "n_clicks"),
    Input("paper-deposit-btn", "n_clicks"),
    Input("paper-withdraw-btn", "n_clicks"),
    Input("paper-add-pf", "n_clicks"),
    State("paper-asset", "value"),
    State("paper-symbol", "value"),
    State("paper-expiry", "value"),
    State("paper-right", "value"),
    State("paper-opt-strike", "data"),
    State("paper-otype", "value"),
    State("paper-mode", "data"),
    State("paper-qty", "value"),
    State("paper-limit", "value"),
    State("paper-stop", "value"),
    State("paper-trail", "value"),
    State("paper-cash-amt", "value"),
    State("paper-refresh", "data"),
    State("paper-side", "data"),
    prevent_initial_call=True,
)
def _preview(_p, _c, _d, _w, _pf, asset, symbol, expiry, right, strike, otype,
             mode, qty, limit, stop, trail, cash_amt, refresh, side):
    state = P.load_state()
    if not state:
        raise PreventUpdate
    trig = ctx.triggered_id
    try:
        if trig == "paper-add-pf":               # new portfolios open empty ($0)
            with P.locked():
                state = P.load_state()           # fresh read under the lock
                P.add_portfolio(state, 0)
            return _HIDDEN, no_update, None, "", "", "", (refresh or 0) + 1
        elif trig == "paper-close-pos":
            # Close the whole position exactly (sell a long / buy back a short),
            # using the position's own kind so the asset radio can't mismatch.
            sym = (symbol or "").strip().upper()
            pos = state["portfolios"][state["active"]]["positions"].get(sym)
            if not pos:
                return (_HIDDEN, no_update, None,
                        _err(t("No open position for {symbol}.").format(symbol=sym)),
                        no_update, no_update, no_update)
            pend = P.preview_order(state, {
                "kind": pos.get("kind", "stock"), "symbol": sym,
                "side": "sell" if pos["qty"] > 0 else "buy",
                "otype": "market", "mode": "shares", "qty": abs(pos["qty"])})
        elif trig in ("paper-deposit-btn", "paper-withdraw-btn"):
            op = "deposit" if trig == "paper-deposit-btn" else "withdraw"
            pend = P.preview_cash(state, op, cash_amt)
        else:                                    # Place order (side from dropdown)
            if side not in ("buy", "sell"):
                raise PreventUpdate
            if mode not in ("shares", "dollars"):
                return (_HIDDEN, no_update, None, no_update, no_update,
                        _err(t("Select an amount type first.")), no_update)
            spec = {"kind": asset, "side": side, "otype": otype, "mode": mode,
                    "qty": qty, "limit": limit, "stop": stop, "trail": trail}
            if asset == "option":
                spec.update({"underlying": symbol, "expiry": expiry, "right": right,
                             "strike": strike})
            else:
                spec["symbol"] = symbol
            pend = P.preview_order(state, spec)
    except P.TradeError as exc:
        # Route errors to where the user acted: Manage box for cash ops,
        # under Place order for order-entry input, top banner for the rest.
        err = _err(str(exc))
        if trig in ("paper-deposit-btn", "paper-withdraw-btn"):
            return _HIDDEN, no_update, None, no_update, err, no_update, no_update
        if trig == "paper-place":
            return _HIDDEN, no_update, None, no_update, no_update, err, no_update
        return _HIDDEN, no_update, None, err, no_update, no_update, no_update
    return {"display": "flex"}, _confirm_body(pend), pend, "", "", "", no_update


# Step 2: execute (Confirm) or discard (Cancel) the pending transaction.
@callback(
    Output("paper-confirm-modal", "style", allow_duplicate=True),
    Output("paper-refresh", "data", allow_duplicate=True),
    Output("paper-msg", "children", allow_duplicate=True),
    Output("paper-manage-msg", "children", allow_duplicate=True),
    Output("paper-pending-txn", "data", allow_duplicate=True),
    Output("paper-side", "data", allow_duplicate=True),
    Output("paper-mode", "data", allow_duplicate=True),
    Output("paper-cash-amt", "value"),
    Input("paper-confirm-yes", "n_clicks"),
    Input("paper-confirm-no", "n_clicks"),
    State("paper-pending-txn", "data"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _confirm(_yes, _no, pend, refresh):
    if ctx.triggered_id == "paper-confirm-no" or not pend:
        return (_HIDDEN, no_update, no_update, no_update, None,
                no_update, no_update, no_update)
    is_cash = pend["kind"] == "cash"
    try:
        with P.locked():
            state = P.load_state()
            if not state:
                raise PreventUpdate
            if is_cash:
                fn = P.deposit if pend["op"] == "deposit" else P.withdraw
                fn(state, state["active"], pend["amount"])
                verb = t("Deposited") if pend["op"] == "deposit" else t("Withdrew")
                msg = f"{verb} {pend['amount']:,.2f}"
            else:                                # trade
                msg = P.place_order(state, pend["spec"])
    except P.TradeError as exc:
        err = _err(str(exc))
        return (_HIDDEN, no_update, no_update if is_cash else err,
                err if is_cash else no_update, None, no_update, no_update,
                no_update)
    ok = _ok(msg)
    # A filled/queued order collapses the ticket back to stage 1 (side and
    # amount-type reset). Note: never write to paper-qty from the server — a
    # pushed None leaves the number input unable to propagate later keystrokes
    # (Dash 4.2 quirk).
    return (_HIDDEN, (refresh or 0) + 1, no_update if is_cash else ok,
            ok if is_cash else no_update, None,
            no_update if is_cash else None,
            no_update if is_cash else None, None)


@callback(
    Output("paper-refresh", "data", allow_duplicate=True),
    Output("paper-manage-msg", "children", allow_duplicate=True),
    Output("paper-rename", "value"),
    Input("paper-rename-btn", "n_clicks"),
    State("paper-rename", "value"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _rename(_n, name, refresh):
    try:
        with P.locked():
            state = P.load_state()
            if not state:
                raise PreventUpdate
            P.rename_portfolio(state, state["active"], name)
    except P.TradeError as exc:
        return no_update, _err(str(exc)), no_update
    return (refresh or 0) + 1, "", ""


@callback(
    Output("paper-refresh", "data", allow_duplicate=True),
    Input("paper-active", "value"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _set_active(idx, refresh):
    with P.locked():
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
    try:
        with P.locked():
            state = P.load_state()
            if not state:
                raise PreventUpdate
            P.add_watch(state, symbol)
    except P.TradeError as exc:
        return no_update, _err(str(exc))
    return (refresh or 0) + 1, _ok(t("Added {symbol} to watchlist.").format(
        symbol=(symbol or "").strip().upper()))


@callback(
    Output("paper-refresh", "data", allow_duplicate=True),
    Input({"type": "paper-cancel", "oid": ALL}, "n_clicks"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _cancel(clicks, refresh):
    if not any(clicks or []):
        raise PreventUpdate
    with P.locked():
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
    Output("paper-loaded", "data", allow_duplicate=True),
    Output("paper-ticket-reset", "data", allow_duplicate=True),
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
        body = html.Div([html.Span(t("Remove ")), _bold(unwatch),
                         html.Span(t(" from your watchlist? Your holdings are not "
                                     "affected."))])
        return (no_update, no_update, {"display": "flex"}, body, pend,
                no_update, no_update, no_update)
    tk = ctx.triggered_id["ticker"]
    # Toggle stock selection; a stock selection clears any sector comparison. On a fresh
    # selection (not a deselect) also target it in the order ticket — a row click counts
    # as loading the symbol, so the order controls appear — unless an Option order is
    # being built for a different underlying. Deselecting (stop viewing) fully
    # resets the ticket, symbol included.
    deselect = tk == current
    fresh = not deselect and asset != "option"
    sym = tk if fresh else no_update
    loaded = None if deselect else (
        {"symbol": tk, "asset": asset} if fresh else no_update)
    reset = ({"clear_symbol": True, "n": time.time()} if deselect else no_update)
    return ((None if deselect else tk), None, no_update, no_update, no_update,
            sym, loaded, reset)


@callback(
    Output("paper-delete-modal", "style", allow_duplicate=True),
    Output("paper-delete-body", "children", allow_duplicate=True),
    Output("paper-pending-delete", "data", allow_duplicate=True),
    Output("paper-manage-msg", "children", allow_duplicate=True),
    Input("paper-delete-pf-btn", "n_clicks"),
    prevent_initial_call=True,
)
def _delete_pf_prompt(_n):
    """Ask to delete the active portfolio (guarded: never the last one)."""
    state = P.load_state()
    if not state:
        raise PreventUpdate
    if len(state["portfolios"]) <= 1:
        return no_update, no_update, no_update, _err(t("Can't delete the only portfolio."))
    pf = state["portfolios"][state["active"]]
    pend = {"kind": "portfolio", "idx": state["active"], "name": pf["name"]}
    body = html.Div([html.Span(t("Delete portfolio ")), _bold(pf["name"]),
                     html.Span(t(" and all its holdings & history? ")),
                     html.Span(t("This cannot be undone."),
                               style={"color": theme.EXPENSE_COLOR})])
    return {"display": "flex"}, body, pend, ""


@callback(
    Output("paper-delete-modal", "style", allow_duplicate=True),
    Output("paper-refresh", "data", allow_duplicate=True),
    Output("paper-msg", "children", allow_duplicate=True),
    Output("paper-manage-msg", "children", allow_duplicate=True),
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
        return _HIDDEN, no_update, no_update, no_update, None, no_update
    is_watch = pend["kind"] == "watch"
    try:
        with P.locked():
            state = P.load_state()
            if not state:
                raise PreventUpdate
            if is_watch:
                P.remove_watch(state, pend["ticker"])
                msg = t("Removed {ticker} from watchlist").format(
                    ticker=pend['ticker'])
                sel = None if pend.get("was_selected") else no_update
            else:                                # portfolio → message under Manage
                P.delete_portfolio(state, pend["idx"])
                msg = t("Deleted portfolio {name}").format(name=pend['name'])
                sel = no_update
    except P.TradeError as exc:
        err = _err(str(exc))
        return (_HIDDEN, no_update, err if is_watch else no_update,
                no_update if is_watch else err, None, no_update)
    ok = _ok(msg)
    return (_HIDDEN, (refresh or 0) + 1, ok if is_watch else no_update,
            no_update if is_watch else ok, None, sel)


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


# The load button doubles as the symbol check: "Load stock" (stock/crypto)
# validates the ticker against a live quote; "Load chain" (options) fetches
# expiries. Success records the symbol in paper-loaded, which reveals the
# order controls (see _ticket_visibility).
@callback(
    Output("paper-opt-underlying", "data"),
    Output("paper-expiry", "options"),
    Output("paper-expiry", "value"),
    Output("paper-msg", "children", allow_duplicate=True),
    Output("paper-loaded", "data"),
    Output("paper-selected", "data", allow_duplicate=True),
    Input("paper-load-chain", "n_clicks"),
    State("paper-symbol", "value"),
    State("paper-asset", "value"),
    prevent_initial_call=True,
)
def _load_symbol(_n, symbol, asset):
    symbol = (symbol or "").strip().upper()
    if not symbol:
        return (no_update, no_update, no_update,
                _err(t("Enter a symbol first.")), None, no_update)
    if asset == "option":
        exps = Q.option_expirations(symbol)
        if not exps:
            return (no_update, [], None,
                    _err(t("No listed options for {symbol}.").format(symbol=symbol)),
                    None, no_update)
        opts = [{"label": e, "value": e} for e in exps]
        return (symbol, opts, exps[0],
                _ok(t("Loaded option chain for {symbol}.").format(symbol=symbol)),
                {"symbol": symbol, "asset": asset}, no_update)
    price = Q.live_price(symbol)
    if price is None:
        return (no_update, no_update, no_update,
                _err(t("{symbol} not found — check the symbol.").format(symbol=symbol)),
                None, no_update)
    return (no_update, no_update, no_update,
            _ok(t("{symbol} loaded — last price ${price}.").format(
                    symbol=symbol, price=_money(price))),
            {"symbol": symbol, "asset": asset}, symbol)


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


# Toggle option-only row + which conditional price input shows; the load
# button is "Load chain" for options, "Load stock" otherwise.
@callback(
    Output("paper-option-row", "style"),
    Output("paper-limit", "style"),
    Output("paper-stop", "style"),
    Output("paper-trail", "style"),
    Output("paper-load-chain", "children"),
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
            price("110px", otype == "stop"), price("110px", otype == "trailing"),
            t("Load chain") if asset == "option" else t("Load stock"))


# Held-position context: the label always states the held quantity (0 included);
# the Close button only shows when there is a position to close — no need to
# hand-type the fractional quantity that $-mode buys leave behind.
@callback(
    Output("paper-held-label", "children"),
    Output("paper-held-value", "children"),
    Output("paper-close-pos", "style"),
    Input("paper-symbol", "value"),
    Input("paper-refresh", "data"),
)
def _held_row(symbol, _refresh):
    sym = (symbol or "").strip().upper()
    state = P.load_state()
    close_style = {**theme.PERIOD_BUTTON_STYLE, "color": theme.EXPENSE_COLOR,
                   "borderColor": theme.EXPENSE_COLOR}
    if not sym or not state:
        return "", "", {**close_style, "display": "none"}
    pos = state["portfolios"][state["active"]]["positions"].get(sym)
    qty = pos["qty"] if pos else 0.0
    label = (t("You are SHORT {qty} {symbol}.") if qty < 0
             else t("You hold {qty} {symbol}.")).format(
        qty=f"{abs(qty):g}", symbol=sym)
    value = qty * (pos.get("mark") or 0.0) * pos.get("mult", 1) if pos else 0.0
    vline = t("Value: {value} $").format(value=f"{value:,.2f}")
    if abs(qty) < 1e-12:
        return label, vline, {**close_style, "display": "none"}
    return label, vline, close_style


# Stage 1 → 2: picking Buy or Sell/Short from the dropdown reveals the rest of
# the ticket (order type, quantity, Place order), colored by the chosen side.
@callback(
    Output("paper-side", "data"),
    Output("paper-order-msg", "children", allow_duplicate=True),
    Input("paper-side-buy", "n_clicks"),
    Input("paper-side-sell", "n_clicks"),
    prevent_initial_call=True,
)
def _pick_side(_b, _s):
    return ("buy" if ctx.triggered_id == "paper-side-buy" else "sell"), ""


@callback(
    Output("paper-mode", "data"),
    Input("paper-mode-shares", "n_clicks"),
    Input("paper-mode-dollars", "n_clicks"),
    prevent_initial_call=True,
)
def _pick_mode(_s, _d):
    return "dollars" if ctx.triggered_id == "paper-mode-dollars" else "shares"


@callback(
    Output("paper-mode-toggle", "children"),
    Input("paper-mode", "data"),
)
def _mode_label(mode):
    label = {"shares": t("Shares/Contracts"),
             "dollars": t("$ amount")}.get(mode, t("Select amount type"))
    return label + " ▾"


# "Cancel order": collapse back to the just-loaded state (stage 1). The symbol
# stays loaded; qty is deliberately left alone (see the Dash 4.2 note above).
@callback(
    Output("paper-side", "data", allow_duplicate=True),
    Output("paper-mode", "data", allow_duplicate=True),
    Output("paper-order-msg", "children", allow_duplicate=True),
    Input("paper-cancel-order", "n_clicks"),
    prevent_initial_call=True,
)
def _cancel_order(_n):
    return None, None, ""


# "Close table" on the option chain: restore Positions and reset the ticket to
# its default state (Stock/ETF/Crypto), keeping the symbol loaded.
@callback(
    Output("paper-ticket-reset", "data"),
    Input("paper-chain-close", "n_clicks"),
    prevent_initial_call=True,
)
def _chain_close(n):
    return {"clear_symbol": False, "n": n}


@callback(
    Output("paper-hours-info-modal", "style"),
    Input("paper-hours-help", "n_clicks"),
    Input("paper-hours-info-close", "n_clicks"),
    prevent_initial_call=True,
)
def _hours_help_toggle(_open, _close):
    return {"display": "flex"} if ctx.triggered_id == "paper-hours-help" else _HIDDEN


@callback(
    Output("paper-hours-confirm-modal", "style"),
    Output("paper-refresh", "data", allow_duplicate=True),
    Input("paper-hours", "value"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _set_hours(value, refresh):
    on = "on" in (value or [])
    with P.locked():
        state = P.load_state()
        if not state:
            raise PreventUpdate
        if not on and state.get("market_hours_only"):
            # Turning off with pending orders: confirm first — they'd fill at
            # the very next tick. Setting stays ON until the user confirms.
            pending = any(o["status"] == "open"
                          for pf in state["portfolios"] for o in pf["orders"])
            if pending:
                return {"display": "flex"}, no_update
        P.set_market_hours(state, on)
    return _HIDDEN, (refresh or 0) + 1


@callback(
    Output("paper-hours-confirm-modal", "style", allow_duplicate=True),
    Output("paper-hours", "value", allow_duplicate=True),
    Output("paper-refresh", "data", allow_duplicate=True),
    Input("paper-hours-yes", "n_clicks"),
    Input("paper-hours-no", "n_clicks"),
    State("paper-refresh", "data"),
    prevent_initial_call=True,
)
def _hours_confirm(_yes, _no, refresh):
    if ctx.triggered_id == "paper-hours-no":
        # Stay in market-hours mode: re-tick the box (its _set_hours re-fire
        # lands in the turning-on path, a harmless no-op persist).
        return _HIDDEN, ["on"], no_update
    with P.locked():
        state = P.load_state()
        if not state:
            raise PreventUpdate
        P.set_market_hours(state, False)
        P.process(state)      # fill the queued orders straight away, as promised
    return _HIDDEN, no_update, (refresh or 0) + 1


# Full order-ticket reset (from Close table or deselecting a stock). Number
# inputs are cleared by rendering FRESH instances into their holders — a
# server-pushed value would brick their keystroke propagation (Dash 4.2).
@callback(
    Output("paper-side", "data", allow_duplicate=True),
    Output("paper-mode", "data", allow_duplicate=True),
    Output("paper-otype", "value"),
    Output("paper-asset", "value"),
    Output("paper-opt-underlying", "data", allow_duplicate=True),
    Output("paper-expiry", "options", allow_duplicate=True),
    Output("paper-expiry", "value", allow_duplicate=True),
    Output("paper-msg", "children", allow_duplicate=True),
    Output("paper-order-msg", "children", allow_duplicate=True),
    Output("paper-qty-holder", "children"),
    Output("paper-price-holder", "children"),
    Output("paper-symbol", "value", allow_duplicate=True),
    Input("paper-ticket-reset", "data"),
    prevent_initial_call=True,
)
def _apply_ticket_reset(data):
    if not data:
        raise PreventUpdate
    return (None, None, "market", "stock", None, [], None, "", "",
            _qty_input(), _price_inputs(),
            "" if data.get("clear_symbol") else no_update)


@callback(
    Output("paper-order-detail", "style"),
    Output("paper-side-toggle", "children"),
    Output("paper-side-toggle", "style"),
    Output("paper-place", "style"),
    Input("paper-side", "data"),
)
def _order_detail(side):
    if side == "buy":
        accent = {"color": theme.INCOME_COLOR,
                  "borderColor": theme.INCOME_COLOR}
        label = t("Buy") + " ▾"
    elif side == "sell":
        accent = {"color": theme.EXPENSE_COLOR,
                  "borderColor": theme.EXPENSE_COLOR}
        label = t("Sell / Short") + " ▾"
    else:
        return _HIDDEN, t("Buy / Sell") + " ▾", {}, theme.PERIOD_BUTTON_STYLE
    return ({"display": "block"}, label, accent,
            {**theme.PERIOD_BUTTON_STYLE, **accent})


# Progressive disclosure: the order controls and "+ Watch" only appear once
# the typed symbol has actually been loaded (stock/crypto: quote check via the
# load button or a holdings/watchlist row click; option: chain loaded).
# Typing a different symbol hides them again.
@callback(
    Output("paper-ticket-controls", "style"),
    Output("paper-add-watch", "style"),
    Output("paper-side", "data", allow_duplicate=True),
    Input("paper-loaded", "data"),
    Input("paper-opt-underlying", "data"),
    Input("paper-symbol", "value"),
    Input("paper-asset", "value"),
    prevent_initial_call=True,
)
def _ticket_visibility(loaded, opt_under, symbol, asset):
    sym = (symbol or "").strip().upper()
    if asset == "option":
        ready = bool(sym) and opt_under == sym
    else:
        ready = bool(sym) and bool(loaded) and loaded.get("symbol") == sym
    return ({"display": "block"} if ready else _HIDDEN,
            theme.PERIOD_BUTTON_STYLE if ready
            else {**theme.PERIOD_BUTTON_STYLE, "display": "none"},
            no_update if ready else None)   # hiding the ticket resets the flow


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
        var label = (s === 'Open') ? 'MARKET OPEN' : 'MARKET CLOSED';
        if (s === 'Pre-market') { label += ' (Pre-market)'; }
        if (s === 'After-hours') { label += ' (After hours)'; }
        var cls = (s === 'Open') ? 'paper-mkt-open' : 'paper-mkt-closed';
        return ['🕒 NYSE ' + t + ' ET', label, cls];
    }
    """,
    Output("paper-clock", "children"),
    Output("paper-market-status", "children"),
    Output("paper-market-status", "className"),
    Input("paper-clock-tick", "n_intervals"),
)


# ── Fullscreen for the stock chart ───────────────────────────────────────────
# The ⛶ button maximizes the whole stock box to a viewport-filling in-app overlay
# (.maximized on #paper-stock-wrap) that keeps the range chips, Line/Candle box and
# multiples table usable — on every device. (Phones used to get a rotated landscape
# view instead, but CSS-rotating the chart broke Plotly's pan/zoom, so it now fills
# upright like everywhere else; turning the phone gives a true wide view.) Exit comes
# from ✕ Exit-Full-Screen.
clientside_callback(
    """
    function (nEnter, nExit, nLsExit) {
        var trig = (window.dash_clientside.callback_context.triggered[0] || {});
        var id = (trig.prop_id || '').split('.')[0];
        var wrap = document.getElementById('paper-stock-wrap');
        if (id === 'paper-fs-enter') {
            if (wrap) wrap.classList.add('maximized');
            document.body.style.overflow = 'hidden';
        } else {   // paper-fs-exit or paper-stock-ls-exit
            if (wrap) wrap.classList.remove('maximized');
            document.body.style.overflow = '';
        }
        setTimeout(function () {
            window.dispatchEvent(new Event('resize'));
        }, 120);
        return window.dash_clientside.no_update;
    }
    """,
    Output("paper-fs-dummy", "data"),
    Input("paper-fs-enter", "n_clicks"),
    Input("paper-fs-exit", "n_clicks"),
    Input("paper-stock-ls-exit", "n_clicks"),
    prevent_initial_call=True,
)


# Landscape toggle for the equity chart (generic .ls-box JS).
clientside_callback(
    LANDSCAPE_JS,
    Output("paper-eq-ls-dummy", "data"),
    Input("paper-eq-ls-enter", "n_clicks"),
    Input("paper-eq-ls-exit", "n_clicks"),
    prevent_initial_call=True,
)


# ── Help modal toggles (order types / asset types) ────────────────────────────

@callback(
    Output("paper-asset-help-modal", "style"),
    Input("paper-asset-help", "n_clicks"),
    Input("paper-asset-help-close", "n_clicks"),
    prevent_initial_call=True,
)
def _asset_help_toggle(_open, _close):
    return {"display": "flex"} if ctx.triggered_id == "paper-asset-help" else _HIDDEN


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
    if P.tick() is None:
        raise PreventUpdate
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
    Output("paper-cash-line", "children"),
    Output("paper-positions-wrap", "style"),
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

    # Option chain panel (only in Option mode) — replaces the Positions table.
    if asset == "option" and opt_under and expiry:
        chain_wrap = {"display": "block"}
        chain = _chain_table(opt_under, expiry, right, strike)
        price = Q.option_price(opt_under, expiry, right, strike) if strike else None
        label = (t("Contract: {under} {expiry} {cp}{strike}").format(
                     under=opt_under, expiry=expiry,
                     cp=('C' if right == 'call' else 'P'), strike=f"{float(strike):g}")
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
        {"label": t("Line"), "value": "line"},
        {"label": t("Candle"), "value": "candle", "disabled": rng in _NO_CANDLE},
    ]

    return (
        {"display": "flex"}, main_style,
        _status_text(state), active_opts, state["active"],
        _holdings_table(state, selected, pos_sort or "amount"), _orders_table(state),
        _watch_table(state, selected, sel_sector),
        _stats_table(state), fig, chain_wrap, chain, label, stock_wrap, stock_fig,
        metrics, _trades_table(state), graph_style, stats_style, charttype_style,
        chart_type_options,
        t("Cash: ${amount}").format(
            amount=_money(P.summary(state, state["active"])["cash"])),
        _HIDDEN if chain_wrap.get("display") == "block" else {"display": "block"},
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
