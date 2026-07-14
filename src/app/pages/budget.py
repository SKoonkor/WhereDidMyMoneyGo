"""Budget page — plan spending with the 50/30/20 rule.

Three cards: income/percentage/reset settings, a Needs/Wants assignment grid for
expense categories, and a live summary of this period's budget (spent vs target
vs remaining). Savings/Debt is the leftover (income − Needs − Wants), so it has
no category mapping.
"""

from datetime import date

import dash
import pandas as pd
from dash import dcc, html, callback, Input, Output, State, ctx, no_update
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card, money_span
from src.app.data import get_df, currency
from src.app.figures.budget_pie import build_budget_pie
from src.app.figures.budget_trend import build_spending_trend
from src.analytics import budget as B
from src.analytics.transaction_categories import load_categories

_PIE_CONFIG = {"displayModeBar": False}
_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"]


def _month_label(period: pd.Period) -> str:
    return f"{_MONTHS[period.month - 1]} {period.year}"

dash.register_page(__name__, path="/budget", name="Budget", order=5)

_BUCKET_CLASS = {B.NEEDS: "amt-income", B.WANTS: "amt-expense", B.SAVINGS: "amt-transfer"}


def _fmt(v: float) -> str:
    return f"{v:,.0f}"


# ── Settings card ─────────────────────────────────────────────────────────────

def _settings_card(cfg: dict) -> html.Div:
    pct = cfg.get("percentages", B.DEFAULT_PERCENTAGES)
    return card(
        [
            html.H3("Settings", style={"marginTop": 0}),
            html.Label("Income basis", style={"color": theme.MUTED, "fontSize": "13px"}),
            dcc.RadioItems(
                id="budget-mode",
                options=[{"label": " Fixed monthly amount", "value": "fixed"},
                         {"label": " Rolling 6-month average", "value": "rolling"}],
                value=cfg.get("mode", "fixed"),
                style={"margin": "6px 0 14px"},
                labelStyle={"display": "inline-block", "marginRight": "18px"},
            ),
            html.Div(
                [
                    html.Label("Fixed monthly income", style={"color": theme.MUTED,
                                                              "fontSize": "13px"}),
                    dcc.Input(id="budget-fixed", type="number",
                              value=cfg.get("fixed_income", 0),
                              style={**theme.INPUT_STYLE, "marginTop": "4px"}),
                ],
                id="budget-fixed-wrap", className="money-input",
                style={"marginBottom": "10px",
                       "display": "block" if cfg.get("mode") != "rolling" else "none"},
            ),
            html.Label("Split (%)", style={"color": theme.MUTED, "fontSize": "13px"}),
            html.Div(
                [
                    _pct_input("budget-pct-needs", "Needs", pct.get(B.NEEDS, 50)),
                    _pct_input("budget-pct-wants", "Wants", pct.get(B.WANTS, 30)),
                    _pct_input("budget-pct-savings", "Savings", pct.get(B.SAVINGS, 20)),
                    html.Span(id="budget-pct-hint", style={"alignSelf": "flex-end",
                                                           "paddingBottom": "10px",
                                                           "fontSize": "13px"}),
                ],
                style={"display": "flex", "gap": "14px", "alignItems": "center",
                       "margin": "6px 0 12px"},
            ),
            html.Div(
                [
                    html.Label("Reset day of month", style={"color": theme.MUTED,
                                                            "fontSize": "13px"}),
                    dcc.Input(id="budget-reset-day", type="number", min=1, max=31,
                              value=cfg.get("reset_day", 1),
                              style={**theme.INPUT_STYLE, "marginTop": "4px",
                                     "width": "90px"}),
                ],
                style={"marginBottom": "12px"},
            ),
            html.Div(
                [
                    html.Button("Save settings", id="budget-save-settings",
                                n_clicks=0, style=theme.BUTTON_STYLE),
                    html.Span(id="budget-settings-msg",
                              style={"alignSelf": "center", "fontSize": "14px"}),
                ],
                style={"display": "flex", "gap": "14px", "alignItems": "center"},
            ),
        ],
        style={"maxWidth": "560px"},
    )


def _pct_input(id_: str, label: str, value) -> html.Div:
    return html.Div(
        [
            html.Div(label, style={"fontSize": "12px", "color": theme.MUTED}),
            dcc.Input(id=id_, type="number", min=0, max=100, value=value,
                      style={**theme.INPUT_STYLE, "width": "80px", "marginBottom": 0,
                             "marginTop": "4px"}),
        ],
    )


