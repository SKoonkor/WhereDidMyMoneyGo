"""Investment Simulator comparison chart.

One line per portfolio (value over elapsed trading days), the S&P 500 normalised
to the $10,000 starting stake (dashed), and a flat $10,000 reference line.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go

from src.app import theme
from src.analytics.investment import START_CASH

_UP, _DOWN = "#2ecc71", "#e74c3c"    # candle/volume up-green, down-red


def add_cursor_spike(fig, ft) -> None:
    """Dotted vertical crosshair that tracks the cursor across a time-series plot."""
    fig.update_xaxes(showspikes=True, spikemode="across", spikesnap="cursor",
                     spikethickness=1, spikedash="dot", spikecolor=ft.muted)


def cubehelix_colors(n: int, dark: bool = True) -> list[str]:
    """`n` distinct hex colors from Dave Green's cubehelix scheme (numpy only),
    sampled across a lightness range tuned for the theme."""
    if n <= 0:
        return []
    start, rot, hue, gamma = 0.5, -1.5, 1.2, 1.0
    lo, hi = (0.35, 0.85) if dark else (0.25, 0.70)
    lams = [lo] if n == 1 else [lo + (hi - lo) * i / (n - 1) for i in range(n)]
    out = []
    for lam in lams:
        angle = 2 * np.pi * (start / 3 + 1 + rot * lam)
        amp = hue * lam ** gamma * (1 - lam ** gamma) / 2
        r = lam ** gamma + amp * (-0.14861 * np.cos(angle) + 1.78277 * np.sin(angle))
        g = lam ** gamma + amp * (-0.29227 * np.cos(angle) - 0.90649 * np.sin(angle))
        b = lam ** gamma + amp * (1.97294 * np.cos(angle))
        out.append("#%02x%02x%02x" % tuple(
            round(255 * max(0.0, min(1.0, c))) for c in (r, g, b)))
    return out

# Vivid, well-separated colors for the up-to-3 portfolios (distinct from the grey
# S&P 500 line and from each other).
PORTFOLIO_COLORS = ["#3498db", "#e67e22", "#9b59b6"]  # blue, orange, purple


def build_investment_figure(port_series: dict, spx, dark: bool = True) -> go.Figure:
    ft = theme.fig_theme(dark)
    fig = go.Figure()

    # Flat starting-stake reference.
    fig.add_hline(y=START_CASH, line=dict(color=ft.muted, width=1, dash="dot"),
                  annotation_text=f"Start ${START_CASH:,.0f}",
                  annotation_position="bottom left", layer="below")

    for i, (name, s) in enumerate(port_series.items()):
        fig.add_trace(go.Scatter(
            x=list(s.index), y=list(s.values), mode="lines", name=name,
            line=dict(color=PORTFOLIO_COLORS[i % len(PORTFOLIO_COLORS)], width=2.8),
            hovertemplate="%{x|%d %b %Y}<br>%{y:,.0f} USD<extra>" + name + "</extra>",
        ))

    if spx is not None and len(spx):
        fig.add_trace(go.Scatter(
            x=list(spx.index), y=list(spx.values), mode="lines", name="S&P 500",
            line=dict(color=ft.muted, width=2, dash="dash"),
            hovertemplate="%{x|%d %b %Y}<br>%{y:,.0f} USD<extra>S&P 500</extra>",
        ))

    fig.update_layout(
        template=ft.template,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        title=dict(text="Portfolio value over time", x=0.5, xanchor="center",
                   y=0.97, yanchor="top"),
        xaxis_title="Date", yaxis_title="Value (USD)",
        hovermode="x unified", dragmode="pan",
        hoverlabel=dict(bgcolor="rgba(0,0,0,0)"),  # transparent, like the stock chart
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0),
        margin=dict(t=70, b=40, l=60, r=20),
    )
    add_cursor_spike(fig, ft)
    return fig


def _add_start_marker(fig, ft, game_start, xmin, xmax) -> None:
    """Dashed 'Game start' marker (add_shape/add_annotation avoid add_vline's
    datetime-arithmetic bug)."""
    if game_start is None or xmin is None or not (xmin <= game_start <= xmax):
        return
    fig.add_shape(type="line", xref="x", yref="paper", x0=game_start, x1=game_start,
                  y0=0, y1=1, line=dict(color=ft.muted, width=1, dash="dash"))
    fig.add_annotation(x=game_start, xref="x", yref="paper", y=1.0, yanchor="bottom",
                       text="Game start", showarrow=False,
                       font=dict(color=ft.muted, size=11))


def _stock_axis(fig, ft, normalized: bool, title: str, showlegend: bool) -> None:
    if normalized:
        fig.add_hline(y=100, line=dict(color=ft.muted, width=1, dash="dot"))
    fig.update_layout(
        template=ft.template,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        title=dict(text=title, x=0.5, xanchor="center", y=0.97, yanchor="top"),
        xaxis_title="Date",
        yaxis_title="% of start" if normalized else "Price (USD)",
        hovermode="x unified", dragmode="pan", showlegend=showlegend,
        hoverlabel=dict(bgcolor="rgba(0,0,0,0)"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0),
        margin=dict(t=50, b=40, l=60, r=20),
    )
    add_cursor_spike(fig, ft)


def _add_ratio_axis(fig, ratio_label) -> None:
    """Configure the right-hand y-axis used by dotted ratio overlays."""
    fig.update_layout(
        yaxis2=dict(title=ratio_label, overlaying="y", side="right", showgrid=False),
        showlegend=True, margin=dict(t=50, b=40, l=60, r=64),
    )


_INTRADAY_FMT = "%b %-d, %Y, %H:%M"          # category label == unified hover header


def _cat_x(index):
    """Per-bar ordinal category labels for a DatetimeIndex (the hover-header strings)."""
    return [t.strftime(_INTRADAY_FMT) for t in pd.DatetimeIndex(index)]


def _stack_sessions(fig, indices) -> None:
    """Make x a contiguous 'category' axis so trading bars stack with no weekend,
    overnight or holiday gaps — each session's close sits right next to the next
    session's open. ``indices`` is a list of each plotted series' DatetimeIndex; ticks
    land on each session's first bar (short date label). ``categoryarray`` fixes the
    order across traces even when tickers carry differing bars.

    This replaces the old rangebreaks approach: stacking weekend + hourly + holiday
    rangebreaks corrupted Plotly's broken-axis transform (double-plotted lines)."""
    union = None
    for idx in indices:
        if idx is not None and len(idx):
            di = pd.DatetimeIndex(idx)
            union = di if union is None else union.union(di)
    if union is None or not len(union):
        return
    union = union.sort_values()
    cats = [t.strftime(_INTRADAY_FMT) for t in union]
    firsts, labels = [], []
    for d, g in pd.Series(union).groupby(union.normalize()):
        firsts.append(g.iloc[0].strftime(_INTRADAY_FMT))
        labels.append(pd.Timestamp(d).strftime("%b %-d"))
    fig.update_xaxes(type="category", categoryorder="array", categoryarray=cats,
                     tickmode="array", tickvals=firsts, ticktext=labels)


