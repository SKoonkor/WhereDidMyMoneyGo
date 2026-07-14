"""Spending-trend histogram for the Budget page (the click-to-drill view).

Replaces the two monthly pies when a category / sub-category row is clicked in the
Sub-category detail table: a bar chart of that item's monthly spend. Several selections
render as grouped bars on one shared, pannable time axis (colour per selection). Kept
Dash-free — the page precomputes each series so this stays unit-testable.
"""

import pandas as pd
import plotly.graph_objects as go

from src.app import theme

# Distinct, readable series colours (one per selection, in click order).
_TREND_PALETTE = ["#3498db", "#e67e22", "#2ecc71", "#9b59b6", "#1abc9c",
                  "#e84393", "#f1c40f", "#e74c3c"]


def build_spending_trend(series: list[dict], currency: str = "THB", dark: bool = True,
                         censor: bool = False, default_months: int = 5) -> go.Figure:
    """Grouped monthly-spend bar chart for one or more selections.

    ``series`` is ``[{"label": str, "months": [pd.Period...], "values": [float...]}]``
    (every series shares the same ``months`` axis). The x-axis opens on the most recent
    ``default_months`` months; older months are reachable by panning.
    """
    ft = theme.fig_theme(dark)
    fig = go.Figure()
    multi = len(series) > 1

    months = series[0]["months"] if series else []
    x = [m.to_timestamp() for m in months]
    for i, s in enumerate(series):
        color = _TREND_PALETTE[i % len(_TREND_PALETTE)]
        fig.add_trace(go.Bar(
            x=[m.to_timestamp() for m in s["months"]], y=s["values"],
            name=s["label"], marker=dict(color=color),
            hovertemplate="%{x|%b %Y}<br>" + s["label"] + ": "
                          + ("*****" if censor else "%{y:,.0f} " + currency)
                          + "<extra></extra>",
        ))

    # Open on the last `default_months` months (half-month padding so edge bars aren't
    # clipped); panning left reveals earlier history.
    x_range = None
    if x:
        last = months[-1]
        first = months[max(0, len(months) - default_months)]
        x_range = [(first.to_timestamp() - pd.Timedelta(days=15)),
                   (last.to_timestamp() + pd.Timedelta(days=15))]

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
    fig.update_xaxes(type="date", tickformat="%b %y", range=x_range,
                     gridcolor=ft.grid)
    fig.update_yaxes(title_text=currency, showticklabels=not censor,
                     gridcolor=ft.grid, zeroline=False)
    return fig