# ── Assignment card ──────────────────────────────────────────────────────────

def _chip(cat: str, pct: float) -> html.Div:
    return html.Div(
        [
            html.Span(cat, className="budget-chip-name"),
            html.Span(f"{pct:.1f}%", className="budget-chip-pct"),
        ],
        className="budget-chip", **{"data-cat": cat},
    )


def _board_children(assignments: dict) -> tuple[list, list, float, float]:
    """Build the Needs/Wants chip lists (and their summed budget shares).

    Each chip shows the category's share of the period budget
    (category spend ÷ income base). Returns ``(needs, wants, needs_sum,
    wants_sum)`` where the sums are the bucket totals as a % of the budget
    (hidden cost counted toward Wants). Used by both the initial layout and the
    store-driven render callback.
    """
    df = get_df()
    cfg = B.load_budget()
    income = B.budget_income(df, cfg)
    start, end = B.budget_period(date.today(), int(cfg.get("reset_day", 1)))
    spend = B.spending_by_category(df, start, end)

    needs_cats, wants_cats = [], []
    for cat in load_categories().get("expense", {}).keys():
        pct = (spend.get(cat, 0.0) / income * 100) if income else 0.0
        bucket = needs_cats if B.bucket_for(cat, assignments) == B.NEEDS else wants_cats
        bucket.append((cat, pct))

    # Highest percentage first in each bucket.
    needs_cats.sort(key=lambda cp: cp[1], reverse=True)
    wants_cats.sort(key=lambda cp: cp[1], reverse=True)
    needs = [_chip(cat, pct) for cat, pct in needs_cats]
    wants = [_chip(cat, pct) for cat, pct in wants_cats]
    needs_sum = sum(pct for _, pct in needs_cats)
    wants_sum = sum(pct for _, pct in wants_cats)

    # Hidden cost is a fixed Wants item: it counts against the budget but is a
    # reconciliation artefact, so it's locked to Wants (can't move to Needs) and
    # never persisted to the assignments config.
    hidden = B.hidden_cost_in(df, start, end)
    h_pct = (hidden / income * 100) if income else 0.0
    wants_sum += h_pct
    wants.append(html.Div(
        [
            html.Span(B.HIDDEN_LABEL, className="budget-chip-name"),
            html.Span(f"{h_pct:.1f}%", className="budget-chip-pct"),
        ],
        className="budget-chip locked",
        **{"data-cat": "__hidden__", "data-locked": "1"},
    ))
    return needs, wants, needs_sum, wants_sum


def _bucket_pct_header(actual: float, split: float) -> list:
    """Bucket header content: actual % (red when over split) ` / <split>%`."""
    return [
        html.Span(f"{actual:.1f}%",
                  style={"color": theme.EXPENSE_COLOR} if actual > split else {}),
        f" / {split:.0f}%",
    ]


def _column_shell(bucket: str, split, actual: float, list_id: str, pct_id: str,
                  children: list) -> html.Div:
    return html.Div(
        [
            html.Div(
                [html.Span(bucket),
                 html.Span(_bucket_pct_header(actual, split), id=pct_id,
                           className="budget-col-pct")],
                className="budget-col-head",
            ),
            html.Div(children, id=list_id, className="budget-chip-list"),
        ],
        className="budget-col", **{"data-bucket": bucket},
    )


def _assignment_card(cfg: dict) -> html.Div:
    assignments = cfg.get("assignments", {})
    pct = cfg.get("percentages", B.DEFAULT_PERCENTAGES)
    needs, wants, needs_sum, wants_sum = _board_children(assignments)

    return card(
        [
            html.Div(
                [
                    html.H3("Category buckets", style={"marginTop": 0, "marginBottom": 0}),
                    html.Span(id="budget-assign-msg",
                              style={"fontSize": "13px", "color": theme.MUTED}),
                ],
                style={"display": "flex", "justifyContent": "space-between",
                       "alignItems": "baseline"},
            ),
            html.P("Drag a category between the buckets (or tap it to flip). "
                   "The figure is each category's share of the period budget. "
                   "Changes save automatically; Savings/Debt is whatever income is "
                   "left after Needs and Wants.",
                   style={"color": theme.MUTED, "marginTop": "4px", "fontSize": "13px"}),
            html.Div(
                [_column_shell(B.NEEDS, pct.get(B.NEEDS, 50), needs_sum,
                               "budget-needs-list", "budget-needs-pct", needs),
                 _column_shell(B.WANTS, pct.get(B.WANTS, 30), wants_sum,
                               "budget-wants-list", "budget-wants-pct", wants)],
                className="budget-cols",
            ),
        ],
    )


