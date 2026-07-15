"""Feature 4 — Compound Interest Calculator page (slide 7)."""

import dash
from dash import (dcc, html, callback, clientside_callback, ctx,
                  Input, Output, State)

from src.app import theme
from src.app.components import page_header, card
from src.app.i18n import make_t
from src.app.data import currency
from src.app.figures.compound import compute_schedule, build_compound_figure, COMPOUNDING
from src.app.figures.retirement import build_retirement_figure
from src.analytics.goals import load_goals, goal_factor, EMERGENCY_FUND
from src.analytics.retirement import compute_retirement
from src.analytics.retirement_mc import simulate_retirement_mc

t = make_t("compound")

dash.register_page(__name__, path="/compound", name="Retirement Planning", order=4)

DEFAULTS = dict(principal=0, deposit=500, period=120, rate=10, compounding="Annually")

# Retirement-mode input defaults (rates are whole percents, as entered).
RETIRE_DEFAULTS = dict(cur_age=30, ret_age=60, life=85, principal=0, deposit=10000,
                       increase=3, rate=6, infl=3, bonus=0, pension=0, expense=30000,
                       # Monte Carlo uncertainty: annual volatilities (%) + run count.
                       vol_return=15, vol_infl=1, vol_deposit=2, n_mc=1000)

_INPUT_STYLE = theme.INPUT_STYLE
_LABEL_STYLE = {"color": theme.MUTED, "fontSize": "13px"}


def _field(label, component):
    return html.Div([html.Label(t(label), style=_LABEL_STYLE), component])


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


def _logy_toggle(cid):
    """A small "Log y-axis" checkbox, right-aligned in a header row so it sits at the
    top-right of the plot card it precedes. Shared by both calculator modes."""
    return html.Div(
        dcc.Checklist(
            id=cid, options=[{"label": t(" Log y-axis"), "value": "log"}],
            value=[], inline=True,
            labelStyle={"cursor": "pointer", "whiteSpace": "nowrap"},
        ),
        style={"display": "flex", "justifyContent": "flex-end", "marginBottom": "4px"},
    )


def _mode_bar():
    """Two buttons at the top of the page choosing which tool is shown. The active
    tool's button uses the filled style; a callback swaps them on click."""
    return html.Div(
        [
            html.Button(t("Retirement Planning"), id="ci-mode-retire", n_clicks=0,
                        style=theme.PERIOD_BUTTON_ACTIVE_STYLE),
            html.Button(t("Simple Compound Interest Calculator"), id="ci-mode-simple",
                        n_clicks=0, style=theme.PERIOD_BUTTON_STYLE),
        ],
        style={"display": "flex", "gap": "10px", "flexWrap": "wrap",
               "marginBottom": "16px"},
    )


