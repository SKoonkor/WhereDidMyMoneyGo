"""Income Tax estimator page (Thailand). Sits just below Financial Goals.

Estimates the personal income tax owed for a calendar tax year: gross income
(prefilled from the ledger, editable) minus the automatic employment-expense
deduction and the itemized allowances, run through the progressive brackets. The
tracked "tax paid" subcategory (set in Settings) is summed for the year to show
how much is still owed or refundable.
"""

from __future__ import annotations

import datetime

import dash
from dash import dcc, html, callback, ctx, ALL, Input, Output, State
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header, card
from src.app.i18n import t
from src.app.data import get_df, currency, tax_config
from src.analytics.income_tax import (
    spec_for, allowance_defs, income_tax_status, gross_income_for_year,
    tax_paid_for_year, tax_payments_for_year, ledger_years, load_tax, save_tax,
    TH_ALLOWANCES)
from src.io.tax_report import build_report_html

dash.register_page(__name__, path="/income-tax", name="Income Tax", order=3.5)

_LABEL_STYLE = {"color": theme.MUTED, "fontSize": "13px"}
_ALLOW_BY_KEY = {a["key"]: a for a in TH_ALLOWANCES}


def _field(label, control, hint=None):
    children = [html.Label(label, style=_LABEL_STYLE), control]
    if hint:
        children.append(html.Div(hint, style={"color": theme.MUTED,
                                               "fontSize": "12px", "marginTop": "4px"}))
    return html.Div(children, style={"marginBottom": "14px"})


def _allowance_control(defn, saved):
    cid = {"type": "tax-allow", "key": defn["key"]}
    if defn["type"] == "flag":
        return dcc.Checklist(id=cid, options=[{"label": " " + t("Applies"), "value": "on"}],
                             value=(["on"] if saved else []),
                             inputStyle={"marginRight": "6px"},
                             style={"color": theme.INK})
    step = 1 if defn["type"] == "count" else 1000
    return dcc.Input(id=cid, type="number", min=0, step=step,
                     value=(saved if saved not in (None, False) else 0),
                     className="no-spin",
                     style={**theme.INPUT_STYLE, "marginBottom": 0, "width": "100%"})


def _allowance_boxes(saved_allow):
    """One equal-size box per non-fixed allowance (the grid on the right)."""
    boxes = []
    for a in allowance_defs():
        if a["type"] == "fixed":
            continue
        boxes.append(html.Div(
            [
                html.Div(t(a["label"]), className="tax-allow-box-label"),
                _allowance_control(a, saved_allow.get(a["key"])),
                html.Div(t(a.get("hint", "")), className="tax-allow-box-hint"),
                html.Div(id={"type": "tax-applied", "key": a["key"]},
                         className="tax-applied"),
            ],
            className="tax-allow-box"))
    return boxes


def _personal_field():
    """The fixed personal allowance, shown in the left column (always applies)."""
    a = next((x for x in allowance_defs() if x["type"] == "fixed"), None)
    if not a:
        return html.Div()
    return _field(t(a["label"]),
                  html.Div(f"{a['amount']:,.0f} {currency()}",
                           style={"marginTop": "4px", "color": theme.INK,
                                  "fontWeight": 600}),
                  hint=t(a.get("hint", "")))


def _default_year_gross():
    """Default tax year (current if the ledger has it, else the newest) and the
    gross income prefilled for it. Shared by the layout and the Reset callback."""
    df = get_df()
    years = ledger_years(df)
    cur_year = datetime.date.today().year
    default_year = cur_year if cur_year in years else years[0]
    return years, default_year, round(gross_income_for_year(df, default_year), 2)


