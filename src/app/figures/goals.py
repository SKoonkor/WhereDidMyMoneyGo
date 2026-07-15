"""Financial-goal gauge (slide 6).

Shows current savings against a pooled target. The Emergency Fund is always part
of the pool; selecting other goals adds their targets on top. The subtitle shows
how many months of required expenses the Emergency Fund portion covers, capped at
"6+ months".
"""

import plotly.graph_objects as go

from src.app import theme
from src.app.i18n import t

MONTHS_CAP = 6


def build_goal_gauge(
    balance: float,
    pooled_target: float,
    monthly_required: float,
    selected_labels: list[str],
    currency: str = "THB",
    dark: bool = True,
    show_target: bool = True,
    censor: bool = False,
) -> go.Figure:
    ft = theme.fig_theme(dark)
    bands = theme.gauge_bands(dark)
    pooled_target = max(pooled_target, 1.0)
    pct = min(balance / pooled_target * 100, 100)

    months = balance / monthly_required if monthly_required > 0 else 0
    months_txt = f"{MONTHS_CAP}+" if months >= MONTHS_CAP else f"{months:.1f}"

    # Privacy mode collapses the individual goal names to a generic "+ Goals" so
    # onlookers can't tell what you're saving for; non-censored lists them.
    # Translate fixed labels (e.g. the Emergency Fund); user goal names pass through.
    labels_tr = [t(lbl) for lbl in selected_labels]
    if censor:
        base = labels_tr[0] if labels_tr else ""
        goal_txt = f"{base} + {t('Goals')}" if len(labels_tr) > 1 else base
    else:
        goal_txt = " + ".join(labels_tr)
    # Privacy mode: keep the arc + "% funded", hide all money figures and the
    # months-covered detail (per the design). Non-censored shows number+delta+target.
    target_txt = ("" if censor
                  else (f"<br>{t('Target')}: {pooled_target:,.0f} {currency}"
                        if show_target else ""))
    footer = (t("{pct}% funded").format(pct=f"{pct:.1f}") if censor
              else t("{pct}% funded · Emergency Fund covers {months} months").format(
                  pct=f"{pct:.1f}", months=months_txt))

    fig = go.Figure(go.Indicator(
        mode="gauge" if censor else "gauge+number+delta",
        value=balance,
        delta={"reference": pooled_target, "valueformat": ",.0f"},
        number={"suffix": f" {currency}", "valueformat": ",.0f"},
        title={"text": f"{t('Savings Pool')}<br><span style='font-size:0.8em;color:{ft.muted}'>"
                       f"{goal_txt}{target_txt}</span>"},
        gauge={
            "axis": {"range": [0, pooled_target], "visible": not censor},
            "bar": {"color": theme.SAVING_COLOR},
            "steps": [
                {"range": [0, pooled_target * 0.33], "color": bands[0]},
                {"range": [pooled_target * 0.33, pooled_target * 0.66], "color": bands[1]},
                {"range": [pooled_target * 0.66, pooled_target], "color": bands[2]},
            ],
            "threshold": {"line": {"color": "green", "width": 4},
                          "thickness": 0.75, "value": pooled_target},
        },
    ))
    fig.update_layout(
        template=ft.template,
        paper_bgcolor="rgba(0,0,0,0)",
        margin=dict(t=120, b=50, l=30, r=30),
        annotations=[dict(
            text=footer,
            x=0.5, y=-0.02, showarrow=False, font=dict(size=14, color=ft.ink),
        )],
    )
    return fig