def _simple_view():
    """The original Simple Compound Interest Calculator (unchanged), wrapped in a
    container so it can be shown/hidden by the mode switch."""
    return html.Div(
        [
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
                                                options=[{"label": t(k), "value": k}
                                                         for k in COMPOUNDING.keys()],
                                                value=DEFAULTS["compounding"],
                                                clearable=False,
                                                style={"marginBottom": "16px"})),
                            html.Div(
                                [
                                    html.Button(t("RESET"), id="ci-reset", n_clicks=0,
                                                style={**theme.PERIOD_BUTTON_STYLE,
                                                       "marginRight": "10px"}),
                                    html.Button(t("CALCULATE"), id="ci-calc", n_clicks=0,
                                                style=theme.BUTTON_STYLE),
                                ],
                            ),
                            html.Div(id="ci-results", style={"marginTop": "20px"}),
                        ],
                        style={"flex": "0 0 320px"},
                    ),
                    card(
                        [
                            _logy_toggle("ci-logy"),
                            dcc.Graph(id="ci-graph", style={"height": "500px"},
                                      config={"scrollZoom": True, "displaylogo": False,
                                              "modeBarButtonsToRemove": [
                                                  "zoom2d", "select2d", "lasso2d"]}),
                        ],
                        style={"flex": "1", "marginLeft": "20px"},
                    ),
                ],
                style={"display": "flex", "alignItems": "stretch"},
            ),
            card(
                html.Div(
                    [
                        # The "Goals" title stays visible in privacy mode; only the
                        # checklist (goal names + amounts) is hidden via .ci-goals-block.
                        # The hint reveals itself only when censored.
                        html.Span(t("Goals"), style={"fontWeight": 600,
                                                  "marginRight": "8px"}),
                        html.Span(t("(unhide to see goals)"),
                                  className="goals-hidden-hint",
                                  style={"color": theme.MUTED, "marginRight": "12px"}),
                        html.Div(
                            dcc.Checklist(
                                id="ci-goals", options=_goal_options(), value=[],
                                inline=True,
                                labelStyle={"marginRight": "18px",
                                            "cursor": "pointer"},
                            ),
                            className="ci-goals-block",
                            style={"display": "flex", "alignItems": "center",
                                   "flexWrap": "wrap", "gap": "6px"},
                        ),
                    ],
                    className="ci-goals-bar",
                    style={"display": "flex", "alignItems": "center",
                           "flexWrap": "wrap", "gap": "6px"},
                ),
                style={"marginTop": "20px"},
            ),
            # Filled on Calculate: a table of months-to-reach per selected goal.
            html.Div(id="ci-goal-table"),
        ],
        id="ci-simple-view",
        style={"display": "none"},
    )


def _num_field(label, cid, value, info=None, pop_right=False):
    """A labelled number input for the retirement form. ``info`` adds a small "ⓘ"
    button beside the label; clicking it reveals the explanation (toggled/dismissed
    by assets/info_popover.js), which is hidden by default. ``pop_right`` right-aligns
    the popover so it stays on-card for right-edge fields."""
    label_children = [html.Span(t(label))]
    if info:
        pop_cls = "info-pop info-pop-right" if pop_right else "info-pop"
        label_children.append(html.Span(
            [html.Span("ⓘ", className="info-dot"),
             html.Span(t(info), className=pop_cls)],
            className="info-wrap"))
    return html.Div([
        html.Label(label_children,
                   style={**_LABEL_STYLE, "display": "block", "marginBottom": "6px"}),
        dcc.Input(id=cid, type="number", value=value, style=_INPUT_STYLE),
    ])


def _retire_col(title, fields):
    return html.Div(
        [html.Div(t(title), style={"fontWeight": 600, "color": theme.INK,
                                "marginBottom": "10px"})] + fields,
        style={"flex": "1 1 200px", "minWidth": "180px"},
    )


