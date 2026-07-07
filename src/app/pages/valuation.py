"""Stock Intrinsic Valuation — estimate fair value by several models.

Enter any yfinance ticker; assumptions auto-fill from its fundamentals and stay
editable. Shows an over/under-valuation gauge + per-method bars, a per-method
table with suitability notes, a DCF cash-flow breakdown, Bear/Base/Bull
scenarios, and a discount-rate × terminal-growth sensitivity heatmap.
"""

import dash
from dash import dcc, html, callback, ctx, Input, Output, State, no_update
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card
from src.app.figures.valuation import (build_valuation_gauge, build_methods_bar,
                                       build_dcf_breakdown, build_scenarios_bar,
                                       build_sensitivity_heatmap)
from src.io import valuation_data as V
from src.io.stocks import StockError
from src.analytics import valuation as VAL

dash.register_page(__name__, path="/valuation", name="Stock Intrinsic Valuation",
                   order=10)

_HIDDEN = {"display": "none"}
_GRAPH_CONFIG = {"scrollZoom": True, "displaylogo": False,
                 "modeBarButtonsToRemove": ["select2d", "lasso2d"]}
_DEFAULT_ERP = 5.0  # %, Damodaran-style implied equity risk premium
_LABEL = {"color": theme.MUTED, "fontSize": "13px"}


def _field(label, comp):
    return html.Div([html.Label(label, style=_LABEL), comp])


def _assumptions(a: dict) -> dict:
    """Convert the percent-valued inputs into the decimal kwargs the models use.

    Pairing rule (formula sheet §1.2): ``r`` is the CAPM cost of equity, used by
    the dividend/book-based models; ``wacc`` is used by the FCF-based DCF and EPV."""
    return {
        "rf": (a.get("rf") or 0) / 100,
        "r": (a.get("r") or 0) / 100,
        "wacc": (a.get("wacc") or 0) / 100 or None,   # None → fall back to r_e
        "g1": (a.get("g1") or 0) / 100,
        "g2": (a.get("g2") or 0) / 100,
        "gT": (a.get("gT") or 0) / 100,
    }


def layout(**_):
    return html.Div(
        [
            page_header("Stock Intrinsic Valuation",
                        "Estimate a stock's fair value by several models. Enter any "
                        "ticker — assumptions auto-fill and stay editable."),
            dcc.Store(id="val-store"),
            html.Div(
                [
                    html.Span("Ticker:", style={"color": theme.MUTED}),
                    dcc.Input(id="val-ticker", type="text", placeholder="e.g. AAPL",
                              debounce=True,
                              style={**theme.INPUT_STYLE, "marginBottom": 0,
                                     "width": "140px", "textTransform": "uppercase"}),
                    html.Button("Analyze", id="val-analyze", n_clicks=0,
                                style=theme.BUTTON_STYLE),
                    html.Span(id="val-msg", style={"color": theme.MUTED,
                                                   "fontSize": "13px"}),
                ],
                className="val-load",
            ),
            html.Div(
                [
                    card(
                        [
                            html.H3("Assumptions", style={"marginTop": 0}),
                            html.Div(
                                [
                                    _field("Cost of equity r_e (%)",
                                           dcc.Input(id="val-r", type="number",
                                                     step=0.1, style=theme.INPUT_STYLE)),
                                    _field("WACC (%)",
                                           dcc.Input(id="val-wacc", type="number",
                                                     step=0.1, style=theme.INPUT_STYLE)),
                                    _field("Risk-free r_f (%)",
                                           dcc.Input(id="val-rf", type="number",
                                                     step=0.1, style=theme.INPUT_STYLE)),
                                    _field("Beta",
                                           dcc.Input(id="val-beta", type="number",
                                                     step=0.05, style=theme.INPUT_STYLE)),
                                    _field("ERP (%)",
                                           dcc.Input(id="val-erp", type="number",
                                                     step=0.1, value=_DEFAULT_ERP,
                                                     style=theme.INPUT_STYLE)),
                                    _field("Stage-1 growth g1 (%)",
                                           dcc.Input(id="val-g1", type="number",
                                                     step=0.5, style=theme.INPUT_STYLE)),
                                    _field("Stage-2 growth g2 (%)",
                                           dcc.Input(id="val-g2", type="number",
                                                     step=0.5, style=theme.INPUT_STYLE)),
                                    _field("Terminal growth g_T (%)",
                                           dcc.Input(id="val-gt", type="number",
                                                     step=0.1, value=2.5,
                                                     style=theme.INPUT_STYLE)),
                                ],
                                className="val-grid",
                            ),
                            html.Button("Recalculate", id="val-recalc", n_clicks=0,
                                        style={**theme.PERIOD_BUTTON_STYLE,
                                               "marginTop": "6px"}),
                            html.Div(id="val-methods", style={"marginTop": "14px"}),
                        ],
                        style={"flex": "0 0 340px"},
                    ),
                    card(
                        [
                            html.Div(
                                [
                                    html.Div(dcc.Graph(id="val-gauge",
                                                       style={"height": "260px"},
                                                       config=_GRAPH_CONFIG),
                                             style={"flex": "1"}),
                                    html.Div(dcc.Graph(id="val-methods-bar",
                                                       style={"height": "260px"},
                                                       config=_GRAPH_CONFIG),
                                             style={"flex": "1.3"}),
                                ],
                                style={"display": "flex", "gap": "12px",
                                       "flexWrap": "wrap"},
                            ),
                            dcc.Graph(id="val-dcf", style={"height": "300px"},
                                      config=_GRAPH_CONFIG),
                            html.Div(
                                [
                                    html.Div(dcc.Graph(id="val-scenarios",
                                                       style={"height": "300px"},
                                                       config=_GRAPH_CONFIG),
                                             style={"flex": "1", "minWidth": "260px"}),
                                    html.Div(dcc.Graph(id="val-sensitivity",
                                                       style={"height": "300px"},
                                                       config=_GRAPH_CONFIG),
                                             style={"flex": "1.3", "minWidth": "320px"}),
                                ],
                                style={"display": "flex", "gap": "12px",
                                       "flexWrap": "wrap"},
                            ),
                        ],
                        style={"flex": "1", "marginLeft": "20px"},
                    ),
                ],
                id="val-main", className="val-main", style=_HIDDEN,
            ),
        ],
        style=theme.PAGE_STYLE,
    )