def layout(**_):
    years, default_year, gross0 = _default_year_gross()
    saved = load_tax()
    subcat = tax_config().get("paid_subcategory")

    input_card = card(
        [
            html.H3(t("Your details"), style={"marginTop": 0, "color": theme.INK}),
            _field(t("Tax year"),
                   dcc.Dropdown(id="tax-year",
                                options=[{"label": str(y), "value": y} for y in years],
                                value=default_year, clearable=False,
                                style={"marginBottom": "4px"})),
            _field(t("Gross annual income"),
                   dcc.Input(id="tax-gross", type="number", min=0, step=0.01,
                             value=gross0, className="no-spin",
                             style={**theme.INPUT_STYLE, "marginTop": "4px",
                                    "width": "200px"}),
                   hint=t("Prefilled from your tracked income for the year — "
                          "edit if some of it isn't taxable.")),
            _personal_field(),
            html.Div(
                [
                    html.Button(t("CALCULATE"), id="tax-calc", n_clicks=0,
                                style={**theme.BUTTON_STYLE, "flex": "1"}),
                    html.Button(t("RESET"), id="tax-reset", n_clicks=0,
                                style={**theme.PERIOD_BUTTON_STYLE, "flex": "0 0 auto"}),
                ],
                style={"display": "flex", "gap": "10px"},
            ),
            html.Div(id="tax-results", style={"marginTop": "16px"}),
            html.Button(t("⬇ Export report"), id="tax-export", n_clicks=0,
                        style={**theme.PERIOD_BUTTON_STYLE, "width": "100%",
                               "marginTop": "12px"}),
            dcc.Download(id="tax-download"),
            dcc.Store(id="tax-status-store"),
        ],
        style={"flex": "0 0 320px"},
    )

    deductions_card = card(
        [
            html.H3(t("Deductions & allowances"),
                    style={"marginTop": 0, "color": theme.INK}),
            html.P(t("Enter what applies to you. Each is capped to its statutory "
                     "limit — after Calculate, every box shows how much actually "
                     "counts."),
                   style={"color": theme.MUTED, "fontSize": "13px", "marginTop": 0}),
            html.Div(_allowance_boxes(saved.get("allowances", {})),
                     id="tax-allow-grid", className="tax-allow-grid"),
        ],
        style={"flex": "1", "marginLeft": "20px"},
    )

    paid_modal = html.Div(
        html.Div(
            [html.H3(id="tax-paid-title", style={"color": theme.INK}),
             html.Div(id="tax-paid-list"),
             html.Button(t("Close"), id="tax-paid-close", n_clicks=0,
                         style={**theme.PERIOD_BUTTON_STYLE, "marginTop": "16px"})],
            className="modal-card"),
        id="tax-paid-modal", className="modal-overlay", style={"display": "none"},
        **{"data-close": "tax-paid-close"})

    return html.Div(
        [
            page_header("Income Tax",
                        "Estimate your Thailand personal income tax for the year. "
                        "Set your tax-payment subcategory in Settings."),
            html.Div([input_card, deductions_card],
                     style={"display": "flex", "alignItems": "flex-start"}),
            html.Div(id="tax-breakdown"),
            paid_modal,
        ],
        style=theme.PAGE_STYLE,
    )


# ── Results & breakdown rendering ────────────────────────────────────────────

def _result_row(label, value, strong=False):
    value_style = {"fontWeight": (700 if strong else 600),
                   "fontSize": ("18px" if strong else "14px"),
                   "color": theme.INK, "whiteSpace": "nowrap"}
    if strong:
        # Underline the headline figure (Tax due) to make it stand out.
        value_style.update({"textDecoration": "underline",
                            "textDecorationThickness": "2px",
                            "textUnderlineOffset": "3px"})
    return html.Div(
        [html.Span(label, style={"color": theme.MUTED}),
         html.Span(value, style=value_style)],
        style=theme.RESULT_ROW_STYLE,
    )


def _paid_row(status, subcat):
    """The 'Tax already paid' row — its amount is a clickable link that opens the
    per-month payments pop-up."""
    cur = currency()
    label = t("Tax already paid") + (f" · {subcat}" if subcat else "")
    amount = html.Span(
        f"{status['tax_paid']:,.0f} {cur}", id="tax-paid-open", n_clicks=0,
        title=t("See which months you paid tax"),
        style={"fontWeight": 600, "color": theme.ACCENT, "whiteSpace": "nowrap",
               "cursor": "pointer", "textDecoration": "underline",
               "textDecorationStyle": "dotted", "textUnderlineOffset": "3px"})
    return html.Div([html.Span(label, style={"color": theme.MUTED}), amount],
                    style=theme.RESULT_ROW_STYLE)


def _payment_rows(payments, cur):
    """Render the pop-up body: one 'DD-MMM-YYYY  X.XX CUR' line per payment."""
    if not payments:
        return html.Div(t("No tax payments recorded for this year."),
                        style={"color": theme.MUTED, "fontSize": "13px"})
    line = {"display": "flex", "justifyContent": "space-between", "gap": "16px",
            "padding": "7px 0", "borderBottom": "1px solid var(--border-soft)",
            "fontVariantNumeric": "tabular-nums"}
    items = [html.Div([html.Span(p["date"], style={"color": theme.MUTED}),
                       html.Span(f"{p['amount']:,.2f} {cur}",
                                 style={"color": theme.INK, "fontWeight": 600})],
                      style=line)
             for p in payments]
    total = sum(p["amount"] for p in payments)
    items.append(html.Div(
        [html.Span(t("Total"), style={"color": theme.INK}),
         html.Span(f"{total:,.2f} {cur}", style={"color": theme.INK})],
        style={**line, "borderBottom": "none", "fontWeight": 700,
               "marginTop": "2px"}))
    return html.Div(items)


