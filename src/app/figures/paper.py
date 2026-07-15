"""Paper Trading equity chart.

One line per portfolio (account equity sampled over real calendar time), a faint
dotted principal line per portfolio (net capital put in, colour-matched to its
equity line), and the S&P 500 normalised to the starting cash (dashed). Mirrors
the Investment Simulator's comparison chart.
"""

from __future__ import annotations

import plotly.graph_objects as go

from src.app import theme
from src.app.i18n import t
from src.app.figures.investment import add_cursor_spike

# Match the Investment Simulator's portfolio palette (blue, orange, purple).
PORTFOLIO_COLORS = ["#3498db", "#e67e22", "#9b59b6"]


def _faint(hex_color: str, alpha: float = 0.45) -> str:
    """A translucent rgba() of a #rrggbb colour, for the principal reference line."""
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r},{g},{b},{alpha})"


def build_equity_figure(port_series: dict, spx, principal: dict | None = None,
                        dark: bool = True) -> go.Figure:
    ft = theme.fig_theme(dark)
    principal = principal or {}
    fig = go.Figure()

    for i, (name, s) in enumerate(port_series.items()):
        color = PORTFOLIO_COLORS[i % len(PORTFOLIO_COLORS)]
        # Faint dotted principal (net capital put in) beneath this portfolio's line.
        p = principal.get(name)
        if p is not None and len(p):
            fig.add_trace(go.Scatter(
                x=list(p.index), y=list(p.values), mode="lines",
                name=t("{name} principal").format(name=name), showlegend=False,
                hoverinfo="skip",
                line=dict(color=_faint(color), width=1.5, dash="dot",
                          shape="hv"),
            ))
        if s is None or not len(s):
            continue
        fig.add_trace(go.Scatter(
            x=list(s.index), y=list(s.values), mode="lines", name=name,
            line=dict(color=color, width=2.8),
            hovertemplate="%{x|%d %b %H:%M}<br>%{y:,.0f} USD<extra>" + name + "</extra>",
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
        title=dict(text=t("Account equity over time"), x=0.5, xanchor="center",
                   y=0.97, yanchor="top"),
        xaxis_title=t("Time"), yaxis_title=t("Equity (USD)"),
        hovermode="x unified", dragmode="pan",
        hoverlabel=dict(bgcolor="rgba(0,0,0,0)"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0),
        margin=dict(t=70, b=40, l=60, r=20),
    )
    add_cursor_spike(fig, ft)
    return fig
