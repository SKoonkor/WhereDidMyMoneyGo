"""Figures for the Stock Intrinsic Valuation page."""

import numpy as np
import plotly.graph_objects as go

from src.app import theme
from src.app.i18n import make_t

t = make_t("valuation")

_UNDER = "#2ecc71"   # green: fair > price (undervalued)
_OVER = "#e74c3c"    # red:   fair < price (overvalued)


def _pl_color(fair, price):
    return _UNDER if (fair is not None and price and fair >= price) else _OVER


def build_valuation_gauge(fair, price, currency="USD", dark=True) -> go.Figure:
    """Over/under-valuation gauge: margin of safety of fair vs current price."""
    ft = theme.fig_theme(dark)
    fig = go.Figure()
    if not fair or not price:
        fig.add_annotation(text=t("No valuation"), x=0.5, y=0.5, xref="paper",
                           yref="paper", showarrow=False, font=dict(color=ft.muted))
    else:
        mos = fair / price - 1.0
        color = _pl_color(fair, price)
        # mode="gauge" only: the bundled plotly.js ignores number.valueformat and
        # renders the raw float, so we draw the value ourselves as a formatted
        # annotation (always exactly ±XX.XX%).
        fig.add_trace(go.Indicator(
            mode="gauge",
            value=mos * 100,
            title={"text": t("Margin of safety") + "<br><span style='font-size:0.75em;"
                           f"color:{ft.muted}'>"
                           + t("fair {fair} vs price {price} {currency}").format(
                               fair=f"{fair:,.0f}", price=f"{price:,.0f}",
                               currency=currency) + "</span>"},
            gauge={
                "axis": {"range": [-60, 60], "ticksuffix": "%"},
                "bar": {"color": color},
                "steps": [{"range": [-60, 0], "color": theme.gauge_bands(dark)[0]},
                          {"range": [0, 60], "color": theme.gauge_bands(dark)[2]}],
                "threshold": {"line": {"color": ft.ink, "width": 3},
                              "thickness": 0.8, "value": 0},
            },
        ))
        fig.add_annotation(text=f"{mos * 100:+.2f}%", x=0.5, y=0.08,
                           xref="paper", yref="paper", showarrow=False,
                           font=dict(size=30, color=color))
    fig.update_layout(template=ft.template, paper_bgcolor="rgba(0,0,0,0)",
                      margin=dict(t=70, b=20, l=30, r=30))
    return fig


def build_methods_bar(results, price, currency="USD", dark=True) -> go.Figure:
    """Horizontal fair-value bars per method + a dashed current-price line."""
    ft = theme.fig_theme(dark)
    rows = [r for r in results if r["fair"] is not None]
    fig = go.Figure()
    if rows:
        names = [r["name"] for r in rows]
        vals = [r["fair"] for r in rows]
        colors = [_pl_color(r["fair"], price) for r in rows]
        fig.add_trace(go.Bar(
            x=vals, y=names, orientation="h", marker=dict(color=colors),
            text=[f"{v:,.0f}" for v in vals], textposition="outside",
            hovertemplate="%{y}: %{x:,.2f} " + currency + "<extra></extra>",
        ))
        if price:
            fig.add_vline(x=price, line=dict(color=ft.ink, width=1.5, dash="dash"),
                          annotation_text=t("Price {price}").format(
                              price=f"{price:,.0f}"),
                          annotation_position="top")
    else:
        fig.add_annotation(text=t("No values"), x=0.5, y=0.5, xref="paper", yref="paper",
                           showarrow=False, font=dict(color=ft.muted))
    fig.update_layout(
        template=ft.template, paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)", showlegend=False,
        title=dict(text=t("Fair value by method"), x=0.5, xanchor="center"),
        xaxis_title=t("Value / share ({currency})").format(currency=currency),
        yaxis=dict(autorange="reversed"), dragmode="pan",
        margin=dict(t=50, b=40, l=140, r=40),
    )
    return fig


