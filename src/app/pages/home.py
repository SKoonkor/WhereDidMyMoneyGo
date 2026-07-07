"""Home page (slide 1) — snapshots (last 30 days) + menu.

Each snapshot is wrapped in a link so clicking navigates to the full feature.
Figures are filled by a callback so they react to the theme toggle (and always
reflect freshly recorded transactions).
"""

import dash
from dash import dcc, html, callback, clientside_callback, Input, Output, State

from src.app import theme
from src.app.components import (card, theme_toggle, censor_toggle, reminder_banner,
                                menu_widget, home_link, money_span)
from src.app.data import get_df, default_range, emergency_fund_config, CURRENCY
from src.app.figures.money_flow import build_money_flow_figure
from src.app.figures.pie import build_pie_figure
from src.app.figures.goals import build_goal_gauge
from src.analytics.emergency_fund import emergency_fund_status
from src.analytics.goals import load_goals, EMERGENCY_FUND
from src.analytics.reconciliation import hidden_cost_total, last_reconciled
from src.analytics import budget as B

dash.register_page(__name__, path="/", name="Home", order=0)

_SNAPSHOT_CONFIG = {"displayModeBar": False, "staticPlot": False}


def _linked_graph(graph_id, href, height="300px"):
    return dcc.Link(
        card(
            dcc.Graph(id=graph_id, style={"height": height}, config=_SNAPSHOT_CONFIG),
            style={"height": "100%"},
        ),
        href=href,
        style={"textDecoration": "none", "display": "block"},
    )


def _budget_section(df) -> html.Div:
    s = B.budget_summary(df)
    rows = []
    for name in (B.NEEDS, B.WANTS, B.SAVINGS):
        v = s["buckets"][name]
        if name == B.SAVINGS:
            ahead = v["remaining"] >= 0
            amt, word = f"{abs(v['remaining']):,.0f}", "ahead" if ahead else "short"
            cls = "amt-income" if ahead else "amt-expense"
        else:
            over = v["remaining"] < 0
            amt = f"{-v['remaining']:,.0f}" if over else f"{v['remaining']:,.0f}"
            word = "over" if over else "left"
            cls = "amt-expense" if over else "amt-income"
        tone = B.bucket_tone(name, v["spent"], v["target"])
        width = min(100, max(0, (v["spent"] / v["target"] * 100) if v["target"] else 0))
        rows.append(html.Div(
            [
                html.Div(
                    [html.Span(name, style={"color": theme.MUTED}),
                     html.Span([money_span(amt), f" {word}"], className=cls,
                               style={"fontWeight": 600})],
                    style={"display": "flex", "justifyContent": "space-between",
                           "alignItems": "baseline", "gap": "12px",
                           "marginBottom": "5px"},
                ),
                html.Div(html.Div(className=f"budget-bar-fill {tone}",
                                  style={"width": f"{width:.0f}%"}),
                         className="budget-bar"),
            ],
            style={"padding": "6px 0", "borderBottom": "1px solid var(--border-soft)"},
        ))
    rows.append(html.Div(
        [html.Span("Resets", style={"color": theme.MUTED}),
         html.Span(s["end"].strftime("%d %b"), style={"fontWeight": 600})],
        style={**theme.RESULT_ROW_STYLE, "borderBottom": "none", "marginBottom": "8px"},
    ))
    return html.Div(
        [
            html.H2("Budget", style={"color": theme.INK, "marginTop": 0}),
            *rows,
            dcc.Link("Open Budget", href="/budget", className="home-action-btn view"),
        ],
        style={**theme.CARD_STYLE, "marginTop": "16px"},
    )