def _retire_view():
    """The Retirement Planning tool — hidden until its mode button is clicked."""
    d = RETIRE_DEFAULTS
    plan_card = card(
        [
            html.H3(t("Your plan"), style={"marginTop": 0, "color": theme.INK}),
            html.Div(
                [
                    _retire_col("Ages", [
                        _num_field("Current age (yr)", "ci-cur-age", d["cur_age"],
                                   info="Your age today; the projection starts here."),
                        _num_field("Retirement age (yr)", "ci-ret-age", d["ret_age"],
                                   info="When you stop working: deposits stop and the "
                                        "retirement bonus is added; draw-down begins."),
                        _num_field("Life expectancy (yr)", "ci-life", d["life"],
                                   info="The age the projection runs to — savings must "
                                        "last from retirement to here."),
                    ]),
                    _retire_col("Savings", [
                        _num_field("Principal Amount", "ci-ret-principal", d["principal"],
                                   info="Savings you already have today, before any "
                                        "deposits."),
                        _num_field("Monthly Deposit", "ci-ret-deposit", d["deposit"],
                                   info="Added to savings at the start of each month "
                                        "while working; grows yearly by the deposit-"
                                        "increase rate."),
                        _num_field("Deposit increase (%/yr)", "ci-ret-increase",
                                   d["increase"],
                                   info="Yearly raise applied to your monthly deposit "
                                        "(e.g. a salary raise), compounded until "
                                        "retirement."),
                        _num_field("Annual Interest Rate (%)", "ci-ret-rate", d["rate"],
                                   info="Expected yearly investment return, applied "
                                        "monthly to the balance throughout the plan."),
                        _num_field("Inflation Rate (%)", "ci-ret-infl", d["infl"],
                                   info="Yearly rise in prices: inflates your expenses "
                                        "and converts the balance into today's money."),
                    ]),
                    _retire_col("Retirement", [
                        _num_field("Retirement Bonus", "ci-ret-bonus", d["bonus"],
                                   pop_right=True,
                                   info="One-off lump sum added to savings the year you "
                                        "retire (e.g. gratuity/severance)."),
                        _num_field("Pension (monthly)", "ci-ret-pension", d["pension"],
                                   pop_right=True,
                                   info="Fixed monthly income through retirement (not "
                                        "inflation-adjusted); offsets expenses before "
                                        "drawing on savings."),
                        _num_field("Expected Monthly Expense", "ci-ret-expense",
                                   d["expense"], pop_right=True,
                                   info="Monthly spending in today's money; it inflates "
                                        "each year and savings cover whatever the "
                                        "pension doesn't."),
                    ]),
                ],
                style={"display": "flex", "gap": "20px", "flexWrap": "wrap"},
            ),
            html.Div(
                [
                    html.Button(t("RESET"), id="ci-ret-reset", n_clicks=0,
                                style={**theme.PERIOD_BUTTON_STYLE, "marginRight": "10px"}),
                    html.Button(t("CALCULATE"), id="ci-ret-calc", n_clicks=0,
                                style=theme.BUTTON_STYLE),
                    dcc.Checklist(
                        id="ci-ret-showreal",
                        options=[{"label": t(" Show today's money (real)"), "value": "real"}],
                        value=["real"], inline=True,
                        labelStyle={"cursor": "pointer", "whiteSpace": "nowrap"},
                        style={"display": "inline-block", "marginLeft": "24px"},
                    ),
                ],
                style={"marginTop": "16px", "display": "flex", "alignItems": "center",
                       "flexWrap": "wrap"},
            ),
            # ── Uncertainty (Monte Carlo) ────────────────────────────────────────
            html.Div(
                [
                    html.Div(
                        dcc.Checklist(
                            id="ci-ret-mc",
                            options=[{"label": t(" Show uncertainty (Monte Carlo)"),
                                      "value": "on"}],
                            value=[], inline=True,
                            labelStyle={"cursor": "pointer", "whiteSpace": "nowrap",
                                        "fontWeight": 600},
                        ),
                        style={"marginBottom": "10px"},
                    ),
                    html.Div(
                        [
                            html.Div(
                                _num_field("Return volatility (%/yr)",
                                           "ci-ret-vol-return", d["vol_return"],
                                           info="Year-to-year swing (std. dev.) of the "
                                                "investment return — the main source of "
                                                "uncertainty. ~15% is typical for a "
                                                "stock-heavy portfolio."),
                                style={"flex": "1 1 150px", "minWidth": "140px"}),
                            html.Div(
                                _num_field("Inflation volatility (%/yr)",
                                           "ci-ret-vol-infl", d["vol_infl"],
                                           info="Year-to-year swing of inflation around "
                                                "the rate you entered."),
                                style={"flex": "1 1 150px", "minWidth": "140px"}),
                            html.Div(
                                _num_field("Deposit-growth volatility (%/yr)",
                                           "ci-ret-vol-deposit", d["vol_deposit"],
                                           pop_right=True,
                                           info="Year-to-year swing of your salary-raise "
                                                "rate."),
                                style={"flex": "1 1 150px", "minWidth": "140px"}),
                            html.Div(
                                _num_field("Simulations", "ci-ret-nmc", d["n_mc"],
                                           pop_right=True,
                                           info="How many random futures to simulate. "
                                                "More runs give a smoother median "
                                                "(100–3000)."),
                                style={"flex": "1 1 120px", "minWidth": "110px"}),
                        ],
                        style={"display": "flex", "gap": "16px", "flexWrap": "wrap"},
                    ),
                    html.Div(
                        t("Ages, retirement age, life expectancy, principal and the "
                          "initial monthly deposit are held fixed; only the rates above "
                          "vary between runs."),
                        style={"color": theme.MUTED, "fontSize": "12px",
                               "marginTop": "8px"}),
                ],
                style={"marginTop": "16px", "paddingTop": "16px",
                       "borderTop": "1px solid var(--border)"},
            ),
        ],
    )
    goals_card = card(
        html.Div(
            [
                # The title stays visible in privacy mode; only the checklist (goal
                # names/amounts) is hidden via .ci-goals-block. The hint span reveals
                # itself only when censored (CSS in style.css).
                html.Span(t("Financial Goals to achieve"), style={"fontWeight": 600,
                                                               "marginRight": "8px"}),
                html.Span(t("(unhide to see goals)"), className="goals-hidden-hint",
                          style={"color": theme.MUTED, "marginRight": "12px"}),
                html.Div(
                    dcc.Checklist(
                        id="ci-ret-goals", options=_goal_options(), value=[],
                        inline=True,
                        labelStyle={"marginRight": "18px", "cursor": "pointer"},
                    ),
                    className="ci-goals-block",
                    style={"display": "flex", "alignItems": "center",
                           "flexWrap": "wrap", "gap": "6px"},
                ),
            ],
            className="ci-goals-bar",
            style={"display": "flex", "alignItems": "center", "flexWrap": "wrap",
                   "gap": "6px"},
        ),
        style={"marginTop": "20px"},
    )
    results_graph = html.Div(
        [
            # Fixed width (minWidth:0 stops the two-column goals table from expanding
            # the flex item), so the box stays the same size with or without goals.
            card(html.Div(id="ci-ret-results"),
                 style={"flex": "0 0 400px", "minWidth": 0}),
            card(
                [
                    _logy_toggle("ci-ret-logy"),
                    dcc.Graph(id="ci-ret-graph", style={"height": "460px"},
                              config={"scrollZoom": True, "displaylogo": False,
                                      "modeBarButtonsToRemove": [
                                          "zoom2d", "select2d", "lasso2d"]}),
                ],
                style={"flex": "1", "marginLeft": "20px"},
            ),
        ],
        style={"display": "flex", "alignItems": "stretch", "marginTop": "20px"},
    )
    return html.Div([plan_card, goals_card, results_graph], id="ci-retire-view",
                    style={"display": "block"})


