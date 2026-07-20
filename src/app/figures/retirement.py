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

from __future__ import annotations

import numpy as np
import plotly.graph_objects as go

from src.app import theme
from src.app.i18n import make_t

t = make_t("compound")

PLAIN_COLOR = "#e84393"   # matches the Simple calculator's no-factor line
FREEDOM_COLOR = "#f1c40f"  # gold vertical line for the financial-freedom age
GOAL_COLOR = "#8e44ad"    # purple vertical band for goal-achievement age (MC mode)
GOAL_COLOR_DARK = "#5b2c6f"  # darker purple — goal lines alternate the two by order
# Goal-achievement lines/labels swap between these two shades in the order they
# appear along the x-axis (1st purple, 2nd dark, 3rd purple, …) so adjacent goals
# read as distinct even when their labels sit close together.
GOAL_COLORS = [GOAL_COLOR, GOAL_COLOR_DARK]


def _rgba(hex_color: str, alpha: float) -> str:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{alpha})"


def _leader_label(fig, x, y_paper, text, color, to_right: bool):
    """Goal label with a short 30°-down leader linking it to its vertical line at
    ``x``. The label floats up and to the side (right when ``to_right`` else left) and
    Plotly draws the connector from the text-box edge — near the 3rd / last-3 letters —
    down onto the line, so it never strikes through the text. Pixel offsets keep the
    30° angle constant at any chart height."""
    dx = 34 if to_right else -34          # horizontal offset (text sits beside the line)
    dy = -abs(dx) * 0.5774                # tan(30°): text floats above the on-line head
    fig.add_annotation(
        x=x, y=y_paper, xref="x", yref="paper",
        ax=dx, ay=dy, axref="pixel", ayref="pixel",
        text=text, showarrow=True, arrowhead=0, arrowwidth=1.2, arrowcolor=color,
        xanchor=("left" if to_right else "right"), yanchor="bottom",
        font=dict(color=color, size=12),
    )


def _band(fig, x, lo, hi, fill):
    """A filled percentile band between ``lo`` and ``hi`` (two invisible edge lines
    joined by a ``tonexty`` fill). Non-interactive and hidden from the legend."""
    fig.add_trace(go.Scatter(x=x, y=lo, mode="lines", line=dict(width=0),
                             hoverinfo="skip", showlegend=False))
    fig.add_trace(go.Scatter(x=x, y=hi, mode="lines", line=dict(width=0),
                             fill="tonexty", fillcolor=fill, hoverinfo="skip",
                             showlegend=False))


def _event_band(fig, ev, color, ages, label, y_paper, age_suffix, connector=False):
    """Draw a Monte Carlo event (freedom / depletion / a goal) as a vertical shaded band
    spanning its 16th–84th-percentile age, with a dashed median line and a label at the
    median. ``ev`` is ``{"p16","p50","p84",...}``; a no-op when ``ev`` is falsy. The
    label reads ``"<label>: <age><age_suffix>"`` (e.g. "iPad Pro: 31yo"). ``connector``
    adds the short 30° leader linking the label to its line (goals only).

    The funds-out event reports its percentiles over ALL runs, so any of them may be
    ``None`` — "past life expectancy". The band is then clipped to the chart's right
    edge, and a censored median gets a "{life}+" label at the edge instead of a line."""
    if not ev or ev.get("p16") is None:
        return
    x0, x1 = float(ages[0]), float(ages[-1])
    p16, p50 = ev["p16"], ev.get("p50")
    p84 = ev["p84"] if ev.get("p84") is not None else x1
    if p84 > p16:
        fig.add_vrect(x0=p16, x1=p84, line_width=0, fillcolor=_rgba(color, 0.12),
                      layer="below")
    if p50 is None:
        fig.add_annotation(x=x1, yref="paper", y=y_paper, yanchor="top",
                           xanchor="right", xshift=-4, showarrow=False,
                           text=f"{label}: {x1:.0f}+{age_suffix}",
                           font=dict(color=color, size=12))
        return
    fig.add_vline(x=p50, line=dict(color=color, dash="dash", width=1.5))
    frac = (p50 - x0) / (x1 - x0) if x1 > x0 else 0.0
    text = f"{label}: {p50:.0f}{age_suffix}"
    if connector:   # goals: label floats with a 30° leader down to the line
        _leader_label(fig, p50, y_paper, text, color, to_right=(frac <= 0.6))
    else:
        xa, xs = ("right", -4) if frac > 0.6 else ("left", 4)
        fig.add_annotation(x=p50, yref="paper", y=y_paper, yanchor="top", xanchor=xa,
                           xshift=xs, showarrow=False, text=text,
                           font=dict(color=color, size=12))
    # NB: ``label`` is already translated (or a user goal name) at the call site.


