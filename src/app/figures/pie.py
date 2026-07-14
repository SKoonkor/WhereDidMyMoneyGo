"""Income / Expense composition pie charts (slide 5).

Two donut pies (Income, Expense) side by side. Each keeps the top categories by
amount and folds the remainder into 'Other' so no pie exceeds 12 slices.
"""

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from src.app import theme
from src.processing.summaries import filter_by_date
from src.analytics import budget as B

MAX_SLICES = 12  # 11 named categories + "Other"
_BUCKET_CAP = 8  # max named slices per bucket (Needs/Wants) before folding to "Other"
_HIDDEN_COLOR = "#8a94a6"  # neutral slate for the "Hidden cost (untracked)" slice


def _category_breakdown(df: pd.DataFrame, txn_type: str) -> pd.DataFrame:
    sub = df[df["Income/Expense"] == txn_type]
    if sub.empty:
        return pd.DataFrame(columns=["Category", "Amount"])
    grouped = (
        sub.groupby("Category")["Amount"].sum()
        .sort_values(ascending=False)
        .reset_index()
    )
    if len(grouped) > MAX_SLICES:
        top = grouped.iloc[: MAX_SLICES - 1].copy()
        other = pd.DataFrame(
            {"Category": ["Other"], "Amount": [grouped.iloc[MAX_SLICES - 1:]["Amount"].sum()]}
        )
        grouped = pd.concat([top, other], ignore_index=True)
    return grouped


def _expense_bucket_breakdown(df: pd.DataFrame, assignments: dict) -> pd.DataFrame:
    """Expense categories grouped into Needs then Wants (each amount-desc), with a
    `bucket` column. A bucket's tail folds into an 'Other' slice past _BUCKET_CAP."""
    sub = df[df["Income/Expense"] == "Expense"]
    if sub.empty:
        return pd.DataFrame(columns=["Category", "Amount", "bucket"])
    grouped = sub.groupby("Category")["Amount"].sum().sort_values(ascending=False)
    rows = []
    for bucket in (B.NEEDS, B.WANTS):
        cats = [(c, a) for c, a in grouped.items()
                if B.bucket_for(c, assignments) == bucket]
        if len(cats) > _BUCKET_CAP:
            other_amt = sum(a for _, a in cats[_BUCKET_CAP - 1:])
            cats = cats[: _BUCKET_CAP - 1] + [("Other", other_amt)]
        rows += [{"Category": c, "Amount": a, "bucket": bucket} for c, a in cats]
    return pd.DataFrame(rows)


def _center_font_size(total_text: str, compact: bool) -> int:
    """Font size for the in-hole total, shrinking with the digit count so
    wide numbers still fit inside the donut hole. `compact` (the small home
    snapshot card) drops a few extra points since its holes are tiny."""
    n = len(total_text)
    if n <= 5:
        size = 20
    elif n <= 7:
        size = 17
    elif n <= 9:
        size = 14
    else:
        size = 12
    return max(10, size - 4) if compact else size