def layout(**_):
    return html.Div(
        [
            page_header("Retirement Planning",
                        "Plan your path to retirement — project your savings, "
                        "spending, and financial-freedom age."),
            _mode_bar(),
            _simple_view(),
            _retire_view(),
        ],
        style=theme.PAGE_STYLE,
    )


def _result_row(label, value):
    return html.Div(
        [html.Span(t(label), style={"color": theme.MUTED}),
         html.Span(value, style={"fontWeight": 600, "whiteSpace": "nowrap"})],
        style=theme.RESULT_ROW_STYLE,
    )


# Columns of the goal-achievement table, matched to the chart's line colours:
# don't-buy = green maturity line, plain = pink line, factor = purple line.
_ACH_COLS = [
    ("month_nobuy", "Don't buy", theme.INCOME_COLOR),
    ("month_plain", "Buy at amount", "#e84393"),
    ("month_factor", "Buy at ×factor", "#8e44ad"),
]
_TH_STYLE = {"padding": "8px 10px", "fontSize": "12px", "fontWeight": 600,
             "borderBottom": "1px solid var(--border)"}
_TD_STYLE = {"padding": "8px 10px", "borderBottom": "1px solid var(--border-soft)",
             "verticalAlign": "top"}


def _fmt_months(m):
    """A month count as a bold number over a muted years/months breakdown."""
    if m is None:
        return html.Span("—", style={"color": theme.MUTED})
    m = int(m)
    y, mo = divmod(m, 12)
    sub = f"{y}y {mo}m" if (y and mo) else (f"{y}y" if y else f"{mo}m")
    return html.Div(
        [
            html.Span(f"{m}", style={"fontWeight": 600, "color": theme.INK}),
            html.Span(t(" mo"), style={"color": theme.MUTED, "fontSize": "12px"}),
            html.Div(sub, style={"color": theme.MUTED, "fontSize": "11px"}),
        ]
    )