def _results_block(status, subcat):
    cur = currency()
    money = lambda v: f"{v:,.0f} {cur}"
    rows = [
        _result_row(t("Gross income"), money(status["gross"])),
        _result_row(t("− Employment expense"), money(status["expense_deduction"])),
        _result_row(t("− Allowances"), money(status["allowance_total"])),
        _result_row(t("Net taxable income"), money(status["net_taxable"])),
        _result_row(t("Tax due"), money(status["tax_due"]), strong=True),
        _result_row(t("Effective rate"), f"{status['effective_rate']*100:.2f}%"),
        _result_row(t("Marginal rate"), f"{status['marginal_rate']*100:.0f}%"),
        _paid_row(status, subcat),
    ]
    rem = status["remaining"]
    if rem > 0:
        word, color = t("Still to pay"), theme.EXPENSE_COLOR
    elif rem < 0:
        word, color = t("Refund"), theme.INCOME_COLOR
    else:
        word, color = t("Settled"), theme.MUTED
    rows.append(html.Div(
        [html.Span(word, style={"color": theme.MUTED}),
         html.Span(money(abs(rem)),
                   style={"fontWeight": 700, "fontSize": "18px", "color": color,
                          "whiteSpace": "nowrap"})],
        style={**theme.RESULT_ROW_STYLE, "borderBottom": "none"}))
    return html.Div(rows, style={"marginTop": "12px"})


_TH_STYLE = {"padding": "8px 10px", "fontSize": "12px", "fontWeight": 600,
             "color": theme.MUTED, "borderBottom": "1px solid var(--border)"}
_TD_STYLE = {"padding": "8px 10px", "borderBottom": "1px solid var(--border-soft)"}


def _band_label(lo, hi):
    def k(v):
        if v == 0:
            return "0"
        return f"{v/1_000_000:g}M" if v >= 1_000_000 else f"{v/1000:g}k"
    return f"{k(lo)}+" if hi is None else f"{k(lo)}–{k(hi)}"


def _breakdown_card(status):
    cur = currency()
    money = lambda v: f"{v:,.0f} {cur}"

    rows = status.get("bracket_rows") or []
    if rows:
        head = html.Tr([html.Th(t("Band"), style={**_TH_STYLE, "textAlign": "left"}),
                        html.Th(t("Income in band"),
                                style={**_TH_STYLE, "textAlign": "right"}),
                        html.Th(t("Rate"), style={**_TH_STYLE, "textAlign": "right"}),
                        html.Th(t("Tax"), style={**_TH_STYLE, "textAlign": "right"})])
        body = []
        for r in rows:
            body.append(html.Tr([
                html.Td(_band_label(r["lower"], r["upper"]),
                        style={**_TD_STYLE, "textAlign": "left", "color": theme.INK}),
                html.Td(money(r["income_in_band"]),
                        style={**_TD_STYLE, "textAlign": "right"}),
                html.Td(f"{r['rate']*100:.0f}%",
                        style={**_TD_STYLE, "textAlign": "right"}),
                html.Td(money(r["tax"]),
                        style={**_TD_STYLE, "textAlign": "right", "fontWeight": 600,
                               "color": theme.INK}),
            ]))
        bracket_tbl = html.Table([html.Thead(head), html.Tbody(body)],
                                 style={"width": "100%", "borderCollapse": "collapse"})
    else:
        bracket_tbl = html.Div(t("No taxable income — no tax due."),
                               style={"color": theme.MUTED, "fontSize": "13px"})

    return card(
        [html.H3(t("Tax by bracket"), style={"marginTop": 0, "color": theme.INK}),
         bracket_tbl],
        style={"marginTop": "20px"},
    )


# ── Callbacks ────────────────────────────────────────────────────────────────

@callback(
    Output("tax-gross", "value"),
    Input("tax-year", "value"),
    prevent_initial_call=True,
)
def _prefill_gross(year):
    """Re-prefill gross income when the tax year changes."""
    if year is None:
        raise PreventUpdate
    return round(gross_income_for_year(get_df(), year), 2)


