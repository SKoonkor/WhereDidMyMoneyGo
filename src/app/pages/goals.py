"""Feature 3 — Financial Goals page (slide 6)."""

from __future__ import annotations

import dash
from dash import dcc, html, callback, Input, Output, State, no_update, ctx

from src.app import theme
from src.app.components import page_header, card, money_span
from src.app.i18n import make_t
from src.app.data import get_df, emergency_fund_config, currency
from src.app.figures.goals import build_goal_gauge
from src.analytics.emergency_fund import emergency_fund_status
from src.analytics.goals import (

    load_goals, add_goal, remove_goal, reorder_goals, load_factors, goal_factor,
    load_selected, save_selected, pool_target, EMERGENCY_FUND)

t = make_t("goals")

dash.register_page(__name__, path="/goals", name="Financial Goals", order=3)


def _compact(v: float) -> str:
    """Goal target, compacted: ``XXX.XXk`` / ``XXX.XXM`` above 1k / 1M."""
    if v >= 1_000_000:
        return f"{v / 1_000_000:.2f}M"
    if v >= 1_000:
        return f"{v / 1_000:.2f}k"
    return f"{v:,.0f}"


def _fmt_factor(f: float) -> str:
    """Factor without trailing zeros: 5.0 → "5", 1.2 → "1.2"."""
    return f"{f:g}"


def _clean_factor(f) -> float:
    """Coerce a raw factor input to a float ≥ 1.0 (blank/invalid → 1.0)."""
    try:
        return max(float(f or 1), 1.0)
    except (TypeError, ValueError):
        return 1.0


def _rule_tag(factor: float) -> str:
    """``[1.2x rule]`` / ``[กฎ 1.2 เท่า]`` for a >1 multiplier; ``""`` for 1×."""
    if factor > 1:
        return t("[{fx}x rule]").format(fx=_fmt_factor(factor))
    return ""


def _goal_rows(goals: dict, selected: list[str], factors: dict | None = None) -> list:
    """Draggable, click-to-select rows for every goal except the Emergency Fund."""
    selected = set(selected or [])
    factors = load_factors() if factors is None else factors
    rows = []
    for name, amt in goals.items():
        if name == EMERGENCY_FUND:
            continue
        label = [f"{name} (", money_span(f"{_compact(amt)} {currency()}"), ")"]
        tag = _rule_tag(goal_factor(name, factors))
        if tag:
            label.append(f" {tag}")
        rows.append(html.Div(
            [
                html.Span(className="goal-check"),
                html.Span(label, className="goal-label"),
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


def _other_goals(goals: dict, censor: bool = False,
                 factors: dict | None = None) -> list[dict]:
    # Dropdown labels are plain strings (no CSS masking) — drop the amount (and the
    # rule tag) when privacy mode is on.
    factors = load_factors() if factors is None else factors

    def _label(name, amt):
        if censor:
            return name
        tag = _rule_tag(goal_factor(name, factors))
        return f"{name} ({_compact(amt)} {currency()})" + (f" {tag}" if tag else "")

    return [
        {"label": _label(name, amt), "value": name}
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
            dcc.ConfirmDialog(id="goal-add-confirm"),
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
                            dcc.Input(id="goal-factor", type="number", min=1, step="any",
                                      placeholder=t("xTimes rule factor (≥ 1, optional)"),
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
                                  config={"displayModeBar": False, "responsive": True}),
                        style={"flex": "1", "marginLeft": "20px"},
                    ),
                ],
                className="mt-split",
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
    Input("goal-add-confirm", "submit_n_clicks"),
    Input("goal-del-confirm", "submit_n_clicks"),
    State("goal-name", "value"),
    State("goal-amount", "value"),
    State("goal-factor", "value"),
    State("goal-del-select", "value"),
    prevent_initial_call=True,
)
def _mutate_goals(_add_submit, _del_submit, name, amount, factor, del_name):
    trigger = ctx.triggered_id
    if trigger == "goal-add-confirm":
        if not name or amount is None:
            return no_update, no_update, no_update, no_update, no_update
        goals = add_goal(name, amount, factor or 1)
        return goals, t("Added '{name}'.").format(name=name.strip()), "", None, None
    if trigger == "goal-del-confirm" and del_name:
        goals = remove_goal(del_name)
        return goals, t("Deleted '{name}'.").format(name=del_name), no_update, no_update, no_update
    return no_update, no_update, no_update, no_update, no_update


@callback(
    Output("goal-add-confirm", "displayed"),
    Output("goal-add-confirm", "message"),
    Output("goal-msg", "children", allow_duplicate=True),
    Input("goal-add", "n_clicks"),
    State("goal-name", "value"),
    State("goal-amount", "value"),
    State("goal-factor", "value"),
    prevent_initial_call=True,
)
def _confirm_add(_n, name, amount, factor):
    """Describe the goal about to be added and ask for confirmation before saving."""
    if not name or amount is None:
        return False, "", t("Enter both a name and a target amount.")
    f = _clean_factor(factor)
    amt = f"{float(amount):,.0f}"
    if f > 1:
        msg = t("Add '{name}' with a target of {amount} {cur} and a {fx}x rule?").format(
            name=name.strip(), amount=amt, cur=currency(), fx=_fmt_factor(f))
    else:
        msg = t("Add '{name}' with a target of {amount} {cur} and no multiplier?").format(
            name=name.strip(), amount=amt, cur=currency())
    return True, msg, no_update


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
