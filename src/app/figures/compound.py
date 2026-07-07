"""Compound interest calculator (slide 7).

A standalone learning tool (does not use tracked data). Deposits are treated as
made at the start of each month (annuity due) and grow at a monthly-equivalent
rate derived from the effective annual yield (APY) of the chosen compounding
frequency, so the result is consistent with the displayed APY.
"""

import numpy as np
import plotly.graph_objects as go

from src.app import theme

# Compounding label → periods per year.
COMPOUNDING = {"Monthly": 12, "Quarterly": 4, "6 Months": 2, "Annually": 1}

RATE_VARIATION = 0.20  # ±20% band on the annual rate

# Distinct colors cycled across selected goal lines/labels.
GOAL_PALETTE = ["#3498db", "#9b59b6", "#e67e22", "#1abc9c", "#e74c3c", "#f1c40f"]


def apy(annual_rate: float, periods_per_year: int) -> float:
    """Effective annual yield for a nominal rate at the given compounding."""
    n = periods_per_year
    return (1 + annual_rate / n) ** n - 1


def _maturity_series(P: float, D: float, M: int, annual_rate: float, n: int) -> np.ndarray:
    """Balance after each month 0..M (deposit at start of month, annuity due)."""
    i = (1 + apy(annual_rate, n)) ** (1 / 12) - 1
    values = np.empty(M + 1)
    bal = P
    values[0] = bal
    for m in range(1, M + 1):
        bal = (bal + D) * (1 + i)
        values[m] = bal
    return values


def _choose_horizon(P: float, D: float, M: int, annual_rate: float, n: int,
                    goal_values=None, min_factor: float = 1.5) -> int:
    """Months to plot: at least ~1.5× the set period (scroll room), extended to
    reach the furthest selected goal. Bounded by a cap, but never below M so the
    set-period totals (index M) are always valid."""
    cap = max(1200, M)
    base = max(M, int(round(M * min_factor)))
    if not goal_values:
        return min(cap, base)
    target = max(goal_values)
    series = _maturity_series(P, D, cap, annual_rate, n)
    hit = np.where(series >= target)[0]
    reached = int(hit[0]) if hit.size else cap
    return min(cap, max(base, reached + 12))


def compute_schedule(P: float, D: float, M: int, annual_rate: float,
                     compounding: str = "Annually", goal_values=None) -> dict:
    """Return totals and per-month series for the calculator.

    The series runs to an extended horizon ``H >= M`` (so the user can scroll past
    the set period to see when goals are reached), but the reported totals are
    taken at the set period ``M``.
    """
    n = COMPOUNDING.get(compounding, 1)
    H = _choose_horizon(P, D, M, annual_rate, n, goal_values)
    months = np.arange(H + 1)
    principal = P + D * months                       # cumulative contributions
    maturity = _maturity_series(P, D, H, annual_rate, n)

    total_principal = float(principal[M])
    maturity_value = float(maturity[M])
    interest = maturity_value - total_principal

    return {
        "months": months,
        "principal": principal,
        "maturity": maturity,
        "maturity_low": _maturity_series(P, D, H, annual_rate * (1 - RATE_VARIATION), n),
        "maturity_high": _maturity_series(P, D, H, annual_rate * (1 + RATE_VARIATION), n),
        "period": M,
        "total_principal": total_principal,
        "maturity_value": maturity_value,
        "interest": interest,
        "apy": apy(annual_rate, n),
        "annual_rate": annual_rate,
    }