@callback(
    Output("tax-results", "children"),
    Output("tax-breakdown", "children"),
    Output({"type": "tax-applied", "key": ALL}, "children"),
    Output("tax-status-store", "data"),
    Input("tax-calc", "n_clicks"),
    State("tax-year", "value"),
    State("tax-gross", "value"),
    State({"type": "tax-allow", "key": ALL}, "value"),
    State({"type": "tax-allow", "key": ALL}, "id"),
)
def _calculate(_n, year, gross, allow_values, allow_ids):
    cfg = tax_config()
    spec = spec_for(cfg.get("country"))
    cur = currency()

    values = {}
    for cid, val in zip(allow_ids or [], allow_values or []):
        defn = _ALLOW_BY_KEY.get(cid.get("key"))
        if not defn:
            continue
        values[cid["key"]] = bool(val) if defn["type"] == "flag" else (val or 0)

    subcat = cfg.get("paid_subcategory")
    year = year or datetime.date.today().year
    paid = tax_paid_for_year(get_df(), subcat, year)
    status = income_tax_status(gross, values, spec, tax_paid=paid)

    # Remember the entered allowances (only on an explicit Calculate).
    if ctx.triggered_id == "tax-calc":
        save_tax({"country": spec.get("country", "Thailand"), "allowances": values})

    # Per-box "counts as" (the capped amount), aligned to the input id order — the
    # tax-applied output group sorts by the same key, so the lists line up.
    applied_by_key = {b["key"]: b["amount"]
                      for b in status["allowance_breakdown"]}
    applied = [(t("Counts: {v}").format(v=f"{applied_by_key.get(cid['key'], 0):,.0f} {cur}")
                if applied_by_key.get(cid["key"], 0) else "")
               for cid in (allow_ids or [])]

    # Snapshot for the export report + the per-month payments pop-up; everything
    # stays in sync with the on-screen result.
    payload = {"status": status, "year": year,
               "country": spec.get("country", "Thailand"), "currency": cur,
               "subcat": subcat,
               "payments": tax_payments_for_year(get_df(), subcat, year),
               "generated": datetime.date.today().isoformat()}

    return (_results_block(status, subcat), _breakdown_card(status),
            applied, payload)


@callback(
    Output("tax-year", "value"),
    Output("tax-gross", "value", allow_duplicate=True),
    Output({"type": "tax-allow", "key": ALL}, "value"),
    Output("tax-results", "children", allow_duplicate=True),
    Output("tax-breakdown", "children", allow_duplicate=True),
    Output({"type": "tax-applied", "key": ALL}, "children", allow_duplicate=True),
    Output("tax-status-store", "data", allow_duplicate=True),
    Input("tax-reset", "n_clicks"),
    State({"type": "tax-allow", "key": ALL}, "id"),
    prevent_initial_call=True,
)
def _reset(_n, allow_ids):
    """Clear the on-screen form and results; the saved tax.json is left intact."""
    _years, default_year, default_gross = _default_year_gross()
    # Reset each allowance input to its empty value: [] for a checkbox, 0 for a number.
    allow_values = []
    applied = []
    for cid in (allow_ids or []):
        defn = _ALLOW_BY_KEY.get(cid.get("key"))
        allow_values.append([] if (defn and defn["type"] == "flag") else 0)
        applied.append("")
    return (default_year, default_gross, allow_values,
            None, None, applied, None)


@callback(
    Output("tax-download", "data"),
    Input("tax-export", "n_clicks"),
    State("tax-status-store", "data"),
    prevent_initial_call=True,
)
def _export(_n, payload):
    """Download the last calculation as a self-contained HTML report."""
    if not payload or not payload.get("status"):
        raise PreventUpdate
    html_doc = build_report_html(payload)
    return dcc.send_string(html_doc, f"income_tax_{payload.get('year', '')}.html")


@callback(
    Output("tax-paid-modal", "style"),
    Output("tax-paid-list", "children"),
    Output("tax-paid-title", "children"),
    Input("tax-paid-open", "n_clicks"),
    State("tax-status-store", "data"),
    prevent_initial_call=True,
)
def _open_paid_modal(_n, payload):
    """Open the per-month payments pop-up. The 'tax-paid-open' span is recreated on
    every Calculate, so guard the phantom fire (n_clicks None/0 on recreation)."""
    if not ctx.triggered or not ctx.triggered[0]["value"]:
        raise PreventUpdate
    payload = payload or {}
    cur = payload.get("currency") or currency()
    year = payload.get("year")
    subcat = payload.get("subcat")
    title = t("Tax paid — {year}").format(year=year) + (f" · {subcat}" if subcat else "")
    return ({"display": "flex"},
            _payment_rows(payload.get("payments") or [], cur), title)


@callback(
    Output("tax-paid-modal", "style", allow_duplicate=True),
    Input("tax-paid-close", "n_clicks"),
    prevent_initial_call=True,
)
def _close_paid_modal(_n):
    return {"display": "none"}