def build_stock_figure(ticker: str, series, dark: bool = True, game_start=None,
                       normalized: bool = False, ratio_series=None,
                       ratio_label=None, gapless_intraday: bool = False) -> go.Figure:
    """Single stock's daily close (or % of start) history, optionally with a
    dotted ratio overlay on a secondary (right) y-axis."""
    ft = theme.fig_theme(dark)
    fmt = "%{y:.1f}%" if normalized else "%{y:,.2f} USD"
    fig = go.Figure()
    xh = "%{x}<br>" if gapless_intraday else "%{x|%d %b %Y}<br>"  # category label carries date
    px = _cat_x(series.index) if gapless_intraday else list(series.index)
    fig.add_trace(go.Scatter(
        x=px, y=list(series.values), mode="lines", name=ticker,
        line=dict(color="#1abc9c", width=2.4),
        hovertemplate=xh + fmt + "<extra>" + ticker + "</extra>",
    ))
    if len(series):
        _add_start_marker(fig, ft, game_start, series.index.min(), series.index.max())
    title = f"{ticker} price" + (" (% of start)" if normalized else "")
    _stock_axis(fig, ft, normalized, title, showlegend=False)
    if gapless_intraday:
        _stack_sessions(fig, [series.index])
    if ratio_series is not None and len(ratio_series):
        fig.add_trace(go.Scatter(
            x=(_cat_x(ratio_series.index) if gapless_intraday else list(ratio_series.index)),
            y=list(ratio_series.values), mode="lines",
            name=f"{ticker} {ratio_label}", yaxis="y2",
            line=dict(color="#1abc9c", width=1.8, dash="dot"),
            hovertemplate=xh + "%{y:,.2f}<extra>" + ticker + " "
                          + str(ratio_label) + "</extra>",
        ))
        _add_ratio_axis(fig, ratio_label)
    return fig


