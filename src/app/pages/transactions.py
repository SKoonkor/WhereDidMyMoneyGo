"""Transaction tracking — monthly summary page (slides 8–9).

Day-grouped list of one month's transactions. Transfer pairs are shown once
(as a single neutral "From → To" row) and excluded from the income/expense
totals. Every row links to its edit page; the floating button adds a new one.
"""

from datetime import date

import dash
import pandas as pd
from dash import dcc, html, callback, ctx, Input, Output, State, no_update

from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, money_span
from src.app.data import get_df
from src.io.exporter import export_frame, export_filename

dash.register_page(__name__, path="/transactions", name="Transactions", order=6)

_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"]
_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _month_str(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _valid_month(value) -> str | None:
    if not value:
        return None
    try:
        period = pd.Period(value, freq="M")
    except (ValueError, TypeError):
        return None
    # pd.Period(<bad>) can yield NaT instead of raising.
    return None if pd.isna(period) else str(period)


def layout(month=None, **_):
    df = get_df()
    years = list(range(int(df["Period"].dt.year.min()), date.today().year + 2))
    # `month` (?month=YYYY-MM) lets add/edit navigation return to the month the
    # user came from; default to the current month.
    initial_month = _valid_month(month) or _month_str(date.today())
    return html.Div(
        [
            page_header("Transactions", "Your monthly transaction record."),
            dcc.Store(id="txn-month", data=initial_month),
            html.Div(
                [
                    html.Button("‹", id="txn-prev", n_clicks=0, className="nav-btn"),
                    html.Button(id="txn-month-label", n_clicks=0, className="month-label"),
                    html.Button("›", id="txn-next", n_clicks=0, className="nav-btn"),
                    html.Button("Today", id="txn-today", n_clicks=0, className="nav-btn today"),
                    html.Div(
                        [
                            dcc.Dropdown(id="txn-pick-month", clearable=False,
                                         options=[{"label": m, "value": i + 1}
                                                  for i, m in enumerate(_MONTHS)],
                                         style={"width": "150px"}),
                            dcc.Dropdown(id="txn-pick-year", clearable=False,
                                         options=years, style={"width": "110px"}),
                            html.Button("Go", id="txn-pick-go", n_clicks=0,
                                        style=theme.BUTTON_STYLE),
                        ],
                        id="txn-month-picker",
                        style={"display": "none"},
                    ),
                    html.Button("⬇ Export", id="txn-export", n_clicks=0,
                                className="nav-btn today",
                                title="Download your transactions"),
                    dcc.Link("⬆ Import", href="/import", className="nav-btn today",
                             title="Import transactions from another app",
                             style={"textDecoration": "none"}),
                    html.Div(
                        [
                            html.Button("This month · CSV", id="txn-exp-csv-month",
                                        n_clicks=0, style=theme.BUTTON_STYLE),
                            html.Button("This month · Excel", id="txn-exp-xlsx-month",
                                        n_clicks=0, style=theme.BUTTON_STYLE),
                            html.Button("Everything · CSV", id="txn-exp-csv-all",
                                        n_clicks=0, style=theme.BUTTON_STYLE),
                            html.Button("Everything · Excel", id="txn-exp-xlsx-all",
                                        n_clicks=0, style=theme.BUTTON_STYLE),
                        ],
                        id="txn-export-menu",
                        style={"display": "none"},
                    ),
                    dcc.Download(id="txn-export-dl"),
                ],
                className="txn-month-nav",
            ),
            html.Div(id="txn-summary-strip", className="txn-summary-strip"),
            html.Div(id="txn-list", className="txn-list"),
            dcc.Link("+ Add", id="txn-fab", href="/transactions/add",
                     className="txn-fab"),
        ],
        style=theme.PAGE_STYLE,
    )


@callback(
    Output("txn-month", "data"),
    Input("txn-prev", "n_clicks"),
    Input("txn-next", "n_clicks"),
    Input("txn-today", "n_clicks"),
    Input("txn-pick-go", "n_clicks"),
    State("txn-pick-month", "value"),
    State("txn-pick-year", "value"),
    State("txn-month", "data"),
    prevent_initial_call=True,
)
def _change_month(_p, _n, _t, _g, pick_month, pick_year, current):
    cur = pd.Period(current, freq="M")
    trigger = ctx.triggered_id
    if trigger == "txn-prev":
        cur = cur - 1
    elif trigger == "txn-next":
        cur = cur + 1
    elif trigger == "txn-today":
        cur = pd.Period(_month_str(date.today()), freq="M")
    elif trigger == "txn-pick-go" and pick_month and pick_year:
        cur = pd.Period(f"{pick_year:04d}-{pick_month:02d}", freq="M")
    else:
        return no_update
    return str(cur)


@callback(
    Output("txn-month-picker", "style"),
    Input("txn-month-label", "n_clicks"),
    Input("txn-pick-go", "n_clicks"),
    State("txn-month-picker", "style"),
    prevent_initial_call=True,
)
def _toggle_picker(_label, _go, style):
    if ctx.triggered_id == "txn-pick-go":
        return {"display": "none"}
    hidden = (style or {}).get("display") == "none"
    return {"display": "flex", "gap": "8px", "alignItems": "center"} if hidden \
        else {"display": "none"}


@callback(
    Output("txn-export-menu", "style"),
    Input("txn-export", "n_clicks"),
    Input("txn-exp-csv-month", "n_clicks"),
    Input("txn-exp-xlsx-month", "n_clicks"),
    Input("txn-exp-csv-all", "n_clicks"),
    Input("txn-exp-xlsx-all", "n_clicks"),
    State("txn-export-menu", "style"),
    prevent_initial_call=True,
)
def _toggle_export_menu(_e, _a, _b, _c, _d, style):
    # Any download choice closes the menu; the Export button toggles it.
    if ctx.triggered_id != "txn-export":
        return {"display": "none"}
    hidden = (style or {}).get("display") == "none"
    return {"display": "flex", "gap": "8px", "flexWrap": "wrap",
            "alignItems": "center"} if hidden else {"display": "none"}


@callback(
    Output("txn-export-dl", "data"),
    Input("txn-exp-csv-month", "n_clicks"),
    Input("txn-exp-xlsx-month", "n_clicks"),
    Input("txn-exp-csv-all", "n_clicks"),
    Input("txn-exp-xlsx-all", "n_clicks"),
    State("txn-month", "data"),
    prevent_initial_call=True,
)
def _export(_a, _b, _c, _d, month):
    trigger = ctx.triggered_id
    if not ctx.triggered[0]["value"]:
        raise PreventUpdate
    df = get_df()
    if trigger.endswith("-month"):
        period = pd.Period(month, freq="M")
        df = df[df["Period"].dt.to_period("M") == period]
        scope = str(period)
    else:
        scope = "all"
    frame = export_frame(df)
    if "-csv-" in trigger:
        # Explicit BOM so Excel opens non-ASCII (e.g. Thai) text correctly;
        # send_data_frame would route to_csv through a text buffer and drop it.
        payload = b"\xef\xbb\xbf" + frame.to_csv(index=False).encode("utf-8")
        return dcc.send_bytes(payload, export_filename(scope, "csv"))
    return dcc.send_data_frame(frame.to_excel, export_filename(scope, "xlsx"),
                               sheet_name="Transactions", index=False)


def _transfer_display_mask(month_df: pd.DataFrame) -> pd.Series:
    """True for rows to display: hides Transfer-In halves whose linked pair
    (shared TransferId) is present. Unlinked halves stay visible."""
    is_in = month_df["Income/Expense"] == "Transfer-In"
    out_links = set(month_df.loc[
        (month_df["Income/Expense"] == "Transfer-Out")
        & month_df["TransferId"].notna(), "TransferId"])
    hidden = is_in & month_df["TransferId"].notna() \
        & month_df["TransferId"].isin(out_links)
    return ~hidden


_ADJUSTMENT_TYPES = ("Adjustment-In", "Adjustment-Out")


def _amount_class(txn_type: str) -> str:
    if txn_type in ("Expense", "Adjustment-Out"):
        return "amt-expense"
    if txn_type in ("Income", "Adjustment-In"):
        return "amt-income"
    return "amt-transfer"


def _row(row):
    t = row["Income/Expense"]
    # Balance adjustments are reconciliation artifacts — show them as a neutral,
    # non-clickable info row (managed from the Reconcile page, not the editor).
    if t in _ADJUSTMENT_TYPES:
        sign = "+" if t == "Adjustment-In" else "−"
        return html.Div(
            [
                html.Div([html.Div("Hidden cost"), html.Div("untracked")],
                         className="txn-cat"),
                html.Div(["Balance adjustment",
                          html.Span(row["Account"], className="txn-account")],
                         className="txn-note"),
                money_span(f"{sign}{row['Amount']:,.2f}",
                           className=f"txn-amount {_amount_class(t)}"),
            ],
            className="txn-row txn-row-static",
        )
    if t in ("Transfer-Out", "Transfer-In"):
        cat_lines = ["Transfer"]
        if t == "Transfer-Out":
            account_txt = f"{row['Account']} → {row['Category']}"
        else:
            account_txt = f"{row['Category']} → {row['Account']}"
    else:
        cat_lines = [row["Category"]]
        if row["Subcategory"]:
            cat_lines.append(row["Subcategory"])
        account_txt = row["Account"]
    return dcc.Link(
        [
            html.Div([html.Div(c) for c in cat_lines], className="txn-cat"),
            html.Div([row["Note"] or "—",
                      html.Span(account_txt, className="txn-account")],
                     className="txn-note"),
            money_span(f"{row['Amount']:,.2f}",
                       className=f"txn-amount {_amount_class(t)}"),
        ],
        href=f"/transactions/edit/{row['Id']}",
        className="txn-row",
    )


def _summary_item(label: str, value: float, css: str) -> html.Div:
    return html.Div([
        html.Div(label, className="label"),
        money_span(f"{value:,.2f}", className=f"value {css}"),
    ])


@callback(
    Output("txn-month-label", "children"),
    Output("txn-summary-strip", "children"),
    Output("txn-list", "children"),
    Output("txn-pick-month", "value"),
    Output("txn-pick-year", "value"),
    Output("txn-fab", "href"),
    Input("txn-month", "data"),
)
def _render(month):
    period = pd.Period(month, freq="M")
    label = f"{_MONTHS[period.month - 1]} {period.year}"
    # Carry the viewed month so a generic "+ Add" returns here afterwards.
    fab_href = f"/transactions/add?month={month}"

    df = get_df()
    month_df = df[df["Period"].dt.to_period("M") == period]

    income = month_df.loc[month_df["Income/Expense"] == "Income", "Amount"].sum()
    expense = month_df.loc[month_df["Income/Expense"] == "Expense", "Amount"].sum()
    strip = [
        _summary_item("Income", income, "amt-income"),
        _summary_item("Expense", expense, "amt-expense"),
        _summary_item("Total", income - expense, ""),
    ]

    if month_df.empty:
        empty = html.P("No transactions this month.",
                       style={"color": theme.MUTED, "padding": "24px 4px"})
        return label, strip, empty, period.month, period.year, fab_href

    visible = month_df[_transfer_display_mask(month_df)]
    items = []
    for day, day_df in sorted(visible.groupby(visible["Period"].dt.normalize()),
                              key=lambda kv: kv[0], reverse=True):
        day_income = day_df.loc[day_df["Income/Expense"] == "Income", "Amount"].sum()
        day_expense = day_df.loc[day_df["Income/Expense"] == "Expense", "Amount"].sum()
        weekday = _WEEKDAYS[day.weekday()]
        badge_cls = {"Sat": "weekday-badge sat", "Sun": "weekday-badge sun"}.get(
            weekday, "weekday-badge")
        items.append(html.Div(
            [
                dcc.Link(
                    [
                        html.Span(f"{day.day:02d}", className="day-num"),
                        html.Span(weekday, className=badge_cls),
                    ],
                    href=f"/transactions/add?date={day.strftime('%Y-%m-%d')}",
                    className="day-link",
                    title="Add a transaction on this day",
                ),
                html.Div(
                    [money_span(f"{day_income:,.2f}", className="amt-income"),
                     money_span(f"{day_expense:,.2f}", className="amt-expense")],
                    className="day-totals",
                ),
            ],
            className="txn-day-header",
        ))
        day_sorted = day_df.sort_values("Period", ascending=False)
        items.extend(_row(row) for _, row in day_sorted.iterrows())

    return label, strip, items, period.month, period.year, fab_href