# ── Analyze: fetch inputs and auto-fill the assumptions ───────────────────────

@callback(
    Output("val-store", "data"),
    Output("val-msg", "children"),
    Output("val-r", "value"), Output("val-wacc", "value"),
    Output("val-rf", "value"), Output("val-beta", "value"),
    Output("val-g1", "value"), Output("val-g2", "value"),
    Input("val-analyze", "n_clicks"),
    Input("val-ticker", "value"),
    State("val-erp", "value"),
    prevent_initial_call=True,
)
def _analyze(_n, ticker, erp):
    if not ticker:
        raise PreventUpdate
    try:
        inp = V.get_valuation_inputs(ticker)
        rf = V.risk_free_rate()
    except StockError as exc:
        return no_update, str(exc), *(no_update,) * 6
    except Exception as exc:  # network etc.
        return no_update, f"Could not analyze {ticker}: {exc}", *(no_update,) * 6

    beta = inp.get("beta") or 1.0
    re = VAL.cost_of_equity(rf, beta, (erp or _DEFAULT_ERP) / 100)
    # WACC from CAPM r_e + the actual capital structure (pairing rule §1.2).
    wacc = VAL.wacc(re, rf, inp.get("price"), inp.get("shares"),
                    inp.get("debt"), inp.get("tax_rate")) or re
    # Stage-1 growth: analyst earnings growth, clamped to a sane 3–25%.
    g1 = inp.get("eps_growth") or inp.get("rev_growth") or 0.08
    g1 = max(0.03, min(0.25, g1)) * 100
    msg = f"{inp['name']} · {inp['sector']} · {inp['currency']} {inp['price']:,.2f}"
    return inp, msg, round(re * 100, 1), round(wacc * 100, 1), \
        round(rf * 100, 2), round(beta, 2), round(g1, 1), round(g1 / 2, 1)


# ── Render everything from the store + assumptions ────────────────────────────

@callback(
    Output("val-main", "style"),
    Output("val-gauge", "figure"),
    Output("val-methods-bar", "figure"),
    Output("val-dcf", "figure"),
    Output("val-scenarios", "figure"),
    Output("val-sensitivity", "figure"),
    Output("val-methods", "children"),
    Input("val-store", "data"),
    Input("val-recalc", "n_clicks"),
    Input("theme-store", "data"),
    State("val-r", "value"), State("val-wacc", "value"), State("val-rf", "value"),
    State("val-g1", "value"), State("val-g2", "value"), State("val-gt", "value"),
)
def _render(inp, _recalc, theme_value, r, wacc, rf, g1, g2, gt):
    if not inp:
        raise PreventUpdate
    dark = theme.is_dark(theme_value)
    cur = inp.get("currency", "USD")
    price = inp.get("price")
    a = _assumptions({"r": r, "wacc": wacc, "rf": rf, "g1": g1, "g2": g2, "gT": gt})

    results, dcf, extras = VAL.run_all(inp, a)
    scen = VAL.scenarios(inp, a)
    disc = a["wacc"] or a["r"]                    # the DCF's own discount rate
    r_vals = [round(disc + d, 4) for d in (-0.02, -0.01, 0, 0.01, 0.02)]
    gt_vals = [round(a["gT"] + d, 4) for d in (-0.01, -0.005, 0, 0.005, 0.01)]
    grid = VAL.sensitivity_grid(inp, a, r_vals, gt_vals)

    dcf_fair = next((r_["fair"] for r_ in results if r_["key"] == "dcf"), None)
    return (
        {"display": "flex", "alignItems": "flex-start", "marginTop": "16px"},
        build_valuation_gauge(dcf_fair, price, cur, dark),
        build_methods_bar(results, price, cur, dark),
        build_dcf_breakdown(dcf, cur, dark),
        build_scenarios_bar(scen, price, cur, dark),
        build_sensitivity_heatmap(grid, r_vals, gt_vals, price, cur, dark),
        html.Div([_methods_table(results), _extras_block(extras), _caveats_block()]),
    )


