"""Feature 4 — Compound Interest Calculator page (slide 7)."""

import dash
from dash import dcc, html, callback, clientside_callback, Input, Output, State

from src.app import theme
from src.app.components import page_header, card
from src.app.data import currency
from src.app.figures.compound import compute_schedule, build_compound_figure, COMPOUNDING
from src.analytics.goals import load_goals, goal_factor, EMERGENCY_FUND

dash.register_page(__name__, path="/compound", name="Compound Interest", order=4)

DEFAULTS = dict(principal=0, deposit=500, period=120, rate=10, compounding="Annually")

_INPUT_STYLE = theme.INPUT_STYLE
_LABEL_STYLE = {"color": theme.MUTED, "fontSize": "13px"}


def _field(label, component):
    return html.Div([html.Label(label, style=_LABEL_STYLE), component])


def _goal_options() -> list[dict]:
    """Selectable goal targets, sourced from Financial Goals (no Emergency Fund).
    The label shows the xTimes factor when set (the goal is reached at amount×factor).
    """
    opts = []
    for name, amt in load_goals().items():
        if name == EMERGENCY_FUND:
            continue
        f = goal_factor(name)
        label = (f" {name} ({amt:,.0f} {currency()} × {f:g})" if f > 1
                 else f" {name} ({amt:,.0f} {currency()})")
        opts.append({"label": label, "value": name})
    return opts


def layout(**_):
    return html.Div(
        [
            page_header("Compound Interest Calculator",
                        "A standalone tool for exploring investment growth."),
            dcc.Store(id="ci-goal-arrows", data=[]),
            html.Div(
                [
                    card(
                        [
                            _field("Principal Amount",
                                   dcc.Input(id="ci-principal", type="number",
                                             value=DEFAULTS["principal"], style=_INPUT_STYLE)),
                            _field("Monthly Deposit",
                                   dcc.Input(id="ci-deposit", type="number",
                                             value=DEFAULTS["deposit"], style=_INPUT_STYLE)),
                            _field("Period (months)",
                                   dcc.Input(id="ci-period", type="number",
                                             value=DEFAULTS["period"], min=1, style=_INPUT_STYLE)),
                            _field("Annual Interest Rate (%)",
                                   dcc.Input(id="ci-rate", type="number",
                                             value=DEFAULTS["rate"], style=_INPUT_STYLE)),
                            _field("Compounding",
                                   dcc.Dropdown(id="ci-compounding",
                                                options=list(COMPOUNDING.keys()),
                                                value=DEFAULTS["compounding"],
                                                clearable=False,
                                                style={"marginBottom": "16px"})),
                            html.Div(
                                [
                                    html.Button("RESET", id="ci-reset", n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "marginRight": "10px"}),
                                    html.Button("CALCULATE", id="ci-calc", n_clicks=0,
                                                style=theme.BUTTON_STYLE),
                                ],
                            ),
                            html.Div(id="ci-results", style={"marginTop": "20px"}),
                        ],
                        style={"flex": "0 0 320px"},
                    ),
                    card(
                        dcc.Graph(id="ci-graph", style={"height": "520px"},
                                  config={"scrollZoom": True, "displaylogo": False,
                                          "modeBarButtonsToRemove": [
                                              "zoom2d", "select2d", "lasso2d"]}),
                        style={"flex": "1", "marginLeft": "20px"},
                    ),
                ],
                style={"display": "flex", "alignItems": "stretch"},
            ),
            card(
                html.Div(
                    [
                        # Goal selector — hidden by CSS in privacy mode (reveals goal
                        # names + target amounts); the Log y-axis toggle stays visible.
                        html.Div(
                            [
                                html.Span("Goals", style={"fontWeight": 600,
                                                          "marginRight": "12px"}),
                                dcc.Checklist(
                                    id="ci-goals", options=_goal_options(), value=[],
                                    inline=True,
                                    labelStyle={"marginRight": "18px", "cursor": "pointer"},
                                ),
                            ],
                            className="ci-goals-block",
                            style={"display": "flex", "alignItems": "center",
                                   "flexWrap": "wrap", "gap": "6px"},
                        ),
                        dcc.Checklist(
                            id="ci-logy",
                            options=[{"label": " Log y-axis", "value": "log"}],
                            value=[], inline=True,
                            labelStyle={"cursor": "pointer", "whiteSpace": "nowrap"},
                        ),
                    ],
                    className="ci-goals-bar",
                ),
                style={"marginTop": "20px"},
            ),
        ],
        style=theme.PAGE_STYLE,
    )