def _goal_table(achievement, cur):
    """Card with a row per selected goal and a column per buying strategy, each
    cell being the number of months until that goal is reached. Returns ``None``
    when no goals are selected (nothing renders)."""
    if not achievement:
        return None

    header = html.Tr(
        [html.Th(t("Goal"), style={**_TH_STYLE, "textAlign": "left",
                                "color": theme.MUTED})]
        + [html.Th(t(label), style={**_TH_STYLE, "textAlign": "right", "color": col})
           for _, label, col in _ACH_COLS]
    )

    rows = []
    for g in achievement:
        f = g["factor"]
        meta = f"{g['amount']:,.0f} {cur}" + (f" · ×{f:g}" if f > 1 else "")
        label_cell = html.Td(
            html.Div([
                html.Span(g["name"], style={"fontWeight": 600, "color": theme.INK}),
                html.Div(meta, style={"color": theme.MUTED, "fontSize": "12px"}),
            ]),
            style={**_TD_STYLE, "textAlign": "left"},
        )
        cells = [label_cell] + [
            html.Td(_fmt_months(g[key]), style={**_TD_STYLE, "textAlign": "right"})
            for key, _, _ in _ACH_COLS
        ]
        rows.append(html.Tr(cells))

    return card(
        [
            html.H3(t("When you'll reach each goal"),
                    style={"marginTop": 0, "color": theme.INK}),
            html.P(t("Months until each selected goal is reached, under three "
                     "strategies. “Don't buy” follows the green maturity "
                     "line (money is never spent). “Buy at amount” and "
                     "“Buy at ×factor” spend in your Financial Goals "
                     "rank order, so buying an earlier goal pushes later goals back."),
                   style={"color": theme.MUTED, "fontSize": "13px"}),
            html.Table([html.Thead(header), html.Tbody(rows)],
                       style={"width": "100%", "borderCollapse": "collapse"}),
        ],
        style={"marginTop": "20px"},
    )


