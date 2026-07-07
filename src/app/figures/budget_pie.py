"""Budget spending donut — categories as a share of the monthly budget.

Unlike the Income/Expense pie (which shows % of expense), every slice here is a
percentage of the month's total budget. A grey "Remaining budget" slice fills the
circle when under budget; the data builder (budget.month_pie_data) handles the
over-budget overflow before this runs.
"""

import plotly.graph_objects as go

from src.app import theme
from src.app.figures.pie import _shade, _HIDDEN_COLOR
from src.analytics.budget import HIDDEN_LABEL

_REMAINING_LABEL = "Remaining budget"
_REMAINING_COLOR = "#454e5c"  # dim grey for the unspent-budget slice


def build_budget_pie(pie_items, remaining, total, budget, title,
                     currency="THB", dark=True, censor=False) -> go.Figure:
    ft = theme.fig_theme(dark)
    fig = go.Figure()

    labels = [lbl for lbl, _, _ in pie_items]
    values = [amt for _, amt, _ in pie_items]
    # Needs from a blue ramp, Wants from an orange ramp (so the donut shows a
    # blue arc then an orange arc); Hidden cost slate, Remaining grey.
    n_needs = sum(1 for lbl, _, b in pie_items if b == "Needs" and lbl != HIDDEN_LABEL)
    n_wants = sum(1 for lbl, _, b in pie_items if b == "Wants" and lbl != HIDDEN_LABEL)
    blues = _shade(n_needs, "Blues") if n_needs else []
    oranges = _shade(n_wants, "Oranges") if n_wants else []
    colors, bi, oi = [], 0, 0
    for lbl, _, bucket in pie_items:
        if lbl == HIDDEN_LABEL:
            colors.append(_HIDDEN_COLOR)
        elif bucket == "Needs":
            colors.append(blues[bi]); bi += 1
        else:
            colors.append(oranges[oi]); oi += 1
    if remaining and remaining > 0:
        labels.append(_REMAINING_LABEL)
        values.append(remaining)
        colors.append(_REMAINING_COLOR)

    annotations = [dict(text=f"<b>{title}</b>", x=0.5, y=1.17, xref="paper",
                        yref="paper", showarrow=False, xanchor="center",
                        font=dict(size=14, color=ft.ink))]

    if not values or budget <= 0:
        annotations.append(dict(text="No data", x=0.5, y=0.5, xref="paper",
                                yref="paper", showarrow=False, xanchor="center",
                                yanchor="middle", font=dict(color=ft.muted)))
    else:
        pct_of_budget = [v / budget * 100 for v in values]
        fig.add_trace(go.Pie(
            labels=labels, values=values, customdata=pct_of_budget,
            hole=0.55, sort=False, direction="clockwise",
            marker=dict(colors=colors),
            textposition="inside", insidetextorientation="horizontal",
            texttemplate="%{label}<br>%{customdata:.0f}%",
            hovertemplate="%{label}: "
                          + ("*****" if censor else "%{value:,.0f} " + currency)
                          + " (%{customdata:.0f}% of budget)<extra></extra>",
        ))
        spent_pct = total / budget * 100
        annotations.append(dict(
            text=f"{spent_pct:.0f}%<br><span style='font-size:0.7em;color:{ft.muted}'>of budget</span>",
            x=0.5, y=0.5, xref="paper", yref="paper", showarrow=False,
            xanchor="center", yanchor="middle", align="center",
            font=dict(size=22, color=(ft.ink if total <= budget else theme.EXPENSE_COLOR)),
        ))

    fig.update_layout(
        template=ft.template, showlegend=False,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        margin=dict(t=52, b=14, l=14, r=14), annotations=annotations,
    )
    return fig