# ── Summary card ─────────────────────────────────────────────────────────────

def _summary_children(summary: dict) -> list:
    mode_txt = ("fixed" if summary["mode"] != "rolling" else "rolling 6-month average")
    head = html.P(
        [f"Period {summary['start'].strftime('%d %b')} – "
         f"{summary['end'].strftime('%d %b %Y')} · income base ",
         money_span(f"{_fmt(summary['income'])} {currency()}"),
         f" ({mode_txt})"],
        style={"color": theme.MUTED, "marginTop": 0, "fontSize": "13px"},
    )
    rows = [head]
    for name in (B.NEEDS, B.WANTS, B.SAVINGS):
        v = summary["buckets"][name]
        target, spent, remaining = v["target"], v["spent"], v["remaining"]
        raw = (spent / target * 100) if target else 0
        width = min(100, max(0, raw))
        tone = B.bucket_tone(name, spent, target)
        if name == B.SAVINGS:
            ahead = remaining >= 0
            e_amt, e_word = (_fmt(remaining), "ahead") if ahead \
                else (_fmt(-remaining), "short")
            note_cls = "amt-income" if ahead else "amt-expense"
        else:
            over = remaining < 0
            e_amt, e_word = (_fmt(-remaining), "over") if over \
                else (_fmt(remaining), "left")
            note_cls = "amt-expense" if over else ""
        emphasis = html.Span([money_span(e_amt), f" {e_word}"],
                             style={"fontSize": "18px"})
        note = [money_span(_fmt(spent)), " of ", money_span(_fmt(target)), " · ",
                emphasis]
        rows.append(html.Div(
            [
                html.Div(
                    [html.Span(name, style={"fontWeight": 600}),
                     html.Span(note, className=note_cls, style={"fontSize": "13px"})],
                    style={"display": "flex", "justifyContent": "space-between",
                           "marginBottom": "5px"},
                ),
                html.Div(html.Div(className=f"budget-bar-fill {tone}",
                                  style={"width": f"{width:.0f}%"}),
                         className="budget-bar"),
            ],
            style={"marginBottom": "14px"},
        ))
    return rows


def _summary_card_container() -> html.Div:
    return card(
        [
            html.H3("This period", style={"marginTop": 0}),
            html.Div(id="budget-summary"),
        ],
    )


# ── Spending pies (per month, as % of budget) ────────────────────────────────

def _overflow_list(items: list, budget: float) -> list:
    """Rows for categories that spilled past 100% of budget (over-budget months).
    Empty list when nothing overflowed."""
    if not items:
        return []
    rows = [html.Div("Over budget — not in pie",
                     style={"color": theme.MUTED, "fontSize": "12px",
                            "marginBottom": "6px"})]
    for label, amt, bucket in items:
        hidden = label == B.HIDDEN_LABEL
        accent = "hidden" if hidden else bucket.lower()  # needs | wants | hidden
        pct = (amt / budget * 100) if budget else 0
        rows.append(html.Div(
            [html.Span(label, style={"color": theme.MUTED}),
             html.Span([money_span(f"{amt:,.0f}"), f" ({pct:.0f}%)"],
                       style={"fontWeight": 600})],
            className=f"budget-overflow-row {accent}",
        ))
    return rows


def _render_month(month: pd.Period, dark: bool, censor: bool = False):
    """(figure, overflow-list children) for one calendar month."""
    df = get_df()
    cfg = B.load_budget()
    budget = B.budget_income(df, cfg)
    assignments = cfg.get("assignments", {})
    data = B.month_pie_data(df, month, budget, assignments)
    fig = build_budget_pie(data["pie"], data["remaining"], data["total"],
                           budget, _month_label(month), currency(), dark=dark,
                           censor=censor)
    return fig, _overflow_list(data["list"], budget)


