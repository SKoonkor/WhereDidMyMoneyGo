"""Remove Transactions — a dedicated, guarded page for bulk deletion by period.

Reached only from the red "Remove transactions" button on the Settings page
(behind a Danger-Zone confirmation), so it never sits inline where it could be
triggered by accident. Deletion runs through ``store.delete_period`` which backs
the ledger up first.
"""

from __future__ import annotations

import pandas as pd
import dash
from dash import dcc, html, callback, Input, Output, State
from dash.exceptions import PreventUpdate

from src.app import theme
from src.app.components import page_header
from src.app.i18n import t
from src.app.data import get_df, refresh
from src.io import store

dash.register_page(__name__, path="/remove", name="Remove Transactions", order=9)

_HINT = "Please select a transaction period for deletion."
_REVERSED = "Start date must be on or before the end date."

# Red delete button; dimmed + not-clickable while disabled.
_BTN = {**theme.BUTTON_STYLE, "background": theme.EXPENSE_COLOR, "color": "#fff",
        "marginTop": "14px"}
_BTN_OFF = {**_BTN, "opacity": 0.5, "cursor": "not-allowed"}
_BTN_ON = {**_BTN, "opacity": 1}


def _period_rows(start, end):
    """In-range transactions using the same inclusive bounds as delete_period."""
    df = get_df()
    lo = pd.Timestamp(start).normalize()
    hi = pd.Timestamp(end).normalize() + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    return df[(df["Period"] >= lo) & (df["Period"] <= hi)]


def layout(**_):
    return html.Div(
        [
            page_header(
                "Remove Transactions",
                "Permanently delete every transaction dated within a period. "
                "A backup is saved first, but this can't be undone here.",
                back=("Settings", "/settings"),
            ),
            html.Div(
                [
                    dcc.DatePickerRange(
                        id="rm-dates", display_format="DD/MM/YYYY",
                        start_date_placeholder_text=t("Start"),
                        end_date_placeholder_text=t("End"),
                        # No default dates — the user must choose a period.
                    ),
                    html.Div(t(_HINT), id="rm-hint",
                             style={"color": theme.MUTED, "fontSize": "13px",
                                    "marginTop": "10px"}),
                    html.Button(t("Delete transactions"), id="rm-delete-btn",
                                n_clicks=0, disabled=True, style=_BTN_OFF),
                    html.Div(id="rm-msg", style={"fontSize": "14px",
                                                 "marginTop": "14px"}),
                ],
                style={"maxWidth": "440px"},
            ),
            dcc.ConfirmDialog(id="rm-confirm"),
        ],
        style=theme.PAGE_STYLE,
    )


@callback(
    Output("rm-delete-btn", "disabled"),
    Output("rm-delete-btn", "style"),
    Output("rm-hint", "children"),
    Input("rm-dates", "start_date"),
    Input("rm-dates", "end_date"),
)
def _toggle(start, end):
    """Delete stays disabled until a valid range is chosen."""
    if start and end and start <= end:
        return False, _BTN_ON, ""
    hint = t(_REVERSED) if (start and end) else t(_HINT)
    return True, _BTN_OFF, hint


@callback(
    Output("rm-confirm", "message"),
    Output("rm-confirm", "displayed"),
    Output("rm-msg", "children"),
    Output("rm-msg", "style"),
    Input("rm-delete-btn", "n_clicks"),
    State("rm-dates", "start_date"),
    State("rm-dates", "end_date"),
    prevent_initial_call=True,
)
def _confirm(n, start, end):
    """Summarise what would be deleted and ask for a final confirmation."""
    muted = {"fontSize": "14px", "marginTop": "14px", "color": theme.MUTED}
    if not n or not (start and end and start <= end):
        raise PreventUpdate
    rng = _period_rows(start, end)
    if rng.empty:
        return "", False, t("No transactions in that period."), muted
    income = rng.loc[rng["Income/Expense"] == "Income", "Amount"].sum()
    expense = rng.loc[rng["Income/Expense"] == "Expense", "Amount"].sum()
    msg = (t("⚠ Permanently delete {n} transaction(s) dated {start} to {end}?").format(
               n=len(rng), start=start, end=end)
           + "\n\n"
           + t("Income rows total: {v}").format(v=f"{income:,.2f}") + "\n"
           + t("Expense rows total: {v}").format(v=f"{expense:,.2f}") + "\n\n"
           + t("A backup is saved first, but this cannot be undone."))
    return msg, True, "", muted


@callback(
    Output("rm-msg", "children", allow_duplicate=True),
    Output("rm-msg", "style", allow_duplicate=True),
    Input("rm-confirm", "submit_n_clicks"),
    State("rm-dates", "start_date"),
    State("rm-dates", "end_date"),
    prevent_initial_call=True,
)
def _do_delete(submit_n, start, end):
    if not submit_n or not (start and end):
        raise PreventUpdate
    ok = {"fontSize": "14px", "marginTop": "14px", "color": theme.ACCENT}
    err = {"fontSize": "14px", "marginTop": "14px", "color": theme.EXPENSE_COLOR}
    try:
        n, _backup = store.delete_period(start, end)
        refresh()
        return (t("Removed {n} transaction(s). A backup was saved to data/backups/.").format(n=n),
                ok)
    except Exception as exc:
        return t("Could not remove: {err}").format(err=exc), err