def build_compound_figure(sched: dict, currency: str = "THB",
                          dark: bool = True, goals=None, logy: bool = False) -> go.Figure:
    ft = theme.fig_theme(dark)
    m = sched["months"]
    M = int(sched.get("period", m[-1]))
    H = int(m[-1])
    rate_pct = sched["annual_rate"] * 100
    goals = goals or []
    fig = go.Figure()

    # ±20% rate uncertainty band on the maturity value.
    fig.add_trace(go.Scatter(
        x=m, y=sched["maturity_high"], mode="lines", line=dict(width=0),
        hoverinfo="skip", showlegend=False,
    ))
    fig.add_trace(go.Scatter(
        x=m, y=sched["maturity_low"], mode="lines", line=dict(width=0),
        fill="tonexty", fillcolor="rgba(46,204,113,0.18)",
        name=f"±20% rate ({rate_pct*0.8:.0f}–{rate_pct*1.2:.0f}%)",
        hoverinfo="skip",
    ))

    fig.add_trace(go.Scatter(
        x=m, y=sched["maturity"], mode="lines", name=f"Maturity ({rate_pct:.0f}%)",
        line=dict(color=theme.INCOME_COLOR, width=2.5),
        hovertemplate="Month %{x}<br>%{y:,.0f} " + currency + "<extra>Maturity</extra>",
    ))
    fig.add_trace(go.Scatter(
        x=m, y=sched["principal"], mode="lines", name="Principal",
        line=dict(color=ft.muted, width=2, dash="dash"),
        hovertemplate="Month %{x}<br>%{y:,.0f} " + currency + "<extra>Principal</extra>",
    ))

    # Y-axis window: linear shows the set-period band top; log expands to fit the
    # full computed series and any selected goals.
    if logy:
        y_top = max(sched["maturity_high"][H], *([g for _, g in goals] or [0])) * 1.1
        y_floor = max(1.0, sched["maturity"][0], sched["principal"][1] if H >= 1 else 1.0)
        yaxis = dict(type="log", range=[float(np.log10(y_floor)),
                                        float(np.log10(max(y_top, y_floor * 10)))],
                     title=f"Value ({currency})")
    else:
        y_top = float(sched["maturity_high"][M] * 1.05)
        yaxis = dict(range=[0, y_top], title=f"Value ({currency})")

    # Selected goals, smallest target first so they stack low→high (the smallest is
    # reached first). Every goal gets a horizontal labeled line (always present, so
    # panning the y-axis up reveals the ones above the initial window). Goals above
    # that window also get a right-arrow label at the top-right; a clientside callback
    # hides each arrow once its line is panned into view. Returns those arrows' info.
    ranked = sorted(goals, key=lambda g: g[1])
    colored = [(n, t, GOAL_PALETTE[i % len(GOAL_PALETTE)])
               for i, (n, t) in enumerate(ranked)]
    for name, target, color in colored:
        fig.add_hline(y=target, line=dict(color=color, dash="dot", width=1.5))
        # The line shape auto-maps to log space, but a layout annotation on a log
        # axis needs y given as log10(value) — convert so the label sits on the line.
        fig.add_annotation(
            xref="x domain", x=0, xanchor="left",
            yref="y", y=(float(np.log10(target)) if logy else target),
            yanchor="bottom", yshift=6, showarrow=False,
            text=name, font=dict(color=color, size=13),
        )
    above = [(n, t, c) for (n, t, c) in colored if t > y_top]
    arrows = []
    for k, (name, target, color) in enumerate(above):   # k=0 → smallest → bottom
        fig.add_annotation(xref="paper", yref="paper", x=0.99,
                           y=0.98 - (len(above) - 1 - k) * 0.06,
                           xanchor="right", yanchor="top", showarrow=False,
                           text=f"{name} →", font=dict(color=color, size=13))
        arrows.append({"i": len(fig.layout.annotations) - 1, "target": float(target)})

    fig.update_layout(
        template=ft.template,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        title=dict(text="Growth over time", x=0.5, xanchor="center",
                   y=0.97, yanchor="top"),
        xaxis=dict(title="Months", range=[0, M], autorange=False),
        yaxis=yaxis,
        hovermode="x unified",
        dragmode="pan",
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        margin=dict(t=90, b=40, l=60, r=20),
    )
    return fig, arrows
