"""Feature 3 — Financial Goals page (slide 6)."""

import dash
from dash import dcc, html, callback, Input, Output, State, no_update, ctx

from src.app import theme
from src.app.components import page_header, card, money_span
from src.app.i18n import make_t
from src.app.data import get_df, emergency_fund_config, currency
from src.app.figures.goals import build_goal_gauge
from src.analytics.emergency_fund import emergency_fund_status
from src.analytics.goals import (

    load_goals, add_goal, remove_goal, reorder_goals,
    load_selected, save_selected, pool_target, EMERGENCY_FUND)

t = make_t("goals")

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
                html.Span([f"{name} (", money_span(f"{amt:,.0f} {currency()}"), ")"],
                          className="goal-label"),
            ],
            className="goal-row" + (" selected" if name in selected else ""),
            **{"data-goal": name},
        ))
    return rows


def _savings_balance() -> float:
    ef = emergency_fund_config()
    status = emergency_fund_status(
        get_df(), ef["savings_accounts"], ef["monthly_required"], ef["target_months"]
    )
    return status["current_balance"]


def _other_goals(goals: dict, censor: bool = False) -> list[dict]:
    # Dropdown labels are plain strings (no CSS masking) — drop the amount when
    # privacy mode is on.
    return [
        {"label": (name if censor else f"{name} ({amt:,.0f} {currency()})"),
         "value": name}
        for name, amt in goals.items()
        if name != EMERGENCY_FUND
    ]


def layout(**_):
    goals = load_goals()
    selected = load_selected()
    return html.Div(
        [
            page_header("Financial Goals",
                        "The Emergency Fund is always included in the pool. "
                        "Select other goals to add their targets on top."),
            dcc.Store(id="goals-store", data=goals),
            dcc.Store(id="goals-select-store", data=selected),
            dcc.Store(id="goals-select-sink"),
            dcc.Store(id="goals-order-store"),
            dcc.ConfirmDialog(id="goal-del-confirm"),
            html.Div(
                [
                    card(
                        [
                            html.H3(t("Goals"), style={"marginTop": 0, "color": theme.INK}),
                            html.P(t("Drag to reorder · click to add to the pool."),
                                   style={"color": theme.MUTED, "fontSize": "13px",
                                          "marginTop": 0}),
                            html.Div(_goal_rows(goals, selected), id="goals-list",
                                     className="goals-list"),

                            html.Hr(),
                            html.H4(t("Add a goal"), style={"color": theme.MUTED,
                                                         "marginBottom": "8px"}),
                            dcc.Input(id="goal-name", type="text", placeholder=t("Goal name"),
                                      style=theme.INPUT_STYLE),
                            dcc.Input(id="goal-amount", type="number",
                                      placeholder=f"{t('Target')} ({currency()})",
                                      style=theme.INPUT_STYLE),
                            dcc.Input(id="goal-factor", type="number", min=1, step=1,
                                      value=1,
                                      placeholder=t("Importance ×factor (default 1)"),
                                      style=theme.INPUT_STYLE),
                            html.Div(t("Multiplies this goal's target before it counts "
                                       "as reached (the pool needs the highest of your "
                                       "ticked goals)."),
                                     style={"color": theme.MUTED, "fontSize": "12px",
                                            "marginBottom": "8px"}),
                            html.Button(t("+ Add goal"), id="goal-add", n_clicks=0,
                                        style={**theme.BUTTON_STYLE, "width": "100%"}),

                            html.Hr(),
                            html.H4(t("Delete a goal"), style={"color": theme.MUTED,
                                                            "marginBottom": "8px"}),
                            dcc.Dropdown(id="goal-del-select",
                                         options=_other_goals(goals),
                                         placeholder=t("Select a goal…"),
                                         style={"marginBottom": "10px"}),
                            html.Button(t("Delete goal"), id="goal-del-btn", n_clicks=0,
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
    Output("goal-factor", "value"),
    Input("goal-add", "n_clicks"),
    Input("goal-del-confirm", "submit_n_clicks"),
    State("goal-name", "value"),
    State("goal-amount", "value"),
    State("goal-factor", "value"),
    State("goal-del-select", "value"),
    prevent_initial_call=True,
)
def _mutate_goals(_add_clicks, _del_submit, name, amount, factor, del_name):
    trigger = ctx.triggered_id
    if trigger == "goal-add":
        if not name or amount is None:
            return (no_update, t("Enter both a name and a target amount."),
                    no_update, no_update, no_update)
        goals = add_goal(name, amount, factor or 1)
        return goals, t("Added '{name}'.").format(name=name.strip()), "", None, 1
    if trigger == "goal-del-confirm" and del_name:
        goals = remove_goal(del_name)
        return goals, t("Deleted '{name}'.").format(name=del_name), no_update, no_update, no_update
    return no_update, no_update, no_update, no_update, no_update


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
    return True, t("Delete the goal '{name}'? This cannot be undone.").format(name=del_name)


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
    Output("goals-select-sink", "data"),
    Input("goals-select-store", "data"),
    prevent_initial_call=True,
)
def _persist_selection(selected):
    # The client-side tap handler (goals_dnd.js) updates goals-select-store; mirror
    # it to disk so the ticks survive a reload and drive the home savings gauge.
    save_selected(selected or [])
    return no_update


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

    # Emergency-fund target comes from Settings (months × monthly required), so
    # editing it there flows through here and to the home snapshot.
    ef_target = ef["monthly_required"] * ef["target_months"]
    pooled = pool_target(ef_target, goals, selected)
    labels = [EMERGENCY_FUND] + selected

    return build_goal_gauge(
        balance=balance, pooled_target=pooled,
        monthly_required=ef["monthly_required"],
        selected_labels=labels, currency=currency(),
        dark=theme.is_dark(theme_value),
        censor=theme.is_censored(censor),
    )