def _stagger_y(items, x_of, ages, y_start: float, y_step: float,
               threshold: float = 0.10) -> list:
    """Pair each item with a paper y-position for its label, sorted by x. When two
    consecutive items sit within ``threshold`` of each other (as a fraction of the
    age span) — e.g. goals of similar cost bought at similar ages — the label steps
    down one level so the text doesn't stack; a comfortable gap resets to ``y_start``.
    Returns ``[(item, y), …]``."""
    x0, x1 = float(ages[0]), float(ages[-1])
    span = (x1 - x0) or 1.0
    out, last_x, level = [], None, 0
    for it in sorted(items, key=x_of):
        x = float(x_of(it))
        level = level + 1 if (last_x is not None and (x - last_x) / span < threshold) else 0
        last_x = x
        out.append((it, y_start - level * y_step))
    return out


def build_retirement_figure(res: dict, currency: str = "THB", dark: bool = True,
                            show_real: bool = True, logy: bool = False,
                            mc: dict | None = None) -> go.Figure:
    ft = theme.fig_theme(dark)
    ages = res["ages"]
    ret_age = float(res["retirement_age"])
    life = float(res["life_expectancy"])
    has_goals = res.get("has_goals")
    # Age suffix for every "<label>: <age>…" marker (e.g. "iPad Pro: 31yo"); localised
    # ("yo" in English, " ปี" in Thai) so all age labels read consistently.
    age_suffix = t("yo")

    fig = go.Figure()

    # Shaded retirement span (from retirement age to life expectancy).
    if life > ret_age:
        fig.add_vrect(x0=ret_age, x1=life, line_width=0,
                      fillcolor="rgba(52,152,219,0.10)", layer="below")

    def _line(y, name, color, width=2.5, dash=None, hover="Future money"):
        fig.add_trace(go.Scatter(
            x=ages, y=y, mode="lines", name=t(name),
            line=dict(color=color, width=width, dash=dash),
            hovertemplate=t("Age") + " %{x:.1f}<br>%{y:,.0f} " + currency
                          + f"<extra>{t(hover)}</extra>",
        ))

    def _markers(series, hits, symbol, color):
        if not hits:
            return
        fig.add_trace(go.Scatter(
            x=[h["age"] for h in hits],
            y=[float(series[int(h["month"])]) for h in hits],
            mode="markers", showlegend=False, hoverinfo="text",
            hovertext=[t("{name} bought · age {age}").format(
                name=h['name'], age=f"{h['age']:.1f}") for h in hits],
            marker=dict(size=11, symbol=symbol, color=color,
                        line=dict(color="#fff", width=1.5)),
        ))

    drawn = []   # nominal series contributing to the y-axis top
    if mc is not None:
        # Monte Carlo: a stable median (p50) line per series, with a single 16–84%
        # (±1σ) band on the primary nominal series.
        prim = mc["factor_nominal"] if has_goals else mc["nominal"]
        pcolor = theme.INCOME_COLOR
        _band(fig, ages, prim["p16"], prim["p84"], _rgba(pcolor, 0.18))
        if has_goals:
            _line(mc["nominal"]["p50"], "Without goals (median)", ft.muted,
                  width=1.5, dash="dot", hover="Without goals")
            _line(prim["p50"], "After buying ×factor (median)", pcolor, hover="×factor")
            _line(mc["plain_nominal"]["p50"], "After buying plain (median)",
                  PLAIN_COLOR, hover="Plain amount")
            if show_real:
                _line(mc["factor_real"]["p50"], "×factor today's money (median)",
                      theme.SAVING_COLOR, width=2, dash="dash", hover="×factor · today")
        else:
            _line(prim["p50"], "Balance (median)", pcolor, hover="Future money")
            if show_real:
                _line(mc["real"]["p50"], "Balance today's money (median)",
                      theme.SAVING_COLOR, width=2, dash="dash", hover="Today's money")
        drawn = [prim["p84"], prim["p50"]]
        depletion_age = None    # events are drawn from the MC distributions below
        late_dep = None
    elif has_goals:
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
        late_dep = (res.get("summary_factor") or {}).get("late_depletion_age")
    else:
        _line(res["balance_nominal"], "Balance (future money)", theme.INCOME_COLOR)
        drawn = [res["balance_nominal"]]
        if show_real:
            _line(res["balance_real"], "Balance (today's money)",
                  theme.SAVING_COLOR, width=2, dash="dash", hover="Today's money")
            drawn.append(res["balance_real"])
        depletion_age = res.get("depletion_age")
        late_dep = res.get("late_depletion_age")

    # Retirement age marker.
    fig.add_vline(x=ret_age, line=dict(color=ft.muted, dash="dot", width=1.5))
    fig.add_annotation(x=ret_age, yref="paper", y=1.0, yanchor="bottom",
                       showarrow=False,
                       text=f"{t('Retire')}: {ret_age:g}{age_suffix}",
                       font=dict(color=ft.ink, size=12))

    # Savings-running-out marker. Within life expectancy it's a red line at the
    # depletion age; if savings instead survive to life expectancy, show where they
    # would eventually run dry beyond the chart as a right-edge arrow (capped 100+).
    if depletion_age is not None:
        fig.add_vline(x=float(depletion_age),
                      line=dict(color=theme.EXPENSE_COLOR, dash="dot", width=1.5))
        # Keep the label inside the plot: put it to the left of the line when the
        # depletion age sits near the right edge, otherwise to the right.
        x0, x1 = float(ages[0]), float(ages[-1])
        frac = (float(depletion_age) - x0) / (x1 - x0) if x1 > x0 else 0.0
        xanchor, xshift = ("right", -4) if frac > 0.6 else ("left", 4)
        fig.add_annotation(x=float(depletion_age), yref="paper", y=0.92,
                           yanchor="top", xanchor=xanchor, xshift=xshift,
                           showarrow=False,
                           text=f"{t('Funds depleted')}: {depletion_age:.0f}{age_suffix}",
                           font=dict(color=theme.EXPENSE_COLOR, size=12))
    elif mc is None:
        # Funds last through life expectancy — note when they'd eventually deplete.
        # (Skipped in Monte Carlo mode, where the success probability carries this.)
        txt = (f"{t('Funds depleted')}: {late_dep:.0f}{age_suffix} →"
               if late_dep is not None
               else f"{t('Funds depleted')}: 100+{age_suffix} →")
        fig.add_annotation(xref="paper", x=0.995, xanchor="right",
                           yref="paper", y=0.92, yanchor="top", showarrow=False,
                           text=txt, font=dict(color=ft.muted, size=12))

    # Financial-freedom (FIRE) marker: the age at which investment returns alone
    # cover expenses, so savings never need to shrink. May land before your set
    # retirement age (retire early) or after it (must work longer).
    freedom_age = res.get("financial_freedom_age")
    if mc is None and freedom_age is not None:
        x0, x1 = float(ages[0]), float(ages[-1])
        frac = (float(freedom_age) - x0) / (x1 - x0) if x1 > x0 else 0.0
        fxa, fxs = ("right", -4) if frac > 0.6 else ("left", 4)
        fig.add_vline(x=float(freedom_age),
                      line=dict(color=FREEDOM_COLOR, dash="dash", width=1.5))
        fig.add_annotation(x=float(freedom_age), yref="paper", y=0.84,
                           yanchor="top", xanchor=fxa, xshift=fxs, showarrow=False,
                           text=f"{t('Financial freedom')}: {freedom_age:.0f}{age_suffix}",
                           font=dict(color=FREEDOM_COLOR, size=12))

    # Goal purchases (plain projection, no Monte Carlo): a vertical line + label at
    # each goal's ×factor buy age — the same guide the MC mode shows, so goals are
    # visible without running the simulation. Labels stagger downward when goals are
    # bought close together (similar cost → similar age) so they don't overlap.
    if mc is None and has_goals:
        hits = res.get("goal_hits_factor") or []
        x0, x1 = float(ages[0]), float(ages[-1])
        for i, (h, y) in enumerate(_stagger_y(hits, lambda g: g["age"], ages, 0.76, 0.08)):
            x = float(h["age"])
            color = GOAL_COLORS[i % 2]   # alternate purple / dark purple by x-order
            frac = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            fig.add_vline(x=x, line=dict(color=color, dash="dot", width=1))
            _leader_label(fig, x, y, f"{h['name']}: {x:.0f}{age_suffix}", color,
                          to_right=(frac <= 0.6))

    # Monte Carlo event spreads: each drawn as a vertical 16–84% band + median line.
    if mc is not None:
        _event_band(fig, mc.get("depletion"), theme.EXPENSE_COLOR, ages,
                    t("Funds depleted"), 0.92, age_suffix)
        _event_band(fig, mc.get("freedom"), FREEDOM_COLOR, ages,
                    t("Financial freedom"), 0.84, age_suffix)
        # Stagger goal labels by median age so similar-age goals don't stack; alternate
        # the two purple shades by order along the x-axis.
        goal_evs = [ev for ev in (mc.get("goal_events") or []) if ev.get("prob", 0) > 0]
        for i, (ev, y) in enumerate(_stagger_y(
                goal_evs,
                lambda e: e["p50"] if e.get("p50") is not None else ages[-1],
                ages, 0.76, 0.08)):
            _event_band(fig, ev, GOAL_COLORS[i % 2], ages, ev["name"], y,
                        age_suffix, connector=True)

    # Y-axis. On a log scale, show the full span (small→large is what log is for) with
    # a floor a few decades below the peak; annotations/vlines are paper/x-referenced
    # so they need no conversion. On a linear scale, cap the top to the "without goals"
    # baseline's height at retirement — otherwise its post-retirement growth (often tens
    # of millions) dominates and flattens the goal trajectories against the bottom.
    if logy:
        top_all = max((float(np.max(s)) for s in drawn if s.size), default=1.0) * 1.1
        y_floor = max(1.0, top_all / 1e4)
        yaxis = dict(type="log", title=t("Value ({currency})").format(currency=currency),
                     range=[float(np.log10(y_floor)),
                            float(np.log10(max(top_all, y_floor * 10)))],
                     fixedrange=True)
    else:
        baseline_at_retire = float(res.get("balance_at_retirement") or 0.0)
        if has_goals and baseline_at_retire > 0:
            y_top = baseline_at_retire
        else:
            y_top = max((float(np.max(s)) for s in drawn if s.size),
                        default=1.0) * 1.08
        yaxis = dict(title=t("Value ({currency})").format(currency=currency),
                     range=[0, y_top or 1.0], fixedrange=True)

    fig.update_layout(
        template=ft.template,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        xaxis=dict(title=t("Age"), range=[float(ages[0]), float(ages[-1])]),
        yaxis=yaxis,
        hovermode="x unified",
        hoverlabel=dict(bgcolor=ft.anno_bg, bordercolor=ft.grid,
                        font=dict(color=ft.ink)),
        dragmode="pan",
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        margin=dict(t=64, b=40, l=60, r=20),
    )
    return fig
