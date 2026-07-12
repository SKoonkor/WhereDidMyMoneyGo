"""Income-tax figure — tax contributed by each progressive bracket."""

import plotly.graph_objects as go

from src.app import theme


def build_tax_figure(status: dict, currency: str = "THB", dark: bool = True) -> go.Figure:
    """A bar per tax band that has income in it: x = the band's rate, y = the tax
    it contributes. The top (marginal) band is highlighted."""
    ft = theme.fig_theme(dark)
    rows = status.get("bracket_rows") or []
    fig = go.Figure()

    if not rows:
        fig.add_annotation(text="No taxable income — no tax due.",
                           xref="paper", yref="paper", x=0.5, y=0.5,
                           showarrow=False, font=dict(color=ft.muted, size=15))
    else:
        labels = [f"{r['rate']*100:.0f}%" for r in rows]
        taxes = [r["tax"] for r in rows]
        incomes = [r["income_in_band"] for r in rows]
        # Dim every band except the marginal (top) one.
        colors = [theme.SAVING_COLOR] * len(rows)
        colors[-1] = theme.INCOME_COLOR
        fig.add_trace(go.Bar(
            x=labels, y=taxes, marker=dict(color=colors, line=dict(width=0)),
            customdata=incomes,
            hovertemplate=("Band %{x}<br>Income in band %{customdata:,.0f} " + currency
                           + "<br>Tax %{y:,.0f} " + currency + "<extra></extra>"),
            text=[f"{t:,.0f}" for t in taxes], textposition="outside",
        ))

    fig.update_layout(
        template=ft.template,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        title=dict(text="Tax by bracket", x=0.5, xanchor="center",
                   y=0.97, yanchor="top"),
        xaxis=dict(title="Marginal rate"),
        yaxis=dict(title=f"Tax ({currency})"),
        hoverlabel=dict(bgcolor=ft.anno_bg, bordercolor=ft.grid,
                        font=dict(color=ft.ink)),
        showlegend=False,
        margin=dict(t=70, b=50, l=60, r=20),
    )
    return fig