def _result_row(label, value):
    return html.Div(
        [html.Span(label, style={"color": theme.MUTED}),
         html.Span(value, style={"fontWeight": 600, "whiteSpace": "nowrap"})],
        style=theme.RESULT_ROW_STYLE,
    )


@callback(
    Output("ci-graph", "figure"),
    Output("ci-results", "children"),
    Output("ci-goal-arrows", "data"),
    Input("ci-calc", "n_clicks"),
    Input("theme-store", "data"),
    Input("ci-goals", "value"),
    Input("ci-logy", "value"),
    State("ci-principal", "value"),
    State("ci-deposit", "value"),
    State("ci-period", "value"),
    State("ci-rate", "value"),
    State("ci-compounding", "value"),
)
def _calculate(_n, theme_value, sel_goals, logy_val,
               principal, deposit, period, rate, compounding):
    P = float(principal or 0)
    D = float(deposit or 0)
    M = int(period or 1)
    r = float(rate or 0) / 100.0

    goals = load_goals()
    # Buy in the Financial Goals rank order (top-ranked first), not the order the
    # user ticked them in the dropdown — load_goals() preserves the page order.
    chosen = set(sel_goals or [])
    selected = [(nm, goals[nm], goal_factor(nm)) for nm in goals
                if nm != EMERGENCY_FUND and nm in chosen]

    sched = compute_schedule(P, D, M, r, compounding or "Annually",
                             goals=selected)

    results = [
        _result_row("Total Principal", f"{sched['total_principal']:,.2f} {currency()}"),
        _result_row("Interest Amount", f"{sched['interest']:,.2f} {currency()}"),
        _result_row("Maturity Value", f"{sched['maturity_value']:,.2f} {currency()}"),
        _result_row("APY", f"{sched['apy']*100:.4f}%"),
    ]
    fig, arrows = build_compound_figure(sched, currency(), dark=theme.is_dark(theme_value),
                                        goals=selected, logy=("log" in (logy_val or [])))
    return fig, results, arrows


# Hide each "above range" goal arrow once its line is panned/zoomed into view, and
# keep the figure's stored axis ranges in sync with the pan so it doesn't snap back.
clientside_callback(
    """
    function(relayout, fig, arrows) {
        var nu = window.dash_clientside.no_update;
        if (!fig || !arrows || !arrows.length || !fig.layout.annotations || !relayout) {
            return nu;
        }
        // Leave autorange resets (double-click) alone, and ignore relayouts that
        // don't change an axis range (legend clicks, dragmode, etc.).
        if (relayout['xaxis.autorange'] || relayout['yaxis.autorange']) return nu;
        var hasRange = (relayout['xaxis.range[0]'] !== undefined ||
                        relayout['yaxis.range[0]'] !== undefined);
        if (!hasRange) return nu;

        // Return a NEW figure object (cloned layout/annotations); mutating and
        // returning the same reference would not trigger a re-render. Data is kept
        // by reference for speed.
        var L = fig.layout;
        var xaxis = Object.assign({}, L.xaxis);
        var yaxis = Object.assign({}, L.yaxis);
        if (relayout['xaxis.range[0]'] !== undefined) {
            xaxis.range = [relayout['xaxis.range[0]'], relayout['xaxis.range[1]']];
        }
        if (relayout['yaxis.range[0]'] !== undefined) {
            yaxis.range = [relayout['yaxis.range[0]'], relayout['yaxis.range[1]']];
        }
        if (!yaxis.range) return nu;
        var top = yaxis.range[1];
        if (yaxis.type === 'log') top = Math.pow(10, top);

        var anns = L.annotations.map(function (a) { return Object.assign({}, a); });
        arrows.forEach(function (a) {
            if (anns[a.i]) anns[a.i].visible = (a.target > top);
        });

        var newLayout = Object.assign({}, L, {xaxis: xaxis, yaxis: yaxis,
                                              annotations: anns});
        return {data: fig.data, layout: newLayout};
    }
    """,
    Output("ci-graph", "figure", allow_duplicate=True),
    Input("ci-graph", "relayoutData"),
    State("ci-graph", "figure"),
    State("ci-goal-arrows", "data"),
    prevent_initial_call=True,
)


@callback(
    Output("ci-principal", "value"),
    Output("ci-deposit", "value"),
    Output("ci-period", "value"),
    Output("ci-rate", "value"),
    Output("ci-compounding", "value"),
    Input("ci-reset", "n_clicks"),
    prevent_initial_call=True,
)
def _reset(_n):
    return (DEFAULTS["principal"], DEFAULTS["deposit"], DEFAULTS["period"],
            DEFAULTS["rate"], DEFAULTS["compounding"])