def _month_column(side: str, header, graph_id: str, list_id: str) -> html.Div:
    return html.Div(
        [
            header,
            html.Div(
                [
                    dcc.Graph(id=graph_id, style={"flex": "1.3", "minWidth": "200px",
                                                  "height": "240px"},
                              config=_PIE_CONFIG),
                    html.Div(id=list_id, className="budget-overflow",
                             style={"flex": "1", "minWidth": "150px"}),
                ],
                style={"display": "flex", "gap": "12px", "flexWrap": "wrap",
                       "alignItems": "center"},
            ),
        ],
        className="budget-month-col",
        style={"flex": "1", "minWidth": "300px"},
    )


def _spending_card(prev_options: list, prev_default: str, current_label: str) -> html.Div:
    prev_header = html.Div(
        [
            html.Span("Previous month", style={"fontWeight": 600,
                                               "marginRight": "10px"}),
            dcc.Dropdown(id="budget-prev-month", options=prev_options,
                         value=prev_default, clearable=False,
                         style={"width": "180px"}),
        ],
        style={"display": "flex", "alignItems": "center", "gap": "8px",
               "marginBottom": "8px", "minHeight": "38px"},
    )
    current_header = html.Div(
        html.Span(f"This month — {current_label}", style={"fontWeight": 600}),
        style={"display": "flex", "alignItems": "center",
               "marginBottom": "8px", "minHeight": "38px"},
    )
    return html.Div(card(
        [
            dcc.Store(id="budget-trend-sel", data=[]),
            html.H3("Spending vs budget", id="budget-spending-title",
                    style={"marginTop": 0}),
            html.P("Each slice is the category's share of that month's budget. "
                   "Needs (blue) fill the budget first, then Wants (orange); "
                   "anything over budget drops to the list. "
                   "Click a row below to see its monthly trend.",
                   id="budget-spending-desc",
                   style={"color": theme.MUTED, "marginTop": "4px", "fontSize": "13px"}),
            # Two monthly pies — shown until a category/sub-category row is clicked.
            html.Div(
                [
                    _month_column("prev", prev_header, "budget-pie-prev",
                                  "budget-list-prev"),
                    _month_column("current", current_header, "budget-pie-current",
                                  "budget-list-current"),
                ],
                id="budget-view-pies",
                style={"display": "flex", "gap": "20px", "flexWrap": "wrap",
                       "alignItems": "flex-start"},
            ),
            # Spending-trend histogram — replaces the pies while rows are selected.
            html.Div(
                [
                    html.Button("✕", id="budget-trend-close", className="trend-close",
                                n_clicks=0),
                    dcc.Graph(id="budget-trend-graph", style={"height": "300px"},
                              config={"scrollZoom": True, "displayModeBar": False,
                                      "displaylogo": False}),
                ],
                id="budget-view-trend",
                style={"display": "none", "position": "relative"},
            ),
            html.Details(
                [
                    html.Summary("Sub-category detail", className="subcat-summary"),
                    dcc.Store(id="budget-subcat-sort",
                              data={"by": "cur", "dir": "desc"}),
                    html.Div(
                        [
                            html.Span("Sub-category", className="subcat-name"),
                            html.Span(["This ", html.Span(id="budget-sort-this-arrow")],
                                      id="budget-sort-this", n_clicks=0,
                                      className="subcat-col subcat-sortable"),
                            html.Span("Prev", className="subcat-col"),
                            html.Span(["Change ",
                                       html.Span(id="budget-sort-change-arrow")],
                                      id="budget-sort-change", n_clicks=0,
                                      className="subcat-col change subcat-sortable"),
                        ],
                        className="subcat-row subcat-grid subcat-head",
                        style={"marginTop": "10px"},
                    ),
                    html.Div(id="budget-subcat-detail"),
                ],
                style={"marginTop": "16px"},
            ),
        ],
    ), className="budget-spending-card")


# ── Sub-category detail (this month vs selected previous month) ──────────────

def _delta_children(delta: float, pct) -> list:
    """Change-cell children: masked amount + kept percent (privacy-aware)."""
    if delta == 0:
        return [money_span("0")]
    amt = money_span(f"{delta:+,.0f}")
    if pct is None:
        return [amt, " (new)"]
    return [amt, f" ({pct:+.0f}%)"]


