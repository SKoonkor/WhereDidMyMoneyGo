"""Feature 2 — Income / Expense Pie page (slide 5)."""

import dash
import pandas as pd
from dash import dcc, html, callback, ctx, Input, Output

from src.app import theme
from src.app.components import page_header, money_span, card
from src.app.i18n import make_t
from src.app.data import get_df, default_range, reference_date, currency
from src.app.figures.pie import build_pie_figure, build_hist_figure
from src.analytics import budget as B

t = make_t("pie")

dash.register_page(__name__, path="/pie", name="Income / Expense", order=2)

PRESETS = {"30": 30, "120": 120, "365": 365}
_START, _END = default_range(120)


def _subcat_children(title: str, groups: list) -> list:
    """Nested parent→sub rows for one side (Income/Expense)."""
    out = [html.H4(t(title), style={"marginTop": 0, "marginBottom": "8px",
                                    "color": theme.INK})]
    if not groups:
        out.append(html.Div(t("No data"), style={"color": theme.MUTED}))
        return out
    for cat, tot, subs in groups:
        out.append(html.Div(
            [html.Span(cat, className="subcat-name"),
             money_span(f"{tot:,.0f} {currency()}", className="subcat-amt")],
            className="subcat-group",
        ))
        if len(subs) == 1 and subs[0][0] == "—":  # no real sub-categories
            continue
        for sub, amt in subs:
            pct = (amt / tot * 100) if tot else 0
            out.append(html.Div(
                [html.Span(sub, className="subcat-name"),
                 html.Span([money_span(f"{amt:,.0f}"), f" ({pct:.0f}%)"],
                           className="subcat-amt")],
                className="subcat-row",
            ))
    return out


def layout(**_):
    return html.Div(
        [
            page_header("Income & Expense Composition",
                        "Where your money comes from and where it goes."),
            html.Div(
                [
                    html.Button(t("Pie"), id="pie-mode-pie", n_clicks=0,
                                style=theme.PERIOD_BUTTON_ACTIVE_STYLE),
                    html.Button(t("Histogram"), id="pie-mode-hist", n_clicks=0,
                                style=theme.PERIOD_BUTTON_STYLE),
                ],
                style={"display": "flex", "gap": "10px", "flexWrap": "wrap",
                       "marginBottom": "16px"},
            ),
            card(
                [
                    dcc.RadioItems(
                        id="pie-preset",
                        className="sq-radio",
                        options=[
                            {"label": "  " + t("Past 30 days"), "value": "30"},
                            {"label": "  " + t("Past 120 days"), "value": "120"},
                            {"label": "  " + t("Past year"), "value": "365"},
                            {"label": "  " + t("Selected period"), "value": "custom"},
                        ],
                        value="30",
                        inline=True,
                        labelStyle={"marginRight": "18px", "cursor": "pointer"},
                        style={"marginBottom": "12px"},
                    ),
                    dcc.DatePickerRange(
                        id="pie-dates",
                        start_date=_START,
                        end_date=_END,
                        display_format="DD/MM/YYYY",
                        style={"marginBottom": "16px"},
                    ),
                    html.Div(
                        [
                            html.Span(t("Expense order:"), style={"color": theme.MUTED,
                                                               "marginRight": "8px"}),
                            dcc.RadioItems(
                                id="pie-expense-order",
                                className="sq-radio",
                                options=[{"label": "  " + t("By amount"), "value": "amount"},
                                         {"label": "  " + t("By Needs/Wants"), "value": "bucket"}],
                                value="amount",
                                inline=True,
                                labelStyle={"marginRight": "18px", "cursor": "pointer"},
                            ),
                        ],
                        style={"display": "flex", "alignItems": "center"},
                    ),
                ],
                style={"marginBottom": "16px"},
            ),
            html.Div(dcc.Graph(id="pie-graph", style={"height": "520px"}),
                     id="pie-view-pie"),
            html.Div(dcc.Graph(id="pie-hist-graph", style={"height": "520px"}),
                     id="pie-view-hist", style={"display": "none"}),
            html.Details(
                [
                    html.Summary(t("Sub-categories"), className="subcat-summary"),
                    html.Div(
                        [
                            html.Div(id="pie-subcats-income",
                                     style={"flex": "1", "minWidth": "260px"}),
                            html.Div(id="pie-subcats-expense",
                                     style={"flex": "1", "minWidth": "260px"}),
                        ],
                        style={"display": "flex", "gap": "24px",
                               "flexWrap": "wrap", "marginTop": "12px"},
                    ),
                ],
                style={"marginTop": "16px"},
            ),
        ],
        style=theme.PAGE_STYLE,
    )


@callback(
    Output("pie-graph", "figure"),
    Output("pie-hist-graph", "figure"),
    Output("pie-dates", "disabled"),
    Output("pie-subcats-income", "children"),
    Output("pie-subcats-expense", "children"),
    Input("pie-preset", "value"),
    Input("pie-dates", "start_date"),
    Input("pie-dates", "end_date"),
    Input("pie-expense-order", "value"),
    Input("theme-store", "data"),
    Input("censor-store", "data"),
)
def _update(preset, start, end, expense_order, theme_value, censor):
    dark = theme.is_dark(theme_value)
    df = get_df()
    if preset in PRESETS:
        ref = reference_date()
        s = (ref - pd.Timedelta(days=PRESETS[preset])).date().isoformat()
        e = ref.date().isoformat()
        disabled = True
    else:  # custom period
        s = start or _START
        e = end or _END
        disabled = False

    censored = theme.is_censored(censor)
    # Same data drives both views; the mode buttons just show/hide the two graphs.
    fig = build_pie_figure(df, s, e, currency(), dark=dark, expense_order=expense_order,
                           censor=censored)
    hist = build_hist_figure(df, s, e, currency(), dark=dark, expense_order=expense_order,
                             censor=censored)

    # Sub-category breakdown over the same window (end day inclusive, as the pie).
    e_excl = pd.Timestamp(e).normalize() + pd.Timedelta(days=1)
    income_children = _subcat_children(
        "Income", B.subcategory_breakdown(df, pd.Timestamp(s), e_excl, "Income"))
    expense_children = _subcat_children(
        "Expense", B.subcategory_breakdown(df, pd.Timestamp(s), e_excl, "Expense"))
    return fig, hist, disabled, income_children, expense_children


@callback(
    Output("pie-view-pie", "style"),
    Output("pie-view-hist", "style"),
    Output("pie-mode-pie", "style"),
    Output("pie-mode-hist", "style"),
    Input("pie-mode-pie", "n_clicks"),
    Input("pie-mode-hist", "n_clicks"),
    prevent_initial_call=True,
)
def _switch_view(_p, _h):
    """Show the Pie or the Histogram graph, moving the active-button style with it."""
    hist = ctx.triggered_id == "pie-mode-hist"
    active, inactive = theme.PERIOD_BUTTON_ACTIVE_STYLE, theme.PERIOD_BUTTON_STYLE
    if hist:
        return ({"display": "none"}, {"display": "block"}, inactive, active)
    return ({"display": "block"}, {"display": "none"}, active, inactive)
