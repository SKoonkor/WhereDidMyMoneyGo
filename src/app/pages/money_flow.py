"""Feature 1 — Money Flow page (slide 4)."""

from datetime import datetime

import dash
from dash import dcc, html, callback, Input, Output

from src.app import theme
from src.app.components import page_header
from src.app.data import get_df, CURRENCY
from src.app.figures.money_flow import build_money_flow_figure
from src.analytics import forecast as F

dash.register_page(__name__, path="/flow", name="Money Flow", order=1)

# "Reset axes" returns to the initial range; "Autoscale" shows everything.
_GRAPH_CONFIG = {
    "displaylogo": False,
    "doubleClick": "reset",
    "scrollZoom": True,
    "modeBarButtonsToRemove": ["select2d", "lasso2d"],
}

_HORIZONS = [("30 d", "30"), ("90 d", "90"), ("180 d", "180"), ("1 y", "365")]


def _trained_text(model: dict) -> str:
    ts = model.get("trained_at") if model else None
    if not ts:
        return ""
    try:
        return "Model trained " + datetime.fromisoformat(ts).strftime("%d %b %Y %H:%M")
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
            html.Div(
                [
                    html.Span("Forecast:", style={"color": theme.MUTED,
                                                  "marginRight": "8px"}),
                    dcc.RadioItems(
                        id="flow-horizon",
                        options=[{"label": f"  {lbl}", "value": v} for lbl, v in _HORIZONS],
                        value="30", inline=True,
                        inputStyle={"marginRight": "4px"},
                        labelStyle={"marginRight": "16px", "cursor": "pointer"},
                    ),
                    html.Button("Retrain model", id="flow-retrain", n_clicks=0,
                                style={**theme.PERIOD_BUTTON_STYLE, "marginLeft": "auto"}),
                    html.Span(id="flow-trained",
                              style={"color": theme.MUTED, "fontSize": "13px",
                                     "marginLeft": "12px"}),
                ],
                className="flow-controls",
            ),
            dcc.Store(id="flow-forecast-refresh", data=0),
            dcc.Graph(id="flow-graph", style={"height": "640px"},
                      config=_GRAPH_CONFIG),
        ],
        style=theme.PAGE_STYLE,
    )


@callback(
    Output("flow-forecast-refresh", "data"),
    Input("flow-retrain", "n_clicks"),
    prevent_initial_call=True,
)
def _retrain(n_clicks):
    F.train_model(get_df())
    return n_clicks


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
    fig = build_money_flow_figure(df, currency=CURRENCY, default_days=60,
                                  dark=theme.is_dark(theme_value), forecast=fc,
                                  censor=theme.is_censored(censor))
    return fig, _trained_text(model)