def build_dcf_breakdown(dcf, currency="USD", dark=True) -> go.Figure:
    """Discounted FCF per forecast year + the terminal-value bar."""
    ft = theme.fig_theme(dark)
    fig = go.Figure()
    if dcf and dcf.get("pv_by_year"):
        pv = dcf["pv_by_year"]
        years = [f"Y{yr}" for yr in range(1, len(pv) + 1)] + [t("Terminal")]
        vals = [p / 1e9 for p in pv] + [dcf["tv_pv"] / 1e9]
        colors = [theme.SAVING_COLOR] * len(pv) + ["#9b59b6"]
        fig.add_trace(go.Bar(
            x=years, y=vals, marker=dict(color=colors),
            hovertemplate="%{x}: %{y:,.1f} B " + currency + "<extra></extra>",
        ))
        tv_share = dcf["tv_pv"] / dcf["ev"] * 100 if dcf["ev"] else 0
        fig.add_annotation(x=0.99, y=0.98, xref="paper", yref="paper",
                           xanchor="right", yanchor="top", showarrow=False,
                           text=t("Terminal value = {pct}% of EV").format(
                               pct=f"{tv_share:.0f}"),
                           font=dict(color=(_OVER if tv_share > 85 else ft.muted),
                                     size=12))
    else:
        fig.add_annotation(text=t("DCF n/a"), x=0.5, y=0.5, xref="paper", yref="paper",
                           showarrow=False, font=dict(color=ft.muted))
    fig.update_layout(
        template=ft.template, paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)", showlegend=False,
        title=dict(text=t("DCF: present value of cash flows"), x=0.5, xanchor="center"),
        yaxis_title=t("PV (billion {currency})").format(currency=currency),
        dragmode="pan",
        margin=dict(t=50, b=40, l=60, r=20),
    )
    return fig


def build_scenarios_bar(scen, price, currency="USD", dark=True) -> go.Figure:
    """Bear / Base / Bull DCF fair values + price line."""
    ft = theme.fig_theme(dark)
    order = ["Bear", "Base", "Bull"]
    vals = [scen.get(k) for k in order]
    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=[t(k) for k in order], y=[v or 0 for v in vals],
        marker=dict(color=[_pl_color(v, price) for v in vals]),
        text=[f"{v:,.0f}" if v else "n/a" for v in vals], textposition="outside",
        hovertemplate="%{x}: %{y:,.2f} " + currency + "<extra></extra>",
    ))
    if price:
        fig.add_hline(y=price, line=dict(color=ft.ink, width=1.5, dash="dash"),
                      annotation_text=t("Price {price}").format(price=f"{price:,.0f}"),
                      annotation_position="right")
    fig.update_layout(
        template=ft.template, paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)", showlegend=False,
        title=dict(text=t("DCF scenarios"), x=0.5, xanchor="center"),
        yaxis_title=t("Fair value ({currency})").format(currency=currency),
        dragmode="pan",
        margin=dict(t=50, b=30, l=60, r=40),
    )
    return fig


def build_sensitivity_heatmap(grid, r_vals, gT_vals, price, currency="USD",
                              dark=True) -> go.Figure:
    """FairValue(discount rate × terminal growth) heatmap, centered on the price."""
    ft = theme.fig_theme(dark)
    z = np.array(grid, dtype=float)
    fig = go.Figure(go.Heatmap(
        z=z, x=[f"{g*100:.1f}%" for g in gT_vals], y=[f"{r*100:.1f}%" for r in r_vals],
        colorscale="RdYlGn",
        zmid=price if price else None,
        colorbar=dict(title=currency),
        hovertemplate="r=%{y}, g_T=%{x}<br>fair %{z:,.0f} " + currency + "<extra></extra>",
        text=[[f"{v:,.0f}" if np.isfinite(v) else "" for v in row] for row in z],
        texttemplate="%{text}", textfont=dict(size=10),
    ))
    fig.update_layout(
        template=ft.template, paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        title=dict(text=t("Sensitivity: fair value vs discount rate × terminal growth"),
                   x=0.5, xanchor="center"),
        xaxis_title=t("Terminal growth g_T"), yaxis_title=t("Discount rate r"),
        margin=dict(t=50, b=40, l=60, r=20),
    )
    return fig