def build_sector_figure(sector: str, series_dict: dict, dark: bool = True,
                        game_start=None, normalized: bool = False,
                        colors: list | None = None, ratio_map: dict | None = None,
                        ratio_label=None, gapless_intraday: bool = False) -> go.Figure:
    """Compare every registered stock in ``sector`` — one solid price line per
    ticker, plus optional dotted ratio overlays (secondary y-axis, matching colors)."""
    ft = theme.fig_theme(dark)
    fmt = "%{y:.1f}%" if normalized else "%{y:,.2f} USD"
    colors = colors or cubehelix_colors(len(series_dict), dark)
    fig = go.Figure()
    xh = "%{x}<br>" if gapless_intraday else "%{x|%d %b %Y}<br>"  # category label carries date
    xmin = xmax = None
    for i, (ticker, s) in enumerate(series_dict.items()):
        color = colors[i % len(colors)]
        if len(s):
            xmin = s.index.min() if xmin is None else min(xmin, s.index.min())
            xmax = s.index.max() if xmax is None else max(xmax, s.index.max())
        fig.add_trace(go.Scatter(
            x=(_cat_x(s.index) if gapless_intraday else list(s.index)),
            y=list(s.values), mode="lines", name=ticker,
            line=dict(color=color, width=2.2),
            hovertemplate=xh + fmt + "<extra>" + ticker + "</extra>",
        ))
        rs = (ratio_map or {}).get(ticker)
        if rs is not None and len(rs):
            fig.add_trace(go.Scatter(
                x=(_cat_x(rs.index) if gapless_intraday else list(rs.index)),
                y=list(rs.values), mode="lines",
                name=f"{ticker} {ratio_label}", yaxis="y2",
                line=dict(color=color, width=1.6, dash="dot"),
                hovertemplate=xh + "%{y:,.2f}<extra>" + ticker + " "
                              + str(ratio_label) + "</extra>",
            ))
    _add_start_marker(fig, ft, game_start, xmin, xmax)
    title = f"{sector}" + (" — normalized" if normalized else " — price")
    _stock_axis(fig, ft, normalized, title, showlegend=True)
    if gapless_intraday:
        _stack_sessions(fig, [s.index for s in series_dict.values()])
    if ratio_map:
        _add_ratio_axis(fig, ratio_label)
    return fig