_NEW_COLOR = "#f39c12"  # orange for brand-new expenses (no previous month)


def _change_color(pct, delta) -> str:
    """Discrete: red for a positive change, green for a negative change, orange
    for a brand-new expense (no previous month), neutral when unchanged."""
    if pct is None:
        return _NEW_COLOR
    if delta > 0:
        return theme.EXPENSE_COLOR
    if delta < 0:
        return theme.INCOME_COLOR
    return theme.MUTED


def _pct_key(pct):
    return float("inf") if pct is None else pct


def _subcat_grid_row(name, cur, prev, delta, pct, cls: str,
                     cat=None, sub="", selected=None) -> html.Div:
    # Rows carry data-cat/data-sub and a click affordance so the trend JS can toggle
    # them into the Spending-trend view; the .selected class marks active ones.
    attrs = {}
    if cat is not None:
        cls += " subcat-clickable"
        if (cat, sub) in (selected or set()):
            cls += " selected"
        attrs = {"data-cat": cat, "data-sub": sub or ""}
    return html.Div(
        [html.Span(name, className="subcat-name"),
         money_span(f"{cur:,.0f}", className="subcat-col"),
         money_span(f"{prev:,.0f}", className="subcat-col"),
         html.Span(_delta_children(delta, pct), className="subcat-col change",
                   style={"color": _change_color(pct, delta), "fontWeight": 600})],
        className=cls, **attrs,
    )


def _subcat_detail_children(changes: list, sort: dict, selected=None) -> list:
    if not changes:
        return [html.Div("No expense data for these months.",
                         style={"color": theme.MUTED})]
    by = sort.get("by", "pct")
    reverse = sort.get("dir", "desc") == "desc"

    def _grp_pct(g):
        return (g["delta"] / g["prev"] * 100) if g["prev"] else None

    row_key = (lambda r: r["cur"]) if by == "cur" else (lambda r: _pct_key(r["pct"]))
    grp_key = (lambda g: g["cur"]) if by == "cur" else (lambda g: _pct_key(_grp_pct(g)))

    out = []
    for g in sorted(changes, key=grp_key, reverse=reverse):
        out.append(_subcat_grid_row(g["category"], g["cur"], g["prev"], g["delta"],
                                    _grp_pct(g), "subcat-group subcat-grid",
                                    cat=g["category"], sub="", selected=selected))
        for r in sorted(g["rows"], key=row_key, reverse=reverse):
            out.append(_subcat_grid_row(r["sub"], r["cur"], r["prev"], r["delta"],
                                        r["pct"], "subcat-row subcat-grid",
                                        cat=g["category"], sub=r["sub"],
                                        selected=selected))
    return out


# ── Layout ───────────────────────────────────────────────────────────────────

def _prev_month_options(df) -> tuple[list, str]:
    """Dropdown options for previous months present in the data (excluding the
    current calendar month), newest first; default = the latest of those."""
    cur = pd.Period(date.today(), freq="M")
    months = sorted(df["Period"].dt.to_period("M").unique())
    prev = [m for m in months if m < cur]
    options = [{"label": _month_label(m), "value": str(m)} for m in reversed(prev)]
    default = str(prev[-1]) if prev else str(cur - 1)
    return options, default


def layout(**_):
    cfg = B.load_budget()
    prev_options, prev_default = _prev_month_options(get_df())
    current_label = _month_label(pd.Period(date.today(), freq="M"))
    return html.Div(
        [
            page_header("Budget", "Plan your spending with the 50/30/20 rule."),
            dcc.Store(id="budget-refresh", data=0),
            dcc.Store(id="budget-assign-store", data=cfg.get("assignments", {})),
            html.Div(
                [
                    html.Div(
                        [_summary_card_container(), _settings_card(cfg),
                         _assignment_card(cfg)],
                        style={"display": "flex", "flexDirection": "column",
                               "gap": "16px", "flex": "1", "minWidth": "320px"},
                    ),
                    html.Div(
                        [_spending_card(prev_options, prev_default, current_label)],
                        style={"display": "flex", "flexDirection": "column",
                               "gap": "16px", "flex": "1.55", "minWidth": "460px"},
                    ),
                ],
                style={"display": "flex", "gap": "20px", "flexWrap": "wrap",
                       "alignItems": "flex-start", "marginTop": "16px"},
            ),
        ],
        style=theme.PAGE_STYLE,
    )


