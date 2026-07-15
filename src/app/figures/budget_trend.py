"""Spending-trend histogram for the Budget page (the click-to-drill view).

Replaces the two monthly pies when a category / sub-category row is clicked in the
Sub-category detail table: a bar chart of that item's monthly spend. Several selections
render as grouped bars on one shared, pannable time axis (colour per selection). Kept
Dash-free — the page precomputes each series so this stays unit-testable.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go

from src.app import theme

# Distinct, readable series colours (one per selection, in click order).
_TREND_PALETTE = ["#3498db", "#e67e22", "#2ecc71", "#9b59b6", "#1abc9c",
                  "#e84393", "#f1c40f", "#e74c3c"]


def _bar_label(v: float) -> str:
    """Compact amount printed above a bar: ``X.Xk`` / ``X.XM``; blank on zero."""
    if v >= 1_000_000:
        return f"{v / 1_000_000:.1f}M"
    if v >= 1_000:
        return f"{v / 1_000:.1f}k"
    return f"{v:.0f}" if v else ""


def home_window(months: list, n_series: int, default_months: int = 7,
                max_bars: int = 20) -> list | None:
    """The opening x-axis range: the last ``default_months`` months, shrunk so the
    grouped bar count (months × selections) stays within ``max_bars``.

    Returns ``[lo_iso, hi_iso]`` (half-month padded) or ``None`` when there are no
    months. Shared by the figure builder and the Budget page's Home button so both
    agree on exactly which window "home" means.
    """
    if not months:
        return None
    n = max(1, n_series)
    visible = min(len(months), default_months, max(1, max_bars // n))
    last = months[-1]
    first = months[len(months) - visible]
    return [(first.to_timestamp() - pd.Timedelta(days=15)).isoformat(),
            (last.to_timestamp() + pd.Timedelta(days=15)).isoformat()]


def build_spending_trend(series: list[dict], currency: str = "THB", dark: bool = True,
                         censor: bool = False, default_months: int = 7,
                         max_bars: int = 20) -> go.Figure:
    """Grouped monthly-spend bar chart for one or more selections.

    ``series`` is ``[{"label": str, "months": [pd.Period...], "values": [float...]}]``
    (every series shares the same ``months`` axis). The x-axis opens on the most recent
    ``default_months`` months, but the window is shrunk when needed so the total number
    of grouped bars (months × selections) stays within ``max_bars`` — keeping the view
    uncrowded. Older months are reachable by panning.
    """
    ft = theme.fig_theme(dark)
    fig = go.Figure()
    multi = len(series) > 1

    months = series[0]["months"] if series else []
    x = [m.to_timestamp() for m in months]
    for i, s in enumerate(series):
        color = _TREND_PALETTE[i % len(_TREND_PALETTE)]
        labels = ["" if censor else _bar_label(v) for v in s["values"]]
        fig.add_trace(go.Bar(
            x=[m.to_timestamp() for m in s["months"]], y=s["values"],
            name=s["label"], marker=dict(color=color),
            text=labels, textposition="outside", textfont=dict(color=color),
            cliponaxis=False,
            hovertemplate="%{x|%b %Y}<br>" + s["label"] + ": "
                          + ("*****" if censor else "%{y:,.0f} " + currency)
                          + "<extra></extra>",
        ))

    # Open on the last `visible` months — `default_months`, but capped so months ×
    # selections ≤ `max_bars` (grouped selections shrink the window). Panning left
    # reveals earlier history; the page's Home button relayouts back to this range.
    x_range = home_window(months, len(series), default_months, max_bars)

    # Headroom above the tallest bar so the outside labels aren't clipped.
    all_values = [v for s in series for v in s["values"]]
    ymax = max(all_values, default=0)
    y_range = [0, ymax * 1.18] if ymax > 0 else None

    fig.update_layout(
        template=ft.template, barmode="group",
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        showlegend=multi,
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        margin=dict(t=48, b=40, l=56, r=16),
        dragmode="pan",
        hoverlabel=dict(bgcolor=ft.anno_bg, bordercolor=ft.grid,
                        font=dict(color=ft.ink)),
    )
    # `autorange=False` pins the opening window as the reset target so the Home
    # (Reset axes) button returns here instead of autoscaling to the full history.
    fig.update_xaxes(type="date", tickformat="%b %y", range=x_range,
                     autorange=False, gridcolor=ft.grid)
    # `fixedrange` locks the y-axis: only horizontal panning is possible.
    fig.update_yaxes(title_text=currency, showticklabels=not censor,
                     gridcolor=ft.grid, zeroline=False,
                     range=y_range, fixedrange=True)
    return fig
