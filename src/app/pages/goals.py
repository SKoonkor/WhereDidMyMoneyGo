"""Feature 3 — Financial Goals page (slide 6)."""

import dash
from dash import dcc, html, callback, Input, Output, State, no_update, ctx

from src.app import theme
from src.app.components import page_header, card, money_span
from src.app.data import get_df, emergency_fund_config, CURRENCY
from src.app.figures.goals import build_goal_gauge
from src.analytics.emergency_fund import emergency_fund_status
from src.analytics.goals import (
    load_goals, add_goal, remove_goal, reorder_goals, EMERGENCY_FUND)

dash.register_page(__name__, path="/goals", name="Financial Goals", order=3)


def _goal_rows(goals: dict, selected: list[str]) -> list:
    """Draggable, click-to-select rows for every goal except the Emergency Fund."""
    selected = set(selected or [])
    rows = []
    for name, amt in goals.items():
        if name == EMERGENCY_FUND:
            continue
        rows.append(html.Div(
            [
                html.Span(className="goal-check"),
                html.Span([f"{name} (", money_span(f"{amt:,.0f} {CURRENCY}"), ")"],
                          className="goal-label"),
            ],
            className="goal-row" + (" selected" if name in selected else ""),
            **{"data-goal": name},
        ))
    return rows


def _savings_balance() -> float:
    ef = emergency_fund_config()
    status = emergency_fund_status(
        get_df(), ef["savings_account"], ef["monthly_required"], ef["target_months"]
    )
    return status["current_balance"]


def _other_goals(goals: dict, censor: bool = False) -> list[dict]:
    # Dropdown labels are plain strings (no CSS masking) — drop the amount when
    # privacy mode is on.
    return [
        {"label": (name if censor else f"{name} ({amt:,.0f} {CURRENCY})"),
         "value": name}
        for name, amt in goals.items()
        if name != EMERGENCY_FUND
    ]


def layout(**_):
    goals = load_goals()
    return html.Div(
        [
            page_header("Financial Goals",
                        "The Emergency Fund is always included in the pool. "
                        "Select other goals to add their targets on top."),
            dcc.Store(id="goals-store", data=goals),
            dcc.Store(id="goals-select-store", data=[]),
            dcc.Store(id="goals-order-store"),
            dcc.ConfirmDialog(id="goal-del-confirm"),
            html.Div(
                [
                    card(
                        [
                            html.H3("Goals", style={"marginTop": 0, "color": theme.INK}),
                            html.P("Drag to reorder · click to add to the pool.",
                                   style={"color": theme.MUTED, "fontSize": "13px",
                                          "marginTop": 0}),
                            html.Div(_goal_rows(goals, []), id="goals-list",
                                     className="goals-list"),

                            html.Hr(),
                            html.H4("Add a goal", style={"color": theme.MUTED,
                                                         "marginBottom": "8px"}),
                            dcc.Input(id="goal-name", type="text", placeholder="Goal name",
                                      style=theme.INPUT_STYLE),
                            dcc.Input(id="goal-amount", type="number",
                                      placeholder=f"Target ({CURRENCY})",
                                      style=theme.INPUT_STYLE),
                            html.Button("+ Add goal", id="goal-add", n_clicks=0,
                                        style={**theme.BUTTON_STYLE, "width": "100%"}),

                            html.Hr(),
                            html.H4("Delete a goal", style={"color": theme.MUTED,
                                                            "marginBottom": "8px"}),
                            dcc.Dropdown(id="goal-del-select",
                                         options=_other_goals(goals),
                                         placeholder="Select a goal…",
                                         style={"marginBottom": "10px"}),
                            html.Button("Delete goal", id="goal-del-btn", n_clicks=0,
                                        style={**theme.PERIOD_BUTTON_STYLE, "width": "100%",
                                               "color": theme.EXPENSE_COLOR,
                                               "borderColor": theme.EXPENSE_COLOR}),

                            html.Div(id="goal-msg",
                                     style={"color": theme.ACCENT, "marginTop": "10px",
                                            "fontSize": "13px"}),
                        ],
                        style={"flex": "0 0 320px"},
                    ),
                    card(
                        dcc.Graph(id="goals-gauge", style={"height": "520px"},
                                  config={"displayModeBar": False}),
                        style={"flex": "1", "marginLeft": "20px"},
                    ),
                ],
                style={"display": "flex", "alignItems": "stretch"},
            ),
        ],
        style=theme.PAGE_STYLE,
    )


@callback(
    Output("goals-store", "data"),
    Output("goal-msg", "children"),
    Output("goal-name", "value"),
    Output("goal-amount", "value"),
    Input("goal-add", "n_clicks"),
    Input("goal-del-confirm", "submit_n_clicks"),
    State("goal-name", "value"),
    State("goal-amount", "value"),
    State("goal-del-select", "value"),
    prevent_initial_call=True,
)
def _mutate_goals(_add_clicks, _del_submit, name, amount, del_name):
    trigger = ctx.triggered_id
    if trigger == "goal-add":
        if not name or amount is None:
            return no_update, "Enter both a name and a target amount.", no_update, no_update
        goals = add_goal(name, amount)
        return goals, f"Added '{name.strip()}'.", "", None
    if trigger == "goal-del-confirm" and del_name:
        goals = remove_goal(del_name)
        return goals, f"Deleted '{del_name}'.", no_update, no_update
    return no_update, no_update, no_update, no_update


@callback(
    Output("goal-del-confirm", "displayed"),
    Output("goal-del-confirm", "message"),
    Input("goal-del-btn", "n_clicks"),
    State("goal-del-select", "value"),
    prevent_initial_call=True,
)
def _confirm_delete(_n, del_name):
    if not del_name:
        return False, ""
    return True, f"Delete the goal '{del_name}'? This cannot be undone."


@callback(
    Output("goal-del-select", "options"),
    Output("goal-del-select", "value"),
    Input("goals-store", "data"),
    Input("censor-store", "data"),
)
def _refresh_options(goals, censor):
    opts = _other_goals(goals or load_goals(), theme.is_censored(censor))
    return opts, None


@callback(
    Output("goals-list", "children"),
    Input("goals-store", "data"),
    Input("goals-select-store", "data"),
)
def _render_goals_list(goals, selected):
    return _goal_rows(goals or load_goals(), selected or [])


@callback(
    Output("goals-store", "data", allow_duplicate=True),
    Input("goals-order-store", "data"),
    prevent_initial_call=True,
)
def _apply_order(order):
    if not order:
        return no_update
    return reorder_goals(order)


@callback(
    Output("goals-gauge", "figure"),
    Input("goals-select-store", "data"),
    Input("goals-store", "data"),
    Input("theme-store", "data"),
    Input("censor-store", "data"),
)
def _update_gauge(selected, goals, theme_value, censor):
    goals = goals or load_goals()
    selected = [g for g in (selected or []) if g in goals]
    ef = emergency_fund_config()
    balance = _savings_balance()

    ef_target = goals.get(EMERGENCY_FUND, 60000)
    pooled = ef_target + sum(goals.get(g, 0) for g in selected)
    labels = [EMERGENCY_FUND] + selected

    return build_goal_gauge(
        balance=balance, pooled_target=pooled,
        monthly_required=ef["monthly_required"],
        selected_labels=labels, currency=CURRENCY,
        dark=theme.is_dark(theme_value),
        censor=theme.is_censored(censor),
    )
