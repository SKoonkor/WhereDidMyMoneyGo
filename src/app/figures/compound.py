"""Compound interest calculator (slide 7).

A standalone learning tool (does not use tracked data). Deposits are treated as
made at the start of each month (annuity due) and grow at a monthly-equivalent
rate derived from the effective annual yield (APY) of the chosen compounding
frequency, so the result is consistent with the displayed APY.
"""

import numpy as np
import plotly.graph_objects as go

from src.app import theme
from src.app.i18n import make_t

t = make_t("compound")

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


def _simulate_bought(P: float, D: float, cap: int, i: float, goals,
                     use_factor: bool = True) -> tuple:
    """Balance series when each goal is *bought* as it's reached.

    ``goals`` is ``[(name, amount, factor)]`` in **Financial-Goals rank order**
    (top-ranked first). It's a strict FIFO queue: the front goal must be bought
    before the next is considered (buy the front when ``bal >= target``, subtract
    its actual ``amount``, advance). ``target = amount*factor`` when ``use_factor``
    else ``amount`` — so the "no factor" line buys at the plain amount. ``target >=
    amount`` in both modes, so the balance never goes negative. Returns
    ``(series[cap+1], hits)`` where each hit is ``{name, month, target}``.
    """
    queue = [{"name": nm, "amount": float(a),
              "target": float(a) * (float(f) if use_factor else 1.0)}
             for nm, a, f in goals]                    # rank order preserved
    values = np.empty(cap + 1)
    bal = float(P)
    hits = []

    def _buy(month: int) -> None:
        nonlocal bal
        while queue and bal >= queue[0]["target"]:
            g = queue.pop(0)
            hits.append({"name": g["name"], "month": int(month), "target": g["target"]})
            bal -= g["amount"]

    _buy(0)
    values[0] = bal
    for m in range(1, cap + 1):
        bal = (bal + D) * (1 + i)
        _buy(m)
        values[m] = bal
    return values, hits