# ── Callbacks ────────────────────────────────────────────────────────────────

@callback(
    Output("budget-fixed-wrap", "style"),
    Input("budget-mode", "value"),
)
def _toggle_fixed(mode):
    return {"marginBottom": "10px",
            "display": "block" if mode != "rolling" else "none"}


@callback(
    Output("budget-pct-hint", "children"),
    Output("budget-pct-hint", "className"),
    Input("budget-pct-needs", "value"),
    Input("budget-pct-wants", "value"),
    Input("budget-pct-savings", "value"),
)
def _pct_hint(n, w, s):
    total = (n or 0) + (w or 0) + (s or 0)
    if total == 100:
        return f"= {total}% ✓", "amt-income"
    return f"= {total}% (should be 100)", "amt-expense"


@callback(
    Output("budget-settings-msg", "children"),
    Output("budget-settings-msg", "style"),
    Output("budget-refresh", "data", allow_duplicate=True),
    Input("budget-save-settings", "n_clicks"),
    State("budget-mode", "value"),
    State("budget-fixed", "value"),
    State("budget-pct-needs", "value"),
    State("budget-pct-wants", "value"),
    State("budget-pct-savings", "value"),
    State("budget-reset-day", "value"),
    State("budget-refresh", "data"),
    prevent_initial_call=True,
)
def _save_settings(n_clicks, mode, fixed, n, w, s, reset_day, refresh):
    if not n_clicks:
        raise PreventUpdate
    cfg = B.load_budget()
    cfg["mode"] = mode or "fixed"
    cfg["fixed_income"] = float(fixed or 0)
    cfg["percentages"] = {B.NEEDS: n or 0, B.WANTS: w or 0, B.SAVINGS: s or 0}
    cfg["reset_day"] = int(min(31, max(1, reset_day or 1)))
    B.save_budget(cfg)
    total = (n or 0) + (w or 0) + (s or 0)
    style = {"alignSelf": "center", "fontSize": "14px", "color": theme.ACCENT}
    msg = "Saved." + ("" if total == 100 else f" (note: split is {total}%, not 100%)")
    return msg, style, (refresh or 0) + 1


@callback(
    Output("budget-assign-msg", "children"),
    Output("budget-assign-msg", "style"),
    Output("budget-refresh", "data", allow_duplicate=True),
    Input("budget-assign-store", "data"),
    State("budget-refresh", "data"),
    prevent_initial_call=True,
)
def _save_assign(assignments, refresh):
    # The drag-and-drop JS (assets/budget_dnd.js) writes the full {cat: bucket}
    # map into budget-assign-store after every move; persist and refresh.
    if not assignments:
        raise PreventUpdate
    cfg = B.load_budget()
    cfg["assignments"] = {cat: (bucket or B.WANTS)
                          for cat, bucket in assignments.items()}
    B.save_budget(cfg)
    style = {"fontSize": "13px", "color": theme.ACCENT}
    return "Saved ✓", style, (refresh or 0) + 1


@callback(
    Output("budget-needs-list", "children"),
    Output("budget-wants-list", "children"),
    Output("budget-needs-pct", "children"),
    Output("budget-wants-pct", "children"),
    Input("budget-assign-store", "data"),
    Input("budget-refresh", "data"),
)
def _render_board(assignments, _refresh):
    # Store is the single source of truth for which bucket a category sits in
    # (the drag JS updates it). budget-refresh is bumped on "Save settings", so
    # listening to it too re-computes the per-chip percentages and the bucket
    # header sums when the income basis (fixed/rolling) or split changes.
    needs, wants, needs_sum, wants_sum = _board_children(assignments or {})
    pct = B.load_budget().get("percentages", B.DEFAULT_PERCENTAGES)
    return (needs, wants,
            _bucket_pct_header(needs_sum, pct.get(B.NEEDS, 50)),
            _bucket_pct_header(wants_sum, pct.get(B.WANTS, 30)))


@callback(
    Output("budget-summary", "children"),
    Input("budget-refresh", "data"),
)
def _render_summary(_refresh):
    return _summary_children(B.budget_summary(get_df()))