@callback(
    Output("ci-graph", "figure"),
    Output("ci-results", "children"),
    Output("ci-goal-arrows", "data"),
    Output("ci-goal-table", "children"),
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
    table = _goal_table(sched.get("achievement") or [], currency())
    return fig, results, arrows, table


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


# ── Retirement Planning mode ─────────────────────────────────────────────────

@callback(
    Output("ci-simple-view", "style"),
    Output("ci-retire-view", "style"),
    Output("ci-mode-simple", "style"),
    Output("ci-mode-retire", "style"),
    Input("ci-mode-simple", "n_clicks"),
    Input("ci-mode-retire", "n_clicks"),
    prevent_initial_call=True,
)
def _switch_mode(_s, _r):
    """Show one tool and hide the other, moving the active-button style with it."""
    retire = ctx.triggered_id == "ci-mode-retire"
    active, inactive = theme.PERIOD_BUTTON_ACTIVE_STYLE, theme.PERIOD_BUTTON_STYLE
    if retire:
        return ({"display": "none"}, {"display": "block"}, inactive, active)
    return ({"display": "block"}, {"display": "none"}, active, inactive)


def _outcome_text(summary, life):
    """(text, colour) for a strategy's funds-last / runs-out outcome."""
    if summary["covered"]:
        return t("Lasts to {age}").format(age=f"{life:.0f}"), theme.INCOME_COLOR
    return (t("Runs out {age}").format(age=f"{summary['depletion_age']:.0f}"),
            theme.EXPENSE_COLOR)


def _strategy_table(res, money, mc=None):
    """Two-column (×factor | plain) comparison of the goal-affected figures. When ``mc``
    is given, each goal's ×factor age cell shows the 16–84% achievement range."""
    life = res["life_expectancy"]
    sf, sp = res["summary_factor"], res["summary_plain"]
    f_out, f_col = _outcome_text(sf, life)
    p_out, p_col = _outcome_text(sp, life)

    th = {"padding": "6px 8px", "fontSize": "12px", "fontWeight": 600,
          "borderBottom": "1px solid var(--border)", "textAlign": "right"}
    td = {"padding": "6px 8px", "borderBottom": "1px solid var(--border-soft)",
          "textAlign": "right", "whiteSpace": "nowrap"}
    lab = {**td, "textAlign": "left", "color": theme.MUTED}

    def row(label, fcell, pcell, fcolor=theme.INK, pcolor=theme.INK,
            border=True, topline=False):
        bd = {} if border else {"borderBottom": "none"}
        if topline:
            bd = {**bd, "borderTop": "1px solid var(--border-soft)"}
        return html.Tr([
            html.Td(label, style={**lab, **bd}),
            html.Td(fcell, style={**td, **bd, "color": fcolor, "fontWeight": 600}),
            html.Td(pcell, style={**td, **bd, "color": pcolor, "fontWeight": 600}),
        ])

    # One indented, borderless row per selected goal, showing the age it's reached
    # under each strategy (grey) — red "not reached" when never bought.
    f_age = {h["name"]: h["age"] for h in res.get("goal_hits_factor", [])}
    p_age = {h["name"]: h["age"] for h in res.get("goal_hits_plain", [])}
    goal_lab = {**lab, "paddingLeft": "20px", "fontSize": "12px",
                "borderBottom": "none"}
    goal_val = {**td, "fontSize": "12px", "fontWeight": 500, "borderBottom": "none"}

    def _age_cell(ages_map, name):
        if name in ages_map:
            return f"{ages_map[name]:.0f}", theme.MUTED
        return t("not reached"), theme.EXPENSE_COLOR

    # In Monte Carlo mode the ×factor column shows each goal's 16–84% age range.
    mc_ev = {e["name"]: e for e in ((mc.get("goal_events") or []) if mc else [])}

    def _factor_cell(name):
        if mc is not None:
            ev = mc_ev.get(name)
            if ev and ev.get("prob", 0) > 0:
                return f"{ev['p50']:.0f} ({ev['p16']:.0f}–{ev['p84']:.0f})", theme.MUTED
            return t("not reached"), theme.EXPENSE_COLOR
        return _age_cell(f_age, name)

    def goal_row(name):
        f_txt, f_c = _factor_cell(name)
        p_txt, p_c = _age_cell(p_age, name)
        return html.Tr([
            html.Td(name, style=goal_lab),
            html.Td(f_txt, style={**goal_val, "color": f_c}),
            html.Td(p_txt, style={**goal_val, "color": p_c}),
        ])

    goal_rows = [goal_row(name) for name in res.get("goal_names", [])]

    header = html.Tr([
        html.Th("", style={**th, "textAlign": "left"}),
        html.Th(t("×factor"), style={**th, "color": theme.INCOME_COLOR}),
        html.Th(t("plain"), style={**th, "color": "#e84393"}),
    ])
    body = [
        row(t("Pot at retirement"), money(sf["pot_at_retirement"]),
            money(sp["pot_at_retirement"])),
        row(t("Spent on goals"), money(sf["total_spent"]), money(sp["total_spent"]),
            border=False),
        *goal_rows,
        row(t("Outcome"), f_out, p_out, f_col, p_col, topline=True),
        row(t("Ending balance"), money(sf["ending_nominal"]),
            money(sp["ending_nominal"])),
    ]
    return html.Table([html.Thead(header), html.Tbody(body)],
                      style={"width": "100%", "borderCollapse": "collapse",
                             "marginTop": "8px"})


def _range_txt(ev):
    """A "med (16–84%: a–b)" string for a Monte Carlo event dict, or "—" if it never
    happened."""
    if not ev:
        return "—"
    return t("age {p50} (16–84%: {p16}–{p84})").format(
        p50=f"{ev['p50']:.0f}", p16=f"{ev['p16']:.0f}", p84=f"{ev['p84']:.0f}")


def _mc_summary_rows(mc, cur):
    """Monte Carlo headline: the probability the plan's money lasts to life expectancy,
    plus the 16–84% age range over the runs where it runs out."""
    prob = mc["success_prob"]
    color = (theme.INCOME_COLOR if prob >= 0.85 else
             "#f39c12" if prob >= 0.6 else theme.EXPENSE_COLOR)
    rows = [html.Div(
        [html.Span(t("Plan succeeds"), style={"color": theme.MUTED}),
         html.Span(t("{prob} of {n} runs").format(prob=f"{prob:.0%}",
                                                  n=f"{mc['n_mc']:,}"),
                   style={"fontWeight": 700, "color": color, "whiteSpace": "nowrap"})],
        style=theme.RESULT_ROW_STYLE)]
    dep = mc.get("depletion")
    if dep is not None:
        rows.append(_result_row("Funds-out age (16–84%)",
                                t("{p16}–{p84} (med {p50})").format(
                                    p16=f"{dep['p16']:.0f}", p84=f"{dep['p84']:.0f}",
                                    p50=f"{dep['p50']:.0f}")))
    return rows


def _ret_results_block(res, cur, mc=None):
    money = lambda v: f"{v:,.0f} {cur}"
    if mc is not None:
        # Freedom age becomes a 16–84% range across the simulated futures.
        ff_txt = _range_txt(mc.get("freedom"))
    else:
        ff = res.get("financial_freedom_age")
        ff_txt = t("age {age}").format(age=f"{ff:.0f}") if ff is not None else "—"
    mc_rows = _mc_summary_rows(mc, cur) if mc is not None else []
    shared = [
        _result_row("Monthly expense at retirement", money(res["expense_at_retirement"])),
        _result_row("Pension (monthly)", money(res["pension"])),
        _result_row("Years in retirement", f"{res['years_in_retirement']:.0f}"),
        _result_row("Financial freedom", ff_txt),
        _result_row("Total contributions", money(res["total_contributions"])),
    ]

    if res.get("has_goals"):
        # Goals selected: pot / outcome / ending differ by buy strategy, so compare
        # ×factor vs plain side by side.
        return html.Div(mc_rows + shared + [_strategy_table(res, money, mc)],
                        style={"marginTop": "4px"})

    rows = mc_rows + [_result_row("Pot at retirement",
                                  money(res["balance_at_retirement"]))] + shared
    if res["covered"]:
        word = t("Funds last through age {age}").format(
            age=f"{res['life_expectancy']:.0f}")
        color = theme.INCOME_COLOR
        tail = _result_row("Ending balance", money(res["ending_nominal"]))
    else:
        word = t("Funds run out at age {age}").format(
            age=f"{res['depletion_age']:.0f}")
        color = theme.EXPENSE_COLOR
        tail = None
    outcome = html.Div(
        [html.Span(t("Outcome"), style={"color": theme.MUTED}),
         html.Span(word, style={"fontWeight": 700, "color": color,
                                "textAlign": "right"})],
        style={**theme.RESULT_ROW_STYLE, "borderBottom": "none"},
    )
    body = rows + ([tail] if tail else []) + [outcome]
    return html.Div(body, style={"marginTop": "4px"})


@callback(
    Output("ci-ret-graph", "figure"),
    Output("ci-ret-results", "children"),
    Input("ci-ret-calc", "n_clicks"),
    Input("theme-store", "data"),
    Input("ci-ret-showreal", "value"),
    Input("ci-ret-goals", "value"),
    Input("ci-ret-logy", "value"),
    Input("ci-ret-mc", "value"),
    State("ci-cur-age", "value"),
    State("ci-ret-age", "value"),
    State("ci-life", "value"),
    State("ci-ret-principal", "value"),
    State("ci-ret-deposit", "value"),
    State("ci-ret-increase", "value"),
    State("ci-ret-rate", "value"),
    State("ci-ret-infl", "value"),
    State("ci-ret-bonus", "value"),
    State("ci-ret-pension", "value"),
    State("ci-ret-expense", "value"),
    State("ci-ret-vol-return", "value"),
    State("ci-ret-vol-infl", "value"),
    State("ci-ret-vol-deposit", "value"),
    State("ci-ret-nmc", "value"),
)
def _calculate_retire(_n, theme_value, showreal, sel_goals, logy_val, mc_val, cur_age,
                      ret_age, life, principal, deposit, increase, rate, infl, bonus,
                      pension, expense, vol_return, vol_infl, vol_deposit, n_mc):
    # Buy in Financial-Goals rank order (top-ranked first), like the Simple calc.
    goals = load_goals()
    chosen = set(sel_goals or [])
    selected = [(nm, goals[nm], goal_factor(nm)) for nm in goals
                if nm != EMERGENCY_FUND and nm in chosen]
    plan = dict(
        current_age=cur_age or 0, retirement_age=ret_age or 0,
        life_expectancy=life or 0, principal=principal or 0,
        monthly_deposit=deposit or 0, increasement=(increase or 0) / 100.0,
        annual_rate=(rate or 0) / 100.0, inflation=(infl or 0) / 100.0,
        retirement_bonus=bonus or 0, pension=pension or 0, expense=expense or 0,
        goals=selected)
    res = compute_retirement(**plan)

    # Optional Monte Carlo overlay: median line + nested uncertainty bands.
    mc = None
    if "on" in (mc_val or []):
        n_runs = int(min(max(int(n_mc or 1000), 100), 3000))
        mc = simulate_retirement_mc(
            **plan, vol_return=(vol_return or 0) / 100.0,
            vol_inflation=(vol_infl or 0) / 100.0,
            vol_deposit=(vol_deposit or 0) / 100.0, n_mc=n_runs)

    show_real = "real" in (showreal or [])
    fig = build_retirement_figure(res, currency(), dark=theme.is_dark(theme_value),
                                  show_real=show_real,
                                  logy=("log" in (logy_val or [])), mc=mc)
    return fig, _ret_results_block(res, currency(), mc=mc)


@callback(
    Output("ci-cur-age", "value"),
    Output("ci-ret-age", "value"),
    Output("ci-life", "value"),
    Output("ci-ret-principal", "value"),
    Output("ci-ret-deposit", "value"),
    Output("ci-ret-increase", "value"),
    Output("ci-ret-rate", "value"),
    Output("ci-ret-infl", "value"),
    Output("ci-ret-bonus", "value"),
    Output("ci-ret-pension", "value"),
    Output("ci-ret-expense", "value"),
    Output("ci-ret-vol-return", "value"),
    Output("ci-ret-vol-infl", "value"),
    Output("ci-ret-vol-deposit", "value"),
    Output("ci-ret-nmc", "value"),
    Input("ci-ret-reset", "n_clicks"),
    prevent_initial_call=True,
)
def _reset_retire(_n):
    d = RETIRE_DEFAULTS
    return (d["cur_age"], d["ret_age"], d["life"], d["principal"], d["deposit"],
            d["increase"], d["rate"], d["infl"], d["bonus"], d["pension"],
            d["expense"], d["vol_return"], d["vol_infl"], d["vol_deposit"], d["n_mc"])