def build_pie_figure(df: pd.DataFrame, start: str, end: str,
                     currency: str = "THB", dark: bool = True,
                     compact: bool = False, expense_order: str = "amount",
                     censor: bool = False) -> go.Figure:
    ft = theme.fig_theme(dark)
    # Include the whole end day so same-day entries (e.g. a reconciliation
    # recorded this afternoon) fall inside the window.
    end_incl = pd.Timestamp(end).normalize() + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    data = filter_by_date(df, start, str(end_incl))
    income = _category_breakdown(data, "Income")
    bucket_mode = expense_order == "bucket"
    if bucket_mode:
        expense = _expense_bucket_breakdown(data, B.load_budget().get("assignments", {}))
    else:
        expense = _category_breakdown(data, "Expense")

    # Recorded hidden cost (untracked) within the window, added as a single
    # distinct slice to the matching donut.
    income_hidden = data.loc[data["Income/Expense"] == "Adjustment-In", "Amount"].sum()
    expense_hidden = data.loc[data["Income/Expense"] == "Adjustment-Out", "Amount"].sum()

    # Two donuts placed side by side with explicit domains so we can drop
    # totals into each hole at a known center.
    specs = [
        dict(frame=income, palette="Greens", title="Income",
             dom_x=[0.0, 0.46], cx=0.23, hidden=income_hidden, bucket=False),
        dict(frame=expense, palette="Reds", title="Expense",
             dom_x=[0.54, 1.0], cx=0.77, hidden=expense_hidden, bucket=bucket_mode),
    ]

    fig = go.Figure()
    annotations = []
    for spec in specs:
        frame, palette, title = spec["frame"], spec["palette"], spec["title"]
        dom_x, cx, hidden, bucket = spec["dom_x"], spec["cx"], spec["hidden"], spec["bucket"]
        has_hidden = bool(hidden and hidden > 0)
        n_needs = int((frame["bucket"] == B.NEEDS).sum()) if bucket and not frame.empty else 0
        n_wants = int((frame["bucket"] == B.WANTS).sum()) if bucket and not frame.empty else 0
        if has_hidden:
            frame = pd.concat([frame, pd.DataFrame(
                {"Category": ["Hidden cost (untracked)"], "Amount": [hidden]})],
                ignore_index=True)
        total = frame["Amount"].sum() if not frame.empty else 0
        # Column title above the donut. xanchor must be explicit: with the
        # default "auto", Plotly left/right-anchors annotations in the outer
        # thirds of the paper, shifting them off the donut center.
        annotations.append(dict(text=f"<b>{title}</b>", x=cx, y=1.07,
                                xref="paper", yref="paper", showarrow=False,
                                xanchor="center",
                                font=dict(size=15, color=ft.ink)))
        if frame.empty:
            annotations.append(dict(text="No data", x=cx, y=0.5, xref="paper",
                                    yref="paper", showarrow=False,
                                    xanchor="center", yanchor="middle",
                                    font=dict(color=ft.muted)))
            continue
        if bucket:
            # Needs as a blue arc, Wants as an orange arc, hidden cost slate; keep
            # our Needs→Wants order (no re-sort).
            colors = ((_shade(n_needs, "Blues") if n_needs else [])
                      + (_shade(n_wants, "Oranges") if n_wants else [])
                      + ([_HIDDEN_COLOR] if has_hidden else []))
            sort_slices = False
        else:
            n_real = len(frame) - 1 if has_hidden else len(frame)
            colors = _shade(n_real, palette) + ([_HIDDEN_COLOR] if has_hidden else [])
            sort_slices = True
        fig.add_trace(go.Pie(
            labels=frame["Category"], values=frame["Amount"], hole=0.5,
            sort=sort_slices, direction="clockwise", domain=dict(x=dom_x, y=[0, 1]),
            marker=dict(colors=colors),
            # textposition="inside" => Plotly hides labels that don't fit a slice.
            textposition="inside", insidetextorientation="horizontal",
            texttemplate="%{label}<br>%{percent}",
            hovertemplate="%{label}: "
                          + ("*****" if censor else "%{value:,.0f} " + currency)
                          + " (%{percent})<extra></extra>",
        ))
        # Total centered in the donut hole, sized to the digit count (masked in
        # privacy mode).
        total_text = "*****" if censor else f"{total:,.0f}"
        annotations.append(dict(
            text=f"{total_text}<br><span style='font-size:0.8em;color:{ft.muted}'>{currency}</span>",
            x=cx, y=0.5, xref="paper", yref="paper", showarrow=False,
            xanchor="center", yanchor="middle",
            font=dict(size=_center_font_size(total_text, compact), color=ft.ink),
            align="center",
        ))

    # Needs/Wants subtotals beneath the expense donut, as two columns (Wants left,
    # Needs right):
    #   Wants               Needs
    #   <% of expense>      <% of expense>
    #   (<% of income>)     (<% of income>)
    # Hidden cost counts toward Wants (as on the Budget page), so the two % of
    # expense sum to 100%.
    if bucket_mode and not expense.empty:
        needs_total = float(expense.loc[expense["bucket"] == B.NEEDS, "Amount"].sum())
        wants_total = float(expense.loc[expense["bucket"] == B.WANTS, "Amount"].sum())
        wants_total += float(expense_hidden or 0)
        exp_total = needs_total + wants_total
        income_total = float(income["Amount"].sum()) if not income.empty else 0.0

        def _pct(part, whole):
            return f"{part / whole * 100:.0f}%" if whole else "–"

        blue, orange = _shade(1, "Blues")[0], _shade(1, "Oranges")[0]
        for name, tot, color, x in ((B.WANTS, wants_total, orange, 0.66),
                                    (B.NEEDS, needs_total, blue, 0.88)):
            text = (f"<span style='color:{color}'><b>{name}</b></span>"
                    f"<br><span style='font-size:7px'> </span>"  # gap below header
                    f"<br>{_pct(tot, exp_total)} of expense"
                    f"<br>({_pct(tot, income_total)} of income)")
            annotations.append(dict(text=text, x=x, y=-0.04, xref="paper",
                                    yref="paper", showarrow=False, xanchor="center",
                                    yanchor="top", align="center",
                                    font=dict(size=14, color=ft.ink)))

    # Constant bottom margin in both modes so the donuts never change size when the
    # expense-order switch is toggled (the subtotals sit in the reserved band below).
    fig.update_layout(
        template=ft.template, showlegend=False,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        margin=dict(t=60, b=92, l=20, r=20),
        annotations=annotations,
    )
    return fig


