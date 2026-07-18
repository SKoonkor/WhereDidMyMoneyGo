"""Feature 1 — Money Flow page (slide 4)."""

from datetime import datetime

import dash
from dash import dcc, html, callback, clientside_callback, Input, Output, State

from src.app import theme
from src.app.components import (page_header, LANDSCAPE_JS, ls_enter_children,
                                ls_exit_children)
from src.app.i18n import make_t
from src.app.data import get_df, currency
from src.app.figures.money_flow import build_money_flow_figure
from src.analytics import forecast as F

t = make_t("flow")

dash.register_page(__name__, path="/flow", name="Money Flow", order=1)

# Both "Reset axes" and "Autoscale" are re-snapped (clientside, below) to the
# opening window — the last ~2 months of real data plus the selected forecast.
_GRAPH_CONFIG = {
    "displaylogo": False,
    "doubleClick": "reset",
    "scrollZoom": True,
    "responsive": True,
    "modeBarButtonsToRemove": ["select2d", "lasso2d"],
}

_HORIZONS = [("30 d", "30"), ("90 d", "90"), ("180 d", "180"), ("1 y", "365")]


def _trained_text(model: dict) -> str:
    ts = model.get("trained_at") if model else None
    if not ts:
        return ""
    try:
        return t("Model trained ") + datetime.fromisoformat(ts).strftime("%d %b %Y %H:%M")
    except ValueError:
        return ""


def layout(**_):
    return html.Div(
        [
            page_header(
                "Money Flow",
                "Running balance across your accounts, with a forward forecast "
                "(dashed) and 50% / 90% uncertainty bands. Zoom/pan to explore; "
                "click an account in the legend to show/hide it.",
            ),
            dcc.Store(id="flow-forecast-refresh", data=0),
            dcc.Store(id="flow-reset-sink"),
            dcc.Store(id="flow-ls-dummy"),
            dcc.ConfirmDialog(
                id="flow-retrain-confirm",
                message=t("Retrain the forecast model on all your current "
                          "transactions? This replaces the saved model."),
            ),
            html.Div(
                [
                    # Controls double as the landscape head (hidden in landscape).
                    html.Div(
                        [
                            html.Span(t("Forecast:"), style={"color": theme.MUTED,
                                                          "marginRight": "8px"}),
                            dcc.RadioItems(
                                id="flow-horizon",
                                options=[{"label": f"  {t(lbl)}", "value": v}
                                         for lbl, v in _HORIZONS],
                                value="30", inline=True,
                                inputClassName="sq-tick",
                                inputStyle={"marginRight": "4px"},
                                labelStyle={"marginRight": "16px", "cursor": "pointer"},
                            ),
                            html.Button(t("Retrain model"), id="flow-retrain", n_clicks=0,
                                        style={**theme.PERIOD_BUTTON_STYLE,
                                               "marginLeft": "auto"}),
                            html.Span(id="flow-trained",
                                      style={"color": theme.MUTED, "fontSize": "13px",
                                             "marginLeft": "12px"}),
                            html.Button(ls_enter_children(), id="flow-ls-enter",
                                        n_clicks=0, className="ls-enter"),
                        ],
                        className="flow-controls ls-head",
                    ),
                    html.Div(
                        [
                            html.Button(ls_exit_children(), id="flow-ls-exit",
                                        n_clicks=0, className="ls-exit"),
                            dcc.Graph(id="flow-graph", className="ls-graph",
                                      style={"height": "640px"}, config=_GRAPH_CONFIG),
                        ],
                        className="ls-inner",
                    ),
                ],
                id="flow-graph-box", className="ls-box",
            ),
        ],
        style=theme.PAGE_STYLE,
    )


@callback(
    Output("flow-retrain-confirm", "displayed"),
    Input("flow-retrain", "n_clicks"),
    prevent_initial_call=True,
)
def _confirm_retrain(n_clicks):
    # A click just opens the confirmation dialog; nothing is retrained yet.
    return bool(n_clicks)


@callback(
    Output("flow-forecast-refresh", "data"),
    Input("flow-retrain-confirm", "submit_n_clicks"),
    prevent_initial_call=True,
)
def _retrain(submit_n_clicks):
    F.train_model(get_df())
    return submit_n_clicks


@callback(
    Output("flow-graph", "figure"),
    Output("flow-trained", "children"),
    Input("theme-store", "data"),
    Input("flow-horizon", "value"),
    Input("flow-forecast-refresh", "data"),
    Input("censor-store", "data"),
)
def _render(theme_value, horizon, _refresh, censor):
    df = get_df()
    model = F.load_model() or F.train_model(df)  # auto-train once if none saved
    fc = F.forecast(df, model, int(horizon or 30))
    fig = build_money_flow_figure(df, currency=currency(), default_days=60,
                                  dark=theme.is_dark(theme_value), forecast=fc,
                                  censor=theme.is_censored(censor))
    return fig, _trained_text(model)


# "Autoscale" and "Reset axes" both emit {"xaxis.autorange": true}, which would jump
# to the full history. Intercept that and relayout the x-axis back to the figure's
# opening window (last ~2 months of real data + the selected forecast). The figure
# prop still holds that window (client pan/zoom don't write it back), and the y-axis
# is fixed, so only x needs restoring. Setting an explicit range (autorange=false)
# does not re-trigger this branch, so there is no loop.
clientside_callback(
    """
    function(relayout, figure) {
        const noup = window.dash_clientside.no_update;
        if (!relayout || relayout['xaxis.autorange'] !== true) return noup;
        const xr = figure && figure.layout && figure.layout.xaxis
                   && figure.layout.xaxis.range;
        if (!xr) return noup;
        const gd = document.querySelector('#flow-graph .js-plotly-plot');
        if (!gd) return noup;
        window.Plotly.relayout(gd, {'xaxis.autorange': false,
                                    'xaxis.range': xr.slice()});
        return noup;
    }
    """,
    Output("flow-reset-sink", "data"),
    Input("flow-graph", "relayoutData"),
    State("flow-graph", "figure"),
    prevent_initial_call=True,
)


# Expand the money-flow chart full-screen (rotate on phones, fill on computers) — the
# shared .ls-box toggle.
clientside_callback(
    LANDSCAPE_JS,
    Output("flow-ls-dummy", "data"),
    Input("flow-ls-enter", "n_clicks"),
    Input("flow-ls-exit", "n_clicks"),
    prevent_initial_call=True,
)