def build_price_figure(ticker: str, df, chart_type: str = "line", dark: bool = True,
                       gapless_intraday: bool = False,
                       intraday: bool = False, xrange=None, yrange=None) -> go.Figure:
    """Single-stock price (line or candlestick) with volume overlaid on a hidden
    secondary y-axis — the volume value surfaces only in the unified hover box.

    ``df`` is an OHLCV frame (Open/High/Low/Close/Volume). Used by the Paper Trading
    detail chart; the Investment Simulator keeps ``build_stock_figure``."""
    ft = theme.fig_theme(dark)
    xfmt = "%b %-d, %Y, %H:%M" if intraday else "%b %-d, %Y"   # unified-box header
    fig = go.Figure()
    vol_max = 1.0
    # Pin the price axis to the High/Low span so the y-range doesn't shift when the
    # user toggles Line↔Candle (line closes are always inside High/Low). Callers may
    # pass an explicit ``yrange`` (e.g. the early-session 1D view) to override this.
    if yrange is None and df is not None and len(df):
        lo = float(df["Low"].min()); hi = float(df["High"].max())
        pad = (hi - lo) * 0.04 or 1.0
        yrange = [lo - pad, hi + pad]
    if df is None or len(df) == 0:
        fig.add_annotation(text="No data", x=0.5, y=0.5, xref="paper", yref="paper",
                           showarrow=False, font=dict(color=ft.muted))
    else:
        x = _cat_x(df.index) if gapless_intraday else list(df.index)
        up = df["Close"].to_numpy() >= df["Open"].to_numpy()
        vol = df["Volume"].fillna(0)
        vol_max = float(vol.max()) or 1.0
        # Price first (zorder above); volume added last so it lands at the *bottom*
        # of the unified hover box, but zorder keeps the bars drawn behind the price.
        if chart_type == "candle":
            # Default Plotly candlestick (standard green/red, default styling). The
            # transparent carrier below keeps the clean text-only 6-line hover, so the
            # candlestick itself skips its own hover.
            fig.add_trace(go.Candlestick(
                x=x, open=df["Open"], high=df["High"], low=df["Low"],
                close=df["Close"], name=ticker, showlegend=False, hoverinfo="skip",
                zorder=2,
            ))
            # Transparent carrier: full OHLCV as plain text (no candle glyph, no
            # symbol). The unified header supplies the date/time as the 1st line, so
            # this template's 5 lines make 6 total.
            fig.add_trace(go.Scatter(
                x=x, y=list(df["Close"]), mode="lines", name="", showlegend=False,
                line=dict(color="rgba(0,0,0,0)"), zorder=3,
                customdata=np.stack([df["Open"], df["High"], df["Low"],
                                     df["Close"], vol], axis=-1),
                hovertemplate=("Open %{customdata[0]:,.2f}<br>"
                               "High %{customdata[1]:,.2f}<br>"
                               "Low %{customdata[2]:,.2f}<br>"
                               "Close %{customdata[3]:,.2f}<br>"
                               "Volume %{customdata[4]:.3s}<extra></extra>"),
            ))
        else:
            fig.add_trace(go.Scatter(
                x=x, y=list(df["Close"]), mode="lines", name=ticker, showlegend=False,
                line=dict(color="#1abc9c", width=2.4), zorder=2,
                hovertemplate="%{y:,.2f} USD<extra></extra>",
            ))
        fig.add_trace(go.Bar(
            x=x, y=list(vol), name="Volume", yaxis="y2", showlegend=False,
            opacity=0.5, marker=dict(color=[_UP if u else _DOWN for u in up]), zorder=1,
            # Candle mode carries volume in the price hover; skip its own entry/symbol.
            hoverinfo="skip" if chart_type == "candle" else None,
            hovertemplate=None if chart_type == "candle" else "Vol %{y:,.3s}<extra></extra>",
        ))

    fig.update_layout(
        template=ft.template, paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)", showlegend=False,
        title=dict(text=f"{ticker} price", x=0.5, xanchor="center", y=0.98,
                   yanchor="top"),
        dragmode="pan", hovermode="x unified",
        hoverlabel=dict(bgcolor="rgba(0,0,0,0)"),
        margin=dict(t=40, b=30, l=60, r=20),
        xaxis=dict(rangeslider_visible=False,  # candlestick adds one by default
                   hoverformat=xfmt,           # unified-box header (date / date+time)
                   range=xrange),              # 1D: pinned to the market session
        yaxis=dict(title="Price (USD)", range=yrange),
        # Volume axis: hidden ticks/grid, scaled so bars sit in the bottom ~25%.
        yaxis2=dict(overlaying="y", side="right", showticklabels=False,
                    showgrid=False, zeroline=False, fixedrange=True,
                    range=[0, vol_max * 4]),
    )
    add_cursor_spike(fig, ft)
    if gapless_intraday and df is not None and len(df):
        _stack_sessions(fig, [df.index])
    return fig
