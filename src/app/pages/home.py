"""Home page (slide 1) — snapshots (last 30 days) + menu.

Each snapshot is wrapped in a link so clicking navigates to the full feature.
Figures are filled by a callback so they react to the theme toggle (and always
reflect freshly recorded transactions).
"""

import dash
import pandas as pd
from dash import dcc, html, callback, clientside_callback, Input, Output, State

from src.app import theme
from src.app.components import (card, theme_toggle, censor_toggle, reminder_banner,
                                menu_widget, home_link, money_span)
from src.app.data import (get_df, default_range, emergency_fund_config, get_config,
                          CURRENCY)
from src.app.figures.money_flow import build_money_flow_figure
from src.app.figures.pie import build_pie_figure
from src.app.figures.goals import build_goal_gauge
from src.analytics.emergency_fund import emergency_fund_status
from src.analytics.goals import EMERGENCY_FUND
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


_TYPE_ABBR = {
    "Income": "Inc.", "Expense": "Exp.",
    "Transfer-In": "Tfr.", "Transfer-Out": "Tfr.",
    "Adjustment-In": "Adj.", "Adjustment-Out": "Adj.",
}


# Every line in the block is the same muted, small text.
_MUTED_LINE = {"color": theme.MUTED, "fontSize": "13px"}
# The type abbreviation sits in a thin grey outlined chip.
_BADGE_STYLE = {"border": "1px solid var(--border)", "borderRadius": "4px",
                "padding": "0 5px", "flex": "0 0 auto"}


def _compact_amount(a) -> str:
    """Money amount shortened once it passes 10k: '12.34k', '12.34m', else 2dp."""
    a = float(a)
    if abs(a) >= 1_000_000:
        return f"{a / 1_000_000:.2f}m"
    if abs(a) > 10_000:
        return f"{a / 1_000:.2f}k"
    return f"{a:,.2f}"


def _last_txn_block(df) -> html.Div:
    """A 3-line 'Last Item Recorded' summary for the Transactions card. Line 1 is
    a left-flushed label; line 2 spans the width — an outlined type chip + note on
    the left, the compact amount + currency on the right; line 3 is the weekday +
    timestamp. All three lines share the same muted, small styling."""
    label = html.Div("Last Item Recorded", style={"textAlign": "left", **_MUTED_LINE})
    if df.empty or not df["Period"].notna().any():
        return html.Div(
            [label, html.Div("None yet", style={"textAlign": "center", **_MUTED_LINE})],
            style={"margin": "8px 0"},
        )

    row = df.loc[df["Period"].idxmax()]
    clean = lambda v: "" if pd.isna(v) else str(v).strip()
    abbr = _TYPE_ABBR.get(str(row["Income/Expense"]), "")
    # Hard cap the note at 10 characters (no ellipsis).
    note = (clean(row["Note"]) or clean(row["Subcategory"]) or clean(row["Category"]))[:10]
    cur = clean(row["Currency"]) or CURRENCY

    left = []
    if abbr:
        left.append(html.Span(abbr, style=_BADGE_STYLE))
    if note:
        left.append(html.Span(note, style={"marginLeft": "6px" if abbr else 0,
                                            "whiteSpace": "nowrap"}))
    item = html.Div(
        [
            html.Div(left, style={"display": "flex", "alignItems": "center",
                                  "minWidth": 0, "overflow": "hidden"}),
            html.Div([money_span(_compact_amount(row["Amount"])),
                      html.Span(f" {cur}")],
                     style={"whiteSpace": "nowrap", "flex": "0 0 auto",
                            "marginLeft": "8px"}),
        ],
        style={"display": "flex", "justifyContent": "space-between",
               "alignItems": "center", "marginTop": "2px", **_MUTED_LINE},
    )
    when = html.Div(pd.Timestamp(row["Period"]).strftime("%a %d-%m-%Y %H:%M:%S"),
                    style={"textAlign": "center", "marginTop": "2px", **_MUTED_LINE})
    return html.Div([label, item, when], style={"margin": "8px 0"})


def layout(**_):
    df_now = get_df()
    transactions_section = html.Div(
        [
            html.H2("Transactions", style={"color": theme.INK, "marginTop": 0}),
            _last_txn_block(df_now),
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

    budget_section = _budget_section(df_now)

    account_settings_section = html.Div(
        dcc.Link("Account Settings", href="/settings",
                 className="home-action-btn view", style={"margin": 0}),
        style={**theme.CARD_STYLE, "marginTop": "16px"},
    )

    sidebar = html.Div(
        [transactions_section, budget_section, account_settings_section],
        style={"flex": "0 0 260px"},
    )

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
                            html.H1(get_config().get("settings", {}).get("general", {})
                                    .get("app_name", "Money Tracker"),
                                    style={**theme.H1_STYLE, "fontSize": "32px"}),
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
    # The emergency-fund target is driven by Settings (months × monthly required),
    # not a separately stored goal, so it stays in sync with the Settings page.
    gauge_fig = build_goal_gauge(
        balance=status["current_balance"],
        pooled_target=status["target"],
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
