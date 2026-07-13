"""Retirement-projection figure for the Compound Interest page (retirement mode).

Draws the balance over the plan's lifetime on an **age** x-axis: a nominal line
(future money) and, optionally, a real line (today's purchasing power). The
retirement age is marked and its span shaded; if savings run out before life
expectancy, the depletion age is annotated.

When Financial Goals are selected, the plan is drawn as a faint no-goals baseline
plus two goal-buying trajectories — ×factor (primary) and plain — each stepping
down as goals are bought, with a marker at every purchase. Theming mirrors
``build_compound_figure``.
"""

import numpy as np
import plotly.graph_objects as go

from src.app import theme

PLAIN_COLOR = "#e84393"   # matches the Simple calculator's no-factor line


def build_retirement_figure(res: dict, currency: str = "THB", dark: bool = True,
                            show_real: bool = True) -> go.Figure:
    ft = theme.fig_theme(dark)
    ages = res["ages"]
    ret_age = float(res["retirement_age"])
    life = float(res["life_expectancy"])
    has_goals = res.get("has_goals")

    fig = go.Figure()

    # Shaded retirement span (from retirement age to life expectancy).
    if life > ret_age:
        fig.add_vrect(x0=ret_age, x1=life, line_width=0,
                      fillcolor="rgba(52,152,219,0.10)", layer="below")

    def _line(y, name, color, width=2.5, dash=None, hover="Future money"):
        fig.add_trace(go.Scatter(
            x=ages, y=y, mode="lines", name=name,
            line=dict(color=color, width=width, dash=dash),
            hovertemplate="Age %{x:.1f}<br>%{y:,.0f} " + currency
                          + f"<extra>{hover}</extra>",
        ))

    def _markers(series, hits, symbol, color):
        if not hits:
            return
        fig.add_trace(go.Scatter(
            x=[h["age"] for h in hits],
            y=[float(series[int(h["month"])]) for h in hits],
            mode="markers", showlegend=False, hoverinfo="text",
            hovertext=[f"{h['name']} bought · age {h['age']:.1f}" for h in hits],
            marker=dict(size=11, symbol=symbol, color=color,
                        line=dict(color="#fff", width=1.5)),
        ))

    drawn = []   # nominal series contributing to the y-axis top
    if has_goals:
        f_nom = res["balance_factor_nominal"]
        p_nom = res["balance_plain_nominal"]
        # Faint baseline: the plan with no goal spending, for contrast.
        _line(res["balance_nominal"], "Without goals", ft.muted, width=1.5,
              dash="dot", hover="Without goals")
        _line(f_nom, "After buying (×factor)", theme.INCOME_COLOR, hover="×factor")
        _line(p_nom, "After buying (plain)", PLAIN_COLOR, hover="Plain amount")
        if show_real:
            _line(res["balance_factor_real"], "×factor (today's money)",
                  theme.SAVING_COLOR, width=2, dash="dash", hover="×factor · today")
        _markers(f_nom, res.get("goal_hits_factor"), "circle", theme.INCOME_COLOR)
        _markers(p_nom, res.get("goal_hits_plain"), "diamond", PLAIN_COLOR)
        drawn = [f_nom, p_nom, res["balance_nominal"]]
        if show_real:
            drawn.append(res["balance_factor_real"])
        depletion_age = (res.get("summary_factor") or {}).get("depletion_age")
    else:
        _line(res["balance_nominal"], "Balance (future money)", theme.INCOME_COLOR)
        drawn = [res["balance_nominal"]]
        if show_real:
            _line(res["balance_real"], "Balance (today's money)",
                  theme.SAVING_COLOR, width=2, dash="dash", hover="Today's money")
            drawn.append(res["balance_real"])
        depletion_age = res.get("depletion_age")

    # Retirement age marker.
    fig.add_vline(x=ret_age, line=dict(color=ft.muted, dash="dot", width=1.5))
    fig.add_annotation(x=ret_age, yref="paper", y=1.0, yanchor="bottom",
                       showarrow=False, text=f"Retire · {ret_age:g}",
                       font=dict(color=ft.ink, size=12))

    # Depletion marker, when savings run out before life expectancy (primary
    # strategy when goals are selected).
    if depletion_age is not None:
        fig.add_vline(x=float(depletion_age),
                      line=dict(color=theme.EXPENSE_COLOR, dash="dot", width=1.5))
        fig.add_annotation(x=float(depletion_age), yref="paper", y=0.92,
                           yanchor="top", xanchor="left", xshift=4, showarrow=False,
                           text=f"Funds depleted · age {depletion_age:.0f}",
                           font=dict(color=theme.EXPENSE_COLOR, size=12))

    y_top = max((float(np.max(s)) for s in drawn if s.size), default=1.0) * 1.08

    fig.update_layout(
        template=ft.template,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        title=dict(text="Retirement projection", x=0.5, xanchor="center",
                   y=0.97, yanchor="top"),
        xaxis=dict(title="Age", range=[float(ages[0]), float(ages[-1])]),
        yaxis=dict(title=f"Value ({currency})", range=[0, y_top or 1.0]),
        hovermode="x unified",
        hoverlabel=dict(bgcolor=ft.anno_bg, bordercolor=ft.grid,
                        font=dict(color=ft.ink)),
        dragmode="pan",
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        margin=dict(t=90, b=40, l=60, r=20),
    )
    return fig