@callback(
    Output("budget-pie-current", "figure"),
    Output("budget-list-current", "children"),
    Input("theme-store", "data"),
    Input("budget-refresh", "data"),
    Input("censor-store", "data"),
)
def _render_current_pie(theme_value, _refresh, censor):
    month = pd.Period(date.today(), freq="M")
    return _render_month(month, theme.is_dark(theme_value),
                         theme.is_censored(censor))


@callback(
    Output("budget-pie-prev", "figure"),
    Output("budget-list-prev", "children"),
    Input("budget-prev-month", "value"),
    Input("theme-store", "data"),
    Input("budget-refresh", "data"),
    Input("censor-store", "data"),
)
def _render_prev_pie(month_value, theme_value, _refresh, censor):
    month = pd.Period(month_value, freq="M") if month_value \
        else pd.Period(date.today(), freq="M") - 1
    return _render_month(month, theme.is_dark(theme_value),
                         theme.is_censored(censor))


@callback(
    Output("budget-subcat-sort", "data"),
    Input("budget-sort-this", "n_clicks"),
    Input("budget-sort-change", "n_clicks"),
    State("budget-subcat-sort", "data"),
    prevent_initial_call=True,
)
def _toggle_sort(_n_this, _n_change, sort):
    sort = sort or {"by": "cur", "dir": "desc"}
    col = "cur" if ctx.triggered_id == "budget-sort-this" else "pct"
    if sort.get("by") == col:
        return {"by": col, "dir": "asc" if sort.get("dir") == "desc" else "desc"}
    return {"by": col, "dir": "desc"}


def _sel_set(sel) -> set:
    """The selection store (list of {cat, sub}) as a set of (cat, sub) tuples."""
    return {(item.get("cat"), item.get("sub") or "") for item in (sel or [])}


@callback(
    Output("budget-subcat-detail", "children"),
    Output("budget-sort-this-arrow", "children"),
    Output("budget-sort-change-arrow", "children"),
    Input("budget-prev-month", "value"),
    Input("budget-subcat-sort", "data"),
    Input("budget-refresh", "data"),
    Input("budget-trend-sel", "data"),
)
def _render_subcat_detail(prev_value, sort, _refresh, sel):
    current = pd.Period(date.today(), freq="M")
    prev = pd.Period(prev_value, freq="M") if prev_value else current - 1
    changes = B.subcategory_month_changes(get_df(), current, prev)
    sort = sort or {"by": "cur", "dir": "desc"}
    rows = _subcat_detail_children(changes, sort, _sel_set(sel))
    arrow = "▾" if sort["dir"] == "desc" else "▴"
    this_arrow = arrow if sort["by"] == "cur" else ""
    change_arrow = arrow if sort["by"] == "pct" else ""
    return rows, this_arrow, change_arrow


# ── Spending-trend view (click-to-drill) ─────────────────────────────────────

_PIES_STYLE = {"display": "flex", "gap": "20px", "flexWrap": "wrap",
               "alignItems": "flex-start"}
_DESC_STYLE = {"color": theme.MUTED, "marginTop": "4px", "fontSize": "13px"}


@callback(
    Output("budget-spending-title", "children"),
    Output("budget-spending-desc", "style"),
    Output("budget-view-pies", "style"),
    Output("budget-view-trend", "style"),
    Output("budget-trend-graph", "figure"),
    Input("budget-trend-sel", "data"),
    Input("theme-store", "data"),
    Input("censor-store", "data"),
    Input("budget-refresh", "data"),
)
def _render_trend(sel, theme_value, censor, _refresh):
    if not sel:
        # No selection → the pies (and the default title) are shown.
        return ("Spending vs budget", _DESC_STYLE, _PIES_STYLE,
                {"display": "none"}, no_update)

    df = get_df()
    series, labels = [], []
    for item in sel:
        cat = item.get("cat")
        sub = item.get("sub") or None            # "" (group row) → whole category
        label = f"{cat}:{sub}" if sub else cat
        labels.append(label)
        ser = B.monthly_category_series(df, cat, sub)
        series.append({"label": label, "months": [m for m, _ in ser],
                       "values": [v for _, v in ser]})

    title = f"Spending trend: {labels[0]}" if len(labels) == 1 else "Spending Trend"
    fig = build_spending_trend(series, currency(), dark=theme.is_dark(theme_value),
                               censor=theme.is_censored(censor))
    return (title, {"display": "none"}, {"display": "none"},
            {"display": "block", "position": "relative"}, fig)