def compute_schedule(P: float, D: float, M: int, annual_rate: float,
                     compounding: str = "Annually", goals=None) -> dict:
    """Return totals and per-month series for the calculator.

    ``goals`` is a list of ``(name, amount, factor)``. The series runs to an
    extended horizon ``H >= M`` (so the user can scroll past the set period to see
    when goals are reached), but the reported totals are taken at ``M``. A second
    "goals bought" series subtracts each goal's amount as it's reached.
    """
    n = COMPOUNDING.get(compounding, 1)
    goals = goals or []
    cap = max(1200, M)
    i = (1 + apy(annual_rate, n)) ** (1 / 12) - 1

    pure = _maturity_series(P, D, cap, annual_rate, n)
    bought, hits = _simulate_bought(P, D, cap, i, goals, use_factor=True)
    bought_p, hits_p = _simulate_bought(P, D, cap, i, goals, use_factor=False)

    base = max(M, int(round(M * 1.5)))
    all_hits = hits + hits_p
    if all_hits:
        H = min(cap, max(base, max(h["month"] for h in all_hits) + 12))
    elif goals:
        target = max(a * f for _, a, f in goals)
        idx = np.where(pure >= target)[0]
        reached = int(idx[0]) if idx.size else cap
        H = min(cap, max(base, reached + 12))
    else:
        H = min(cap, base)

    months = np.arange(H + 1)
    principal = P + D * months                       # cumulative contributions
    maturity = pure[:H + 1]

    total_principal = float(principal[M])
    maturity_value = float(maturity[M])
    interest = maturity_value - total_principal

    # Per-goal "month reached" under the three strategies drawn on the chart:
    #   • no-buy   — first month the pure maturity line reaches the goal's actual
    #                amount (money is never spent, so all goals share one balance);
    #   • plain    — the month it's bought at its actual amount (sequential);
    #   • factor   — the month it's bought at amount × factor (sequential).
    # Buy months come straight from the two simulations; the no-buy month is read
    # off the full pure series (to cap), so goals beyond the plotted horizon still
    # get an accurate figure. ``None`` means "not reached within the horizon".
    hit_f = {h["name"]: h["month"] for h in hits}
    hit_p = {h["name"]: h["month"] for h in hits_p}
    achievement = []
    for nm, a, f in goals:
        idx = np.where(pure >= float(a))[0]
        achievement.append({
            "name": nm,
            "amount": float(a),
            "factor": float(f),
            "month_nobuy": int(idx[0]) if idx.size else None,
            "month_plain": hit_p.get(nm),
            "month_factor": hit_f.get(nm),
        })

    return {
        "months": months,
        "principal": principal,
        "maturity": maturity,
        "maturity_bought": bought[:H + 1],
        "goal_hits": [h for h in hits if h["month"] <= H],
        "maturity_bought_plain": bought_p[:H + 1],
        "goal_hits_plain": [h for h in hits_p if h["month"] <= H],
        "maturity_low": _maturity_series(P, D, H, annual_rate * (1 - RATE_VARIATION), n),
        "maturity_high": _maturity_series(P, D, H, annual_rate * (1 + RATE_VARIATION), n),
        "period": M,
        "total_principal": total_principal,
        "maturity_value": maturity_value,
        "interest": interest,
        "apy": apy(annual_rate, n),
        "annual_rate": annual_rate,
        "achievement": achievement,
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
        name=t("±20% rate ({lo}–{hi}%)").format(
            lo=f"{rate_pct*0.8:.0f}", hi=f"{rate_pct*1.2:.0f}"),
        hoverinfo="skip",
    ))

    fig.add_trace(go.Scatter(
        x=m, y=sched["maturity"], mode="lines",
        name=t("Maturity ({pct}%)").format(pct=f"{rate_pct:.0f}"),
        line=dict(color=theme.INCOME_COLOR, width=2.5),
        hovertemplate=t("Month") + " %{x}<br>%{y:,.0f} " + currency
                      + "<extra>" + t("Maturity") + "</extra>",
    ))
    # Balance after buying each selected goal as it's reached (its actual amount is
    # spent, so these lines dip below the pure maturity). Two variants: buying at the
    # ×factor target, and buying at the plain goal amount (no factor).
    if goals and "maturity_bought" in sched:
        fig.add_trace(go.Scatter(
            x=m, y=sched["maturity_bought"], mode="lines",
            name=t("After buying (×factor)"),
            line=dict(color="#8e44ad", width=2.5),
            hovertemplate=t("Month") + " %{x}<br>%{y:,.0f} " + currency
                          + "<extra>" + t("After buying (×factor)") + "</extra>",
        ))
    if goals and "maturity_bought_plain" in sched:
        fig.add_trace(go.Scatter(
            x=m, y=sched["maturity_bought_plain"], mode="lines",
            name=t("After buying (no factor)"),
            line=dict(color="#e84393", width=2.5),
            hovertemplate=t("Month") + " %{x}<br>%{y:,.0f} " + currency
                          + "<extra>" + t("After buying (no factor)") + "</extra>",
        ))
    fig.add_trace(go.Scatter(
        x=m, y=sched["principal"], mode="lines", name=t("Principal"),
        line=dict(color=ft.muted, width=2, dash="dash"),
        hovertemplate=t("Month") + " %{x}<br>%{y:,.0f} " + currency
                      + "<extra>" + t("Principal") + "</extra>",
    ))

    # Each goal is drawn at its EFFECTIVE target = amount × xTimes factor.
    eff = [(nm, float(a) * float(f), float(f)) for nm, a, f in goals]

    # Y-axis window: linear shows the set-period band top; log expands to fit the
    # full computed series and any selected goals.
    if logy:
        y_top = max(sched["maturity_high"][H], *([tg for _, tg, _ in eff] or [0])) * 1.1
        y_floor = max(1.0, sched["maturity"][0], sched["principal"][1] if H >= 1 else 1.0)
        yaxis = dict(type="log", range=[float(np.log10(y_floor)),
                                        float(np.log10(max(y_top, y_floor * 10)))],
                     title=t("Value ({currency})").format(currency=currency))
    else:
        y_top = float(sched["maturity_high"][M] * 1.05)
        yaxis = dict(range=[0, y_top],
                     title=t("Value ({currency})").format(currency=currency))

    # Selected goals, smallest effective target first so they stack low→high (the
    # smallest is reached first). Every goal gets a horizontal labeled line (always
    # present, so panning the y-axis up reveals the ones above the initial window).
    # Goals above that window also get a right-arrow label at the top-right; a
    # clientside callback hides each arrow once its line is panned into view.
    ranked = sorted(eff, key=lambda g: g[1])
    colored = [(nm, tg, f, GOAL_PALETTE[i % len(GOAL_PALETTE)])
               for i, (nm, tg, f) in enumerate(ranked)]
    color_by_name = {nm: c for nm, _, _, c in colored}
    for name, target, factor, color in colored:
        label = f"{name} (×{factor:g})" if factor > 1 else name
        fig.add_hline(y=target, line=dict(color=color, dash="dot", width=1.5))
        # The line shape auto-maps to log space, but a layout annotation on a log
        # axis needs y given as log10(value) — convert so the label sits on the line.
        fig.add_annotation(
            xref="x domain", x=0, xanchor="left",
            yref="y", y=(float(np.log10(target)) if logy else target),
            yanchor="bottom", yshift=6, showarrow=False,
            text=label, font=dict(color=color, size=13),
        )

    # Markers where each goal is bought — on the ×factor line (circles, at the
    # effective target) and on the no-factor line (diamonds, at the plain amount).
    def _hit_markers(hits, symbol):
        if not hits:
            return
        fig.add_trace(go.Scatter(
            x=[h["month"] for h in hits],
            y=[h["target"] for h in hits],   # raw value; log axis maps it automatically
            mode="markers", showlegend=False, hoverinfo="text",
            hovertext=[t("{name} bought · month {month}").format(
                name=h['name'], month=h['month']) for h in hits],
            marker=dict(size=11, symbol=symbol,
                        color=[color_by_name.get(h["name"], theme.SAVING_COLOR)
                               for h in hits],
                        line=dict(color="#fff", width=1.5)),
        ))

    _hit_markers(sched.get("goal_hits") or [], "circle")
    _hit_markers(sched.get("goal_hits_plain") or [], "diamond")

    above = [(nm, t, c) for (nm, t, f, c) in colored if t > y_top]
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
        title=dict(text=t("Growth over time"), x=0.5, xanchor="center",
                   y=0.97, yanchor="top"),
        xaxis=dict(title=t("Months"), range=[0, M], autorange=False),
        yaxis=yaxis,
        hovermode="x unified",
        # Theme-aware unified-hover box (default was a bright box with grey text in
        # dark mode). anno_bg/ink/grid flip with the theme.
        hoverlabel=dict(bgcolor=ft.anno_bg, bordercolor=ft.grid,
                        font=dict(color=ft.ink)),
        dragmode="pan",
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        margin=dict(t=90, b=40, l=60, r=20),
    )
    return fig, arrows