def _extras_block(extras: dict) -> html.Div:
    """Reverse-DCF implied growth + the 'all terminal value' guardrail warning."""
    lines = []
    ig = extras.get("implied_g1")
    if ig is not None:
        lines.append(html.Div(
            ["Reverse DCF: the market price implies ",
             html.Span(f"~{ig * 100:.1f}%/yr", style={"fontWeight": 700}),
             " stage-1 FCF growth. Believable for this business?"],
            style={"fontSize": "13px", "marginTop": "10px"}))
    tv = extras.get("tv_share")
    if tv is not None and tv > 0.85:
        lines.append(html.Div(
            f"⚠ {tv * 100:.0f}% of the DCF value sits in the terminal value — "
            "the number is almost all far-future assumption. Trust it less.",
            className="amt-expense", style={"fontSize": "13px", "marginTop": "6px"}))
    return html.Div(lines)


# Why the models disagree — honest per-model caveats (formula sheet §2/§4/§6).
_CAVEATS = [
    ("Why the numbers differ",
     "Each model prices a different thing: discounted cash flows (DCF), the dividend "
     "stream (DDM), book value plus excess returns (RI), a payout-justified multiple "
     "(P/E), a 1974 heuristic (Graham), and zero-growth earnings power (EPV). "
     "Dispersion is information, not error: a wide spread means high uncertainty. "
     "Read the median of the models that fit the company (see Notes), never one number."),
    ("Two-stage DCF",
     "Very sensitive to inputs: ±1% on WACC or terminal growth can move fair value "
     "20–40%. FCF here is CFO − CapEx (retail convention) — it is post-interest, so "
     "bridging −debt at WACC slightly double-counts debt. Not for banks or cyclicals."),
    ("Dividend Discount (H-model)",
     "Growth fades linearly from g1 to g_T over ~10 years. Only meaningful for "
     "steady payers; meaningless when the dividend is token or absent."),
    ("Residual Income",
     "Assumes clean book value; buybacks shrink book equity and inflate ROE, making "
     "this unreliable for heavy repurchasers (common in US mega-caps). ROE fades to "
     "r_e over 10 years — conservative by construction."),
    ("Justified P/E",
     "Gordon algebra on payout & sustainable growth (ROE × retention). Undefined for "
     "non-payers and for firms whose sustainable growth exceeds r_e — that is honest, "
     "not a bug."),
    ("Graham formula",
     "A 1974 rule of thumb; Graham himself warned against formula valuation. Growth "
     "capped at 15; AAA bond yield approximated as r_f + 1%. Sanity check only."),
    ("Earnings Power Value",
     "A deliberate floor: assumes zero growth forever and that current EBIT is "
     "mid-cycle 'normal'. Below-EPV prices suggest the market expects decline."),
]


def _caveats_block() -> html.Details:
    items = [html.Div([html.Span(t + " — ", style={"fontWeight": 600}), body],
                      style={"margin": "6px 0", "fontSize": "12.5px",
                             "color": theme.MUTED, "lineHeight": "1.5"})
             for t, body in _CAVEATS]
    return html.Details(
        [html.Summary("Model caveats — why the numbers differ",
                      style={"cursor": "pointer", "fontWeight": 600,
                             "fontSize": "13px", "marginTop": "12px"}), *items],
    )


def _methods_table(results) -> html.Table:
    header = html.Tr([html.Th("Method"), html.Th("Fair"), html.Th("MoS"),
                      html.Th("Notes")])
    rows = []
    for r in results:
        fair = f"{r['fair']:,.0f}" if r["fair"] is not None else "n/a"
        if r["mos"] is None:
            mos, cls = "—", ""
        else:
            mos = f"{r['mos'] * 100:+.0f}%"
            cls = "amt-income" if r["mos"] >= 0 else "amt-expense"
        rows.append(html.Tr([
            html.Td(r["name"]), html.Td(fair), html.Td(mos, className=cls),
            html.Td(r["note"], style={"fontSize": "12px", "color": theme.MUTED,
                                      "textAlign": "left", "whiteSpace": "normal"}),
        ]))
    return html.Table([html.Thead(header), html.Tbody(rows)],
                      className="invest-table val-methods-table")