def layout(**_):
    transactions_section = html.Div(
        [
            html.H2("Transactions", style={"color": theme.INK, "marginTop": 0}),
            html.Div(
                [
                    dcc.Link("View Transactions", href="/transactions",
                             className="home-action-btn view",
                             style={"flex": "1", "margin": 0}),
                    dcc.Link("＋", href="/transactions/add",
                             className="home-action-btn add",
                             style={"flex": "0 0 auto", "margin": 0}),
                ],
                style={"display": "flex", "gap": "10px", "marginTop": "10px"},
            ),
        ],
        style=theme.CARD_STYLE,
    )

    df_now = get_df()
    hidden = hidden_cost_total(df_now)
    last = last_reconciled()
    last_txt = last.strftime("%d %b %Y") if last else "never"
    balances_section = html.Div(
        [
            html.H2("Balances", style={"color": theme.INK, "marginTop": 0}),
            html.Div(
                [html.Span("Hidden cost (untracked)", style={"color": theme.MUTED}),
                 html.Span(money_span(f"{hidden:+,.0f} {CURRENCY}"),
                           className=("amt-income" if hidden > 0
                                      else "amt-expense" if hidden < 0 else ""),
                           style={"fontWeight": 600})],
                style=theme.RESULT_ROW_STYLE,
            ),
            html.Div(
                [html.Span("Last reconciled", style={"color": theme.MUTED}),
                 html.Span(last_txt, style={"fontWeight": 600})],
                style={**theme.RESULT_ROW_STYLE, "borderBottom": "none",
                       "marginBottom": "8px"},
            ),
            dcc.Link("Reconcile Balances", href="/reconcile",
                     className="home-action-btn view"),
        ],
        style={**theme.CARD_STYLE, "marginTop": "16px"},
    )

    budget_section = _budget_section(df_now)

    sidebar = html.Div([transactions_section, budget_section, balances_section],
                       style={"flex": "0 0 260px"})

    content = html.Div(
        [
            _linked_graph("home-flow", "/flow", height="300px"),
            html.Div(
                [
                    html.Div(_linked_graph("home-pie", "/pie", height="300px"),
                             style={"flex": "1", "marginRight": "16px"}),
                    html.Div(_linked_graph("home-gauge", "/goals", height="300px"),
                             style={"flex": "1"}),
                ],
                style={"display": "flex", "marginTop": "16px"},
            ),
        ],
        style={"flex": "1", "marginRight": "20px"},
    )

    return html.Div(
        [
            reminder_banner(),
            html.Div(
                [
                    html.Div(
                        [
                            html.H1("Money Tracker", style={**theme.H1_STYLE, "fontSize": "32px"}),
                            html.P("A snapshot of your last 30 days. Click any chart to explore.",
                                   style={"color": theme.MUTED}),
                        ]
                    ),
                    html.Div([theme_toggle(), censor_toggle(), menu_widget(), home_link()],
                             style={"display": "flex", "gap": "10px",
                                    "alignItems": "center"}),
                ],
                style={"display": "flex", "justifyContent": "space-between",
                       "alignItems": "flex-start"},
            ),
            html.Div([content, sidebar], style={"display": "flex", "alignItems": "flex-start"}),
        ],
        style=theme.PAGE_STYLE,
    )


# Dismiss the reconcile reminder for the session (clientside, no reload needed).
clientside_callback(
    "function(n){ return n ? {display:'none'} : window.dash_clientside.no_update; }",
    Output("recon-reminder", "style"),
    Input("recon-reminder-close", "n_clicks"),
    prevent_initial_call=True,
)


@callback(
    Output("home-flow", "figure"),
    Output("home-pie", "figure"),
    Output("home-gauge", "figure"),
    Input("theme-store", "data"),
    Input("censor-store", "data"),
)
def _render_snapshots(theme_value, censor_value):
    dark = theme.is_dark(theme_value)
    censor = theme.is_censored(censor_value)
    df = get_df()
    start, end = default_range(30)

    flow_fig = build_money_flow_figure(df, currency=CURRENCY, default_days=30,
                                       compact=True, dark=dark, censor=censor)
    pie_fig = build_pie_figure(df, start, end, CURRENCY, dark=dark,
                               compact=True, censor=censor)

    ef = emergency_fund_config()
    status = emergency_fund_status(df, ef["savings_account"],
                                   ef["monthly_required"], ef["target_months"])
    goals = load_goals()
    gauge_fig = build_goal_gauge(
        balance=status["current_balance"],
        pooled_target=goals.get(EMERGENCY_FUND, 60000),
        monthly_required=ef["monthly_required"],
        selected_labels=[EMERGENCY_FUND],
        currency=CURRENCY,
        dark=dark,
        show_target=False,
        censor=censor,
    )

    for fig in (flow_fig, pie_fig, gauge_fig):
        fig.update_layout(margin=dict(t=50, b=20, l=40, r=20), title_font_size=15)
    # Wider side margins shrink the gauge a touch so its max-value tick (e.g. 60k)
    # stays inside the box; extra top margin lifts the title off the gauge bar.
    gauge_fig.update_layout(margin=dict(t=70, b=20, l=55, r=55))

    return flow_fig, pie_fig, gauge_fig