def build_hist_figure(df: pd.DataFrame, start: str, end: str,
                      currency: str = "THB", dark: bool = True,
                      expense_order: str = "amount",
                      censor: bool = False) -> go.Figure:
    """Bar-chart ("histogram") twin of :func:`build_pie_figure`. Income and Expense are
    shown side by side, one bar per category, reusing the pies' breakdowns and colour
    scheme so each bar matches its slice (Income Greens; Expense Reds, or Needs=Blues /
    Wants=Oranges in bucket mode; hidden cost slate). Amounts are masked under privacy."""
    ft = theme.fig_theme(dark)
    end_incl = pd.Timestamp(end).normalize() + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    data = filter_by_date(df, start, str(end_incl))
    income = _category_breakdown(data, "Income")
    bucket_mode = expense_order == "bucket"
    if bucket_mode:
        expense = _expense_bucket_breakdown(data, B.load_budget().get("assignments", {}))
    else:
        expense = _category_breakdown(data, "Expense")

    income_hidden = data.loc[data["Income/Expense"] == "Adjustment-In", "Amount"].sum()
    expense_hidden = data.loc[data["Income/Expense"] == "Adjustment-Out", "Amount"].sum()

    fig = make_subplots(rows=1, cols=2, subplot_titles=("Income", "Expense"),
                        horizontal_spacing=0.12)
    specs = [
        dict(frame=income, palette="Greens", col=1, cx=0.21, hidden=income_hidden,
             bucket=False),
        dict(frame=expense, palette="Reds", col=2, cx=0.79, hidden=expense_hidden,
             bucket=bucket_mode),
    ]
    for spec in specs:
        frame, palette, col = spec["frame"], spec["palette"], spec["col"]
        cx, hidden, bucket = spec["cx"], spec["hidden"], spec["bucket"]
        has_hidden = bool(hidden and hidden > 0)
        n_needs = int((frame["bucket"] == B.NEEDS).sum()) if bucket and not frame.empty else 0
        n_wants = int((frame["bucket"] == B.WANTS).sum()) if bucket and not frame.empty else 0
        if has_hidden:
            frame = pd.concat([frame, pd.DataFrame(
                {"Category": ["Hidden cost (untracked)"], "Amount": [hidden]})],
                ignore_index=True)
        if frame.empty:
            fig.add_annotation(text="No data", x=cx, y=0.5, xref="paper", yref="paper",
                               showarrow=False, xanchor="center", yanchor="middle",
                               font=dict(color=ft.muted))
            continue
        # Match the donut's slice colours exactly (see build_pie_figure).
        if bucket:
            colors = ((_shade(n_needs, "Blues") if n_needs else [])
                      + (_shade(n_wants, "Oranges") if n_wants else [])
                      + ([_HIDDEN_COLOR] if has_hidden else []))
        else:
            n_real = len(frame) - 1 if has_hidden else len(frame)
            colors = _shade(n_real, palette) + ([_HIDDEN_COLOR] if has_hidden else [])
        vals = frame["Amount"]
        text = ["" for _ in vals] if censor else [f"{v:,.0f}" for v in vals]
        fig.add_trace(go.Bar(
            x=frame["Category"], y=vals, marker=dict(color=colors),
            text=text, textposition="outside", textfont=dict(size=10, color=ft.ink),
            cliponaxis=False,
            hovertemplate="%{x}: "
                          + ("*****" if censor else "%{y:,.0f} " + currency)
                          + "<extra></extra>",
        ), row=1, col=col)

    fig.update_layout(
        template=ft.template, showlegend=False,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        margin=dict(t=60, b=100, l=40, r=20), dragmode="pan",
    )
    fig.update_xaxes(tickangle=-30, tickfont=dict(size=11), automargin=True)
    fig.update_yaxes(title_text=currency, showticklabels=not censor,
                     gridcolor=ft.grid, zeroline=False)
    # Restyle the make_subplots column titles to bold theme ink (matching the pies).
    for ann in fig.layout.annotations:
        if ann.text in ("Income", "Expense"):
            ann.text = f"<b>{ann.text}</b>"
            ann.font = dict(size=15, color=ft.ink)
    return fig


def _shade(n: int, scale: str) -> list[str]:
    """Sample n colors from a Plotly colorscale (light→dark)."""
    import plotly.colors as pc
    if n == 1:
        return pc.sample_colorscale(scale, [0.6])
    return pc.sample_colorscale(scale, [0.3 + 0.6 * i / (n - 1) for i in range(n)])
