"""Money Flow figure — cumulative running-balance 'waterfall'.

Each transaction is one bar on a **datetime x-axis** (so calendar days are
equally spaced and zoom/reset work natively). Income (and Transfer-In) bars rise
from the previous cumulative level and are outlined in black; Expense (and
Transfer-Out) bars drop from it. Within a day, transactions are packed across the
day and each bar's width is proportional to its share of that day's total amount.

The cumulative runs over the **entire** history so the visible window never
restarts at 0. Days with no transactions are bridged by a dashed horizontal line
at the carried balance. A dashed net-worth line and a per-account balance box are
overlaid (unless ``compact``).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go

from src.app import theme
from src.processing.balances import compute_account_balances

# Signed contribution of each transaction to the running balance.
# "Adjustment-In/Out" are reconciliation adjustments (the recorded
# hidden cost) — they move the balance and net worth toward the actual.
_SIGN = {"Income": 1, "Transfer-In": 1, "Adjustment-In": 1,
         "Expense": -1, "Transfer-Out": -1, "Adjustment-Out": -1}
_INCOME_LIKE = {"Income", "Transfer-In", "Adjustment-In"}

_DAY_MS = 86_400_000          # milliseconds in a day (bar width unit on a date axis)
_DAY_USABLE = 0.9             # fraction of a day occupied by bars (gap between days)
_DAY_PAD = (1 - _DAY_USABLE) / 2


def _empty(currency: str, msg: str = "No transactions", dark: bool = True) -> go.Figure:
    ft = theme.fig_theme(dark)
    fig = go.Figure()
    fig.update_layout(
        template=ft.template, yaxis_title=f"Amount ({currency})",
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        annotations=[dict(text=msg, x=0.5, y=0.5, xref="paper", yref="paper",
                          showarrow=False, font=dict(size=16, color=ft.muted))],
    )
    return fig


def build_money_flow_figure(
    df: pd.DataFrame,
    currency: str = "THB",
    default_days: int = 30,
    compact: bool = False,
    dark: bool = True,
    forecast: dict | None = None,
    censor: bool = False,
) -> go.Figure:
    ft = theme.fig_theme(dark)
    data = df[df["Income/Expense"].isin(_SIGN)].copy()
    if data.empty:
        return _empty(currency, dark=dark)

    data = data.sort_values("Period").reset_index(drop=True)
    data["signed"] = data["Income/Expense"].map(_SIGN) * data["Amount"]
    data["cum_after"] = data["signed"].cumsum()
    data["cum_before"] = data["cum_after"] - data["signed"]
    data["day"] = data["Period"].dt.normalize()

    # ── Per-transaction bar position (datetime) and width (ms) ────────────────
    x = np.empty(len(data), dtype="datetime64[ns]")
    width_ms = np.empty(len(data))
    for day, grp in data.groupby("day"):
        total = grp["Amount"].sum()
        offset = _DAY_PAD  # in day units, left edge of the usable band
        for idx in grp.index:
            frac = (data.at[idx, "Amount"] / total) if total > 0 else 1.0 / len(grp)
            w = _DAY_USABLE * frac
            center = offset + w / 2.0
            x[idx] = day + pd.Timedelta(days=center)
            width_ms[idx] = w * _DAY_MS
            offset += w

    data["x"] = x
    data["width_ms"] = width_ms
    data["base"] = data[["cum_before", "cum_after"]].min(axis=1)
    data["height"] = data["signed"].abs()

    fig = go.Figure()

    # ── Alternating faint-grey month bands (extended over the forecast) ────────
    band_end = data["day"].max()
    if forecast:
        band_end = max(band_end, pd.Timestamp(forecast["dates"][-1]))
    first_month = data["day"].min().to_period("M").to_timestamp()
    last_month = band_end.to_period("M").to_timestamp()
    months = pd.date_range(first_month, last_month, freq="MS")
    for i, m in enumerate(months):
        if i % 2 == 1:
            fig.add_vrect(x0=m, x1=m + pd.offsets.MonthBegin(1),
                          fillcolor=ft.band, opacity=0.04, line_width=0, layer="below")

    # ── Dashed connectors across days with no transactions ────────────────────
    full_days = pd.date_range(data["day"].min(), data["day"].max(), freq="D")
    day_end_level = data.groupby("day")["cum_after"].last().reindex(full_days).ffill()
    txn_days = set(data["day"].unique())
    gx, gy = [], []
    for d in full_days:
        if d not in txn_days:
            level = day_end_level.loc[d]
            gx += [d, d + pd.Timedelta(days=1), None]
            gy += [level, level, None]
    if gx:
        fig.add_trace(go.Scatter(
            x=gx, y=gy, mode="lines", name="(no activity)",
            line=dict(color=ft.muted, width=1, dash="dot"),
            hoverinfo="skip", showlegend=False,
        ))

    # ── One bar trace per account (legend toggles accounts) ───────────────────
    for i, account in enumerate(sorted(data["Account"].unique())):
        sub = data[data["Account"] == account]
        income_like = sub["Income/Expense"].isin(_INCOME_LIKE)
        line_widths = np.where(income_like, 1.6, 0.0)
        customdata = np.stack([
            sub["Income/Expense"].to_numpy(),
            sub["Amount"].to_numpy(),
            sub["cum_after"].to_numpy(),
            sub["Period"].dt.strftime("%d/%m/%Y %H:%M").to_numpy(),
            sub["Category"].to_numpy(),
        ], axis=-1)
        fig.add_trace(go.Bar(
            x=sub["x"], y=sub["height"], base=sub["base"], width=sub["width_ms"],
            name=account,
            marker=dict(color=theme.account_color(account, i),
                        line=dict(color=ft.bar_outline, width=line_widths)),
            customdata=customdata,
            hovertemplate=(
                "<b>%{customdata[0]}</b> · " + account + "<br>"
                "%{customdata[3]}<br>%{customdata[4]}<br>"
                + ("Amount: ***** " + currency + "<br>"
                   "Balance after: ***** " + currency + "<extra></extra>"
                   if censor else
                   "Amount: %{customdata[1]:,.0f} " + currency + "<br>"
                   "Balance after: %{customdata[2]:,.0f} " + currency
                   + "<extra></extra>")
            ),
        ))

    # ── Forecast fan (median + nested 50% / 90% bands), drawn behind the rest ──
    if forecast:
        fx = forecast["dates"]
        fc_color = theme.SAVING_COLOR
        fig.add_trace(go.Scatter(x=fx, y=forecast["hi90"], mode="lines",
                                 line=dict(width=0), hoverinfo="skip", showlegend=False))
        fig.add_trace(go.Scatter(x=fx, y=forecast["lo90"], mode="lines",
                                 line=dict(width=0), fill="tonexty",
                                 fillcolor="rgba(52,152,219,0.12)",
                                 name="Forecast 90%", hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=fx, y=forecast["hi50"], mode="lines",
                                 line=dict(width=0), hoverinfo="skip", showlegend=False))
        fig.add_trace(go.Scatter(x=fx, y=forecast["lo50"], mode="lines",
                                 line=dict(width=0), fill="tonexty",
                                 fillcolor="rgba(52,152,219,0.22)",
                                 name="Forecast 50%", hoverinfo="skip"))
        fig.add_trace(go.Scatter(
            x=fx, y=forecast["median"], mode="lines", name="Forecast",
            line=dict(color=fc_color, width=2, dash="dash"),
            hovertemplate="%{x|%d/%m/%Y}<br>"
                          + ("***** " if censor else "%{y:,.0f} ") + currency
                          + "<extra>Forecast</extra>",
        ))

    # ── Net worth & per-account balances ──────────────────────────────────────
    bal = compute_account_balances(data)
    final_balances = bal.groupby("Account")["balance"].last()
    net_worth = float(data["cum_after"].iloc[-1])

    # Zero reference line (solid red), beneath every other element.
    fig.add_hline(y=0, line=dict(color=theme.EXPENSE_COLOR, width=1.5), layer="below")

    nw_txt = "*****" if censor else f"{net_worth:,.0f}"
    fig.add_hline(y=net_worth, line=dict(color=ft.ink, width=1.2, dash="dash"),
                  annotation_text=f"Net worth {nw_txt} {currency}",
                  annotation_position="top left", layer="below")

    if not compact:
        lines = "<br>".join(
            f"{acct}: " + ("*****" if censor
                           else f"{final_balances.get(acct, 0):,.0f}") + f" {currency}"
            for acct in sorted(final_balances.index)
        )
        hidden = float(data.loc[
            data["Income/Expense"].isin(["Adjustment-In", "Adjustment-Out"]),
            "signed"].sum())
        hidden_txt = "*****" if censor else f"{hidden:+,.0f}"
        hidden_line = (f"<br>Hidden cost (untracked): {hidden_txt} {currency}"
                       if hidden else "")
        box = (f"<b>Latest balances</b><br>{lines}{hidden_line}"
               f"<br><b>Net worth: {nw_txt} {currency}</b>")
        fig.add_annotation(
            x=0.01, y=0.99, xref="paper", yref="paper", xanchor="left", yanchor="top",
            text=box, showarrow=False, align="left",
            font=dict(size=12, color=ft.ink),
            bgcolor=ft.anno_bg, bordercolor=ft.grid, borderwidth=1,
            borderpad=8,
        )

    # ── Default view: last `default_days` (+ forecast), y-range that fits it ───
    latest = data["day"].max()
    x0 = latest - pd.Timedelta(days=default_days)
    x1 = (pd.Timestamp(forecast["dates"][-1]) if forecast else latest) + pd.Timedelta(days=1)
    win = data[data["day"] >= x0]
    los, his = [], []
    if not win.empty:
        los.append(float(win["base"].min()))
        his.append(float((win["base"] + win["height"]).max()))
    if forecast:
        los.append(float(min(forecast["lo90"])))
        his.append(float(max(forecast["hi90"])))
    if los:
        lo, hi = min(los), max(his)
        pad = max((hi - lo) * 0.08, 1.0)
        y_range = [lo - pad, hi + pad]
    else:
        y_range = None

    fig.update_layout(
        barmode="overlay", bargap=0,
        yaxis_title=(f"Amount ({currency})" if not censor else ""),
        template=ft.template, hovermode="closest",
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        # Pan by default on the full page (the box-zoom button stays available);
        # leave the compact home snapshot alone so its click-to-navigate still works.
        dragmode=(None if compact else "pan"),
        uirevision="flow",  # keep zoom/pan when the theme toggles
        legend=dict(title="Accounts (click to toggle)", orientation="h",
                    yanchor="bottom", y=1.02, x=0),
        xaxis=dict(range=[x0, x1], showgrid=False, type="date"),
        # Privacy mode: hide the y tick labels so exact balances aren't readable.
        yaxis=dict(range=y_range, showticklabels=not censor),
        margin=dict(t=50, b=40, l=60, r=20),
    )
    return fig
